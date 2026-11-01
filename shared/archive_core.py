"""Safe ZIP archive engine (reference implementation, Python stdlib only).

Supported: ZIP only. RAR / 7Z / TAR are NOT implemented (no verified
engine here; see STATUS.md). That is deliberate: claiming them without
a tested engine would be a fake feature. An archive whose bytes are not
a ZIP but whose name says .rar / .7z / .tar / .gz gets a clear
UNSUPPORTED_FORMAT error, not a misleading "not a ZIP" error; a .zip
name with non-ZIP bytes still gets MALFORMED_INPUT.

Safety rules (all enforced before any byte is written):
- Path traversal: absolute paths, ".." components, drive letters and
  backslash separators are rejected (UnsafePathError). Symlink entries
  (Unix mode bits) are rejected, never restored as links.
- Encrypted entries are refused (UNSUPPORTED_FORMAT): this engine has
  no decryption, and silently skipping an encrypted file would look
  like a successful extract with a file missing.
- Archive bomb limits: max entries, max total uncompressed size, max
  single-file size, max compression ratio (uncompressed / archive size).
  Defaults are generous for real documents, small enough to stop bombs.
  During extraction the bytes actually written are also counted: a
  lying header (small declared size, huge real content) or a CRC
  mismatch aborts with an error instead of trusting the header.
- Conflicts on extract use the same explicit policies as file_core:
  default "error" (no silent overwrite), also "rename" / "overwrite" /
  "skip". "rename" on extract appends " (2)", " (3)", ... .
- Partial extraction is reported honestly: if extraction fails midway
  (conflict, CRC, size, I/O), the exception carries a ``partial_paths``
  attribute listing the files already written, so the app can say
  "partially extracted" instead of pretending nothing happened.
- Progress: an optional callback ``progress(done, total, name)`` is called
  after each entry; raising inside it aborts the operation.
- Nothing inside an archive is ever executed. Entries are bytes only.
  A ZIP nested inside a ZIP is extracted as an opaque file, never
  expanded recursively (nested expansion is how bombs hide).
- Empty directories: ``create`` stores an explicit entry for a directory
  that contains no files (otherwise the empty folder would silently
  vanish); ``extract`` recreates explicit empty-dir entries.
"""

from __future__ import annotations

import io
import os
import stat
import tempfile
import zipfile
from pathlib import Path, PurePosixPath
from typing import Callable, Iterable, Literal

from errors import (
    MalformedInputError,
    NotFoundError,
    OmSuiteError,
    OversizedInputError,
    UnsafePathError,
    UnsupportedFormatError,
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


_NON_ZIP_SUFFIXES = {".rar", ".7z", ".tar", ".tgz", ".tbz2", ".gz",
                     ".bz2", ".xz", ".zst", ".cab", ".iso"}
_ZIP_MAGICS = (b"PK\x03\x04", b"PK\x05\x06", b"PK\x07\x08")


def _refuse_non_zip(archive: Path, *, for_create: bool) -> None:
    """Refuse a non-ZIP archive format with a clear error instead of a
    misleading "not a ZIP" message. For reading, the file's magic bytes
    win over its name (a real ZIP misnamed .rar still reads); for
    creating, the requested name decides (writing ZIP bytes under a
    .rar name would be a lie about the output format)."""
    if for_create:
        if archive.suffix.lower() in _NON_ZIP_SUFFIXES:
            raise UnsupportedFormatError(
                f"Only ZIP archives can be created; {archive.suffix} is "
                f"not supported: {archive}")
        return
    try:
        with open(archive, "rb") as fh:
            magic = fh.read(4)
    except OSError:
        return  # the open in browse()/extract() reports the real error
    if magic.startswith(_ZIP_MAGICS) or magic[:2] == b"PK":
        return
    if archive.suffix.lower() in _NON_ZIP_SUFFIXES:
        raise UnsupportedFormatError(
            f"Only ZIP archives are supported; {archive.suffix} archives "
            f"cannot be read by this engine: {archive}")


def _check_encrypted(info: zipfile.ZipInfo) -> None:
    """Flag bit 0 means the entry is encrypted. Refuse, never skip
    silently (a skipped file looks like a successful extract)."""
    if info.flag_bits & 0x1:
        raise UnsupportedFormatError(
            f"Encrypted archive entry is not supported (no decryption "
            f"in this engine): {info.filename!r}")


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
    _refuse_non_zip(archive, for_create=False)
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
            _check_encrypted(info)
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
    _refuse_non_zip(archive, for_create=False)
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
        # Validate EVERYTHING up front — including directory entries,
        # so a traversal dir name cannot slip past the file checks.
        plan = []
        dir_infos = []
        selected_dirs: list[zipfile.ZipInfo] = []
        for info in infos:
            validate_entry_name(info.filename)
            _check_encrypted(info)
            if _is_symlink_entry(info):
                raise UnsafePathError(f"Symlink entry refused: {info.filename!r}")
            if info.is_dir():
                if wanted is None:
                    dir_infos.append(info)
                elif info.filename in wanted:
                    # An explicitly selected empty dir is created, but
                    # not counted in ``written`` (which lists files).
                    selected_dirs.append(info)
                continue
            if wanted is not None and info.filename not in wanted:
                continue
            plan.append(info)
        if wanted is not None:
            missing = wanted - {i.filename for i in plan} \
                - {i.filename for i in selected_dirs}
            if missing:
                raise NotFoundError(f"Selected entries not in archive: {sorted(missing)}")
        dest_dir.mkdir(parents=True, exist_ok=True)
        for info in dir_infos + selected_dirs:
            (dest_dir / PurePosixPath(info.filename.replace("\\", "/"))).mkdir(
                parents=True, exist_ok=True)
        written: list[Path] = []
        try:
            total_written = 0
            for idx, info in enumerate(plan, start=1):
                target = dest_dir / PurePosixPath(info.filename.replace("\\", "/"))
                target.parent.mkdir(parents=True, exist_ok=True)
                final = resolve_conflict(target, policy)
                if final is None:
                    if progress:
                        progress(idx, len(plan), info.filename)
                    continue
                # Write via a temp file + replace, so a failed entry
                # (CRC, size, I/O) leaves an existing destination
                # untouched instead of truncating it and then failing.
                fd, tmp_name = tempfile.mkstemp(
                    prefix=f".{final.name}.om_tmp_", dir=str(target.parent))
                tmp_path = Path(tmp_name)
                try:
                    entry_written = 0
                    with zf.open(info, "r") as src, \
                            os.fdopen(fd, "wb") as out:
                        while True:
                            chunk = src.read(1024 * 1024)
                            if not chunk:
                                break
                            out.write(chunk)
                            entry_written += len(chunk)
                            total_written += len(chunk)
                            # Trust bytes on disk, not the header: a
                            # lying file_size must not smuggle a bomb.
                            if entry_written > max_file or \
                                    total_written > max_total:
                                raise OversizedInputError(
                                    f"Entry {info.filename!r} expands past "
                                    f"the size limit during extraction")
                    # Extracted files get 0644: entry permission bits
                    # are NOT restored (entries are bytes only, and a
                    # restored setuid/executable bit from an untrusted
                    # archive would be a surprise, not a feature).
                    try:
                        os.chmod(tmp_path, 0o644)
                    except OSError:
                        pass
                    os.replace(tmp_path, final)
                except (zipfile.BadZipFile, OSError, OversizedInputError,
                        NotImplementedError) as exc:
                    # A failed entry leaves no partial file behind;
                    # earlier successful entries stay and are reported
                    # via partial_paths (outer handler).
                    try:
                        tmp_path.unlink(missing_ok=True)
                    except OSError:
                        pass
                    if isinstance(exc, zipfile.BadZipFile):
                        # CRC mismatch on read lands here (zipfile raises
                        # BadZipFile, not OSError, for a bad CRC).
                        raise MalformedInputError(
                            f"Corrupt archive entry (CRC mismatch): "
                            f"{info.filename!r}") from exc
                    if isinstance(exc, NotImplementedError):
                        # Unknown compression method (e.g. AES).
                        raise MalformedInputError(
                            f"Archive entry uses an unsupported compression "
                            f"method: {info.filename!r}") from exc
                    if isinstance(exc, OSError):
                        raise wrap_os_error(exc, str(final)) from exc
                    raise
                written.append(final)
                if progress:
                    progress(idx, len(plan), info.filename)
        except Exception as exc:
            # Honest partial state (see module docstring): the caller
            # can read exc.partial_paths instead of guessing.
            try:
                exc.partial_paths = list(written)  # type: ignore[attr-defined]
            except Exception:
                pass
            raise
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
    _refuse_non_zip(archive, for_create=True)
    final = resolve_conflict(archive, policy)
    if final is None:
        return archive  # policy "skip": nothing written, archive untouched
    items: list[tuple[Path | None, str]] = []  # (disk path, archive name)
    for src in sources:
        src = Path(src)
        if not src.exists():
            raise NotFoundError(f"Source not found: {src}")
        if src.is_symlink():
            raise UnsafePathError(f"Refusing to archive a symlink: {src}")
        if src.is_dir():
            entries = sorted(src.rglob("*"))
            for p in entries:
                if p.is_symlink():
                    raise UnsafePathError(f"Refusing to archive a symlink: {p}")
                if p.is_file():
                    items.append((p, f"{src.name}/{p.relative_to(src).as_posix()}"))
            # Directories that contain no files at all get an explicit
            # entry, or they would silently vanish from the archive.
            # (Directories WITH files need no entry: their files'
            # parents are recreated on extract. This also keeps the
            # browse list for ordinary trees exactly file-only.)
            dirs = [src] + [p for p in entries if p.is_dir()]
            for d in dirs:
                if not any(p.is_file() for p in d.rglob("*")):
                    rel = "" if d == src else d.relative_to(src).as_posix()
                    arc = src.name if not rel else f"{src.name}/{rel}"
                    items.append((None, arc + "/"))
        else:
            items.append((src, src.name))
    try:
        with zipfile.ZipFile(final, "w", compression=zipfile.ZIP_DEFLATED) as zf:
            for idx, (disk, arc_name) in enumerate(items, start=1):
                if disk is None:
                    zf.writestr(zipfile.ZipInfo(arc_name), b"")
                else:
                    zf.write(disk, arcname=arc_name)
                if progress:
                    progress(idx, len(items), arc_name)
    except OSError as exc:
        raise wrap_os_error(exc, str(final)) from exc
    return final
