"""Safe ZIP archive engine (reference implementation, Python stdlib only).

Supported: ZIP only. RAR / 7Z are NOT implemented (no verified engine here;
see STATUS.md). That is deliberate: claiming them without a tested engine
would be a fake feature.

Safety rules (all enforced before any byte is written):
- Path traversal: absolute paths, ".." components, drive letters and
  backslash separators are rejected (UnsafePathError). Symlink entries
  (Unix mode bits) are rejected, never restored as links.
- Archive bomb limits: max entries, max total uncompressed size, max
  single-file size, max compression ratio (uncompressed / archive size).
  Defaults are generous for real documents, small enough to stop bombs.
- Conflicts on extract use the same explicit policies as file_core:
  default "error" (no silent overwrite), also "rename" / "overwrite" /
  "skip". "rename" on extract appends " (2)", " (3)", ... .
- Progress: an optional callback ``progress(done, total, name)`` is called
  after each entry; raising inside it aborts the operation.
- Nothing inside an archive is ever executed. Entries are bytes only.
"""

from __future__ import annotations

import io
import os
import stat
import zipfile
from pathlib import Path, PurePosixPath
from typing import Callable, Iterable, Literal

from errors import (
    MalformedInputError,
    NotFoundError,
    OmSuiteError,
    OversizedInputError,
    UnsafePathError,
    wrap_os_error,
)
from file_core import ConflictPolicy, resolve_conflict

ProgressCallback = Callable[[int, int, str], None]

DEFAULT_MAX_ENTRIES = 10_000
DEFAULT_MAX_TOTAL_BYTES = 1 * 1024 * 1024 * 1024  # 1 GiB uncompressed total
DEFAULT_MAX_FILE_BYTES = 512 * 1024 * 1024        # 512 MiB single entry
DEFAULT_MAX_RATIO = 200  # uncompressed / compressed; a text bomb is ~1000x


def _is_symlink_entry(info: zipfile.ZipInfo) -> bool:
    mode = info.external_attr >> 16
    return stat.S_ISLNK(mode)


def validate_entry_name(name: str) -> None:
    """Reject any archive member name that could escape the target dir."""
    if not name or name.startswith("/") or name.startswith("\\"):
        raise UnsafePathError(f"Unsafe archive entry name: {name!r}")
    if len(name) >= 2 and name[1] == ":":
        raise UnsafePathError(f"Drive-letter entry name: {name!r}")
    # Zip spec uses "/"; also treat "\" as a separator (Windows-created zips).
    parts = PurePosixPath(name.replace("\\", "/")).parts
    if any(part in ("..", "") for part in parts):
        raise UnsafePathError(f"Traversal entry name: {name!r}")
    if "\x00" in name:
        raise UnsafePathError(f"NUL in entry name: {name!r}")


def _check_bomb_limits(zf: zipfile.ZipFile, archive_size: int, *,
                       max_entries: int, max_total: int,
                       max_file: int, max_ratio: int) -> list[zipfile.ZipInfo]:
    infos = zf.infolist()
    if len(infos) > max_entries:
        raise OversizedInputError(f"Archive has {len(infos)} entries (limit {max_entries})")
    total = 0
    for info in infos:
        if info.is_dir():
            continue
        if info.file_size > max_file:
            raise OversizedInputError(
                f"Entry {info.filename!r} is {info.file_size} bytes (limit {max_file})")
        total += info.file_size
    if total > max_total:
        raise OversizedInputError(f"Archive uncompressed total {total} exceeds {max_total}")
    if archive_size > 0 and total // max(archive_size, 1) > max_ratio:
        raise OversizedInputError(
            f"Compression ratio {total // archive_size}:1 exceeds {max_ratio}:1 (likely bomb)")
    return infos


def browse(archive: str | Path, *,
           max_entries: int = DEFAULT_MAX_ENTRIES,
           max_total: int = DEFAULT_MAX_TOTAL_BYTES,
           max_file: int = DEFAULT_MAX_FILE_BYTES,
           max_ratio: int = DEFAULT_MAX_RATIO) -> list[dict]:
    """List archive members WITHOUT extracting anything.

    Returns dicts: name, size (uncompressed), compressed_size, is_dir.
    Traversal / symlink / bomb violations raise before the list is returned.
    """
    archive = Path(archive)
    if not archive.exists():
        raise NotFoundError(f"Archive not found: {archive}")
    try:
        zf = zipfile.ZipFile(archive, "r")
    except zipfile.BadZipFile as exc:
        raise MalformedInputError(f"Not a valid ZIP archive: {archive}") from exc
    except OSError as exc:
        raise wrap_os_error(exc, str(archive)) from exc
    with zf:
        infos = _check_bomb_limits(zf, archive.stat().st_size,
                                   max_entries=max_entries, max_total=max_total,
                                   max_file=max_file, max_ratio=max_ratio)
        out = []
        for info in infos:
            validate_entry_name(info.filename)
            if _is_symlink_entry(info):
                raise UnsafePathError(f"Symlink entry refused: {info.filename!r}")
            out.append({
                "name": info.filename,
                "size": info.file_size,
                "compressed_size": info.compress_size,
                "is_dir": info.is_dir(),
            })
        return out


def extract(archive: str | Path, dest_dir: str | Path, *,
            selected: Iterable[str] | None = None,
            policy: ConflictPolicy = "error",
            progress: ProgressCallback | None = None,
            max_entries: int = DEFAULT_MAX_ENTRIES,
            max_total: int = DEFAULT_MAX_TOTAL_BYTES,
            max_file: int = DEFAULT_MAX_FILE_BYTES,
            max_ratio: int = DEFAULT_MAX_RATIO) -> list[Path]:
    """Extract all entries, or only ``selected`` names. Returns written paths.

    Extraction is all-or-nothing per entry-name validation: traversal,
    symlink and bomb checks run BEFORE any file is written, so a hostile
    archive cannot plant one file and then fail. (A conflict error midway
    can still leave earlier entries extracted; the caller gets the list of
    what was written via the exception chain / partial return — apps must
    surface this. See STATUS.md limitation L2.)
    """
    archive, dest_dir = Path(archive), Path(dest_dir)
    if not archive.exists():
        raise NotFoundError(f"Archive not found: {archive}")
    try:
        zf = zipfile.ZipFile(archive, "r")
    except zipfile.BadZipFile as exc:
        raise MalformedInputError(f"Not a valid ZIP archive: {archive}") from exc
    except OSError as exc:
        raise wrap_os_error(exc, str(archive)) from exc
    with zf:
        infos = _check_bomb_limits(zf, archive.stat().st_size,
                                   max_entries=max_entries, max_total=max_total,
                                   max_file=max_file, max_ratio=max_ratio)
        wanted = None if selected is None else set(selected)
        # Validate EVERYTHING up front.
        plan = []
        for info in infos:
            if info.is_dir():
                continue
            validate_entry_name(info.filename)
            if _is_symlink_entry(info):
                raise UnsafePathError(f"Symlink entry refused: {info.filename!r}")
            if wanted is not None and info.filename not in wanted:
                continue
            plan.append(info)
        if wanted is not None:
            missing = wanted - {i.filename for i in plan}
            if missing:
                raise NotFoundError(f"Selected entries not in archive: {sorted(missing)}")
        dest_dir.mkdir(parents=True, exist_ok=True)
        written: list[Path] = []
        for idx, info in enumerate(plan, start=1):
            target = dest_dir / PurePosixPath(info.filename.replace("\\", "/"))
            target.parent.mkdir(parents=True, exist_ok=True)
            final = resolve_conflict(target, policy)
            if final is None:
                if progress:
                    progress(idx, len(plan), info.filename)
                continue
            try:
                with zf.open(info, "r") as src, open(final, "wb") as out:
                    while True:
                        chunk = src.read(1024 * 1024)
                        if not chunk:
                            break
                        out.write(chunk)
            except OSError as exc:
                raise wrap_os_error(exc, str(final)) from exc
            written.append(final)
            if progress:
                progress(idx, len(plan), info.filename)
        return written


def extract_all(archive: str | Path, dest_dir: str | Path, **kwargs) -> list[Path]:
    """Extract every entry (convenience wrapper over extract)."""
    return extract(archive, dest_dir, **kwargs)


def create(archive: str | Path, sources: Iterable[str | Path], *,
           policy: ConflictPolicy = "error",
           progress: ProgressCallback | None = None) -> Path:
    """Create a ZIP from files/directories.

    Directory sources are stored recursively with paths relative to the
    source directory's parent, so "docs/report.txt" stays "report.txt" only
    when the source itself is the directory — see docstring note: each
    source's own name becomes the archive root for that source.
    Symlinks are refused (their targets would leak outside the archive).
    """
    archive = Path(archive)
    final = resolve_conflict(archive, policy)
    if final is None:
        return archive  # policy "skip": nothing written, archive untouched
    items: list[tuple[Path, str]] = []  # (disk path, archive name)
    for src in sources:
        src = Path(src)
        if not src.exists():
            raise NotFoundError(f"Source not found: {src}")
        if src.is_symlink():
            raise UnsafePathError(f"Refusing to archive a symlink: {src}")
        if src.is_dir():
            for p in sorted(src.rglob("*")):
                if p.is_symlink():
                    raise UnsafePathError(f"Refusing to archive a symlink: {p}")
                if p.is_file():
                    items.append((p, f"{src.name}/{p.relative_to(src).as_posix()}"))
        else:
            items.append((src, src.name))
    try:
        with zipfile.ZipFile(final, "w", compression=zipfile.ZIP_DEFLATED) as zf:
            for idx, (disk, arc_name) in enumerate(items, start=1):
                zf.write(disk, arcname=arc_name)
                if progress:
                    progress(idx, len(items), arc_name)
    except OSError as exc:
        raise wrap_os_error(exc, str(final)) from exc
    return final
