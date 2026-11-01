"""File operations engine (reference implementation, Python stdlib only).

Contract (see CONTRACTS.md):
- list / sort / search / filter over a real directory (never invented
  entries); ``properties`` reports real sizes, counts and read-only state
- copy / move / rename / delete / duplicate, plus multi-file
  ``copy_many`` / ``move_many`` with progress callbacks
- conflict resolution is EXPLICIT: default policy is "error" (never a
  silent overwrite). Other policies: "rename", "overwrite", "skip".
  "overwrite" is the explicit-confirmation path: callers that need a
  user confirmation pass ``confirm_overwrite``; when it declines, the
  operation behaves as "skip" (nothing is written, ``None`` is returned).
- atomic_write: write to a temp file in the SAME directory, flush + fsync,
  then os.replace. A crash mid-write leaves the old file or the temp file,
  never a half-written target. Temp files use the ``.om_tmp_`` marker in
  their name so ``cleanup_temp_files`` can remove exactly the engine's
  own leftovers on startup (user hidden files are never touched).
- Read-only handling: a file or directory with NO write permission bits
  is refused as read-only even when the process runs as root (root
  bypasses ``os.access`` checks, so mode bits are checked explicitly).
  Missing sources / destinations raise NOT_FOUND; a full disk raises
  INSUFFICIENT_STORAGE before the write is attempted where measurable.
- Symlink safety: symlinks are never followed. A symlink source is
  refused by ``copy`` (and by archive creation), a directory copy that
  contains any symlink inside is refused, and ``delete`` unlinks a
  symlink without touching its target.
- Nothing here executes file contents. No macros, no scripts, no HTML
  interpretation. Content is bytes/text only.
"""

from __future__ import annotations

import os
import re
import shutil
import stat
import tempfile
from dataclasses import dataclass, field
from pathlib import Path
from typing import Callable, Iterable, Iterator, Literal

from errors import (
    AlreadyExistsError,
    ConflictError,
    InsufficientStorageError,
    NotFoundError,
    OmSuiteError,
    OversizedInputError,
    PermissionDeniedError,
    ReadOnlyError,
    UnsafePathError,
    wrap_os_error,
)

ConflictPolicy = Literal["error", "rename", "overwrite", "skip"]
SortKey = Literal["name", "size", "mtime", "type"]

# Conservative default: a single file operation above this is refused unless
# the caller raises the limit explicitly (protects against accidental huge
# copies on a phone / small disk).
DEFAULT_MAX_FILE_BYTES = 2 * 1024 * 1024 * 1024  # 2 GiB

_WINDOWS_RESERVED = {
    "CON", "PRN", "AUX", "NUL",
    *(f"COM{i}" for i in range(1, 10)),
    *(f"LPT{i}" for i in range(1, 10)),
}


def validate_name(name: str) -> None:
    """Reject names that are unsafe on Windows or Android filesystems."""
    if not name or name in (".", ".."):
        raise UnsafePathError(f"Invalid file name: {name!r}")
    if "\x00" in name or "/" in name or "\\" in name:
        raise UnsafePathError(f"File name contains a separator or NUL: {name!r}")
    if name != name.strip() or name.endswith("."):
        raise UnsafePathError(f"File name has trailing space/dot: {name!r}")
    if name.split(".")[0].upper() in _WINDOWS_RESERVED:
        raise UnsafePathError(f"File name is a reserved device name: {name!r}")


def resolve_conflict(target: Path, policy: ConflictPolicy) -> Path | None:
    """Apply a conflict policy to ``target``.

    Returns the path to use, or None for policy "skip" (caller must not
    write). Raises ConflictError for policy "error" when the target exists.
    """
    if not target.exists() and not target.is_symlink():
        return target
    if policy == "error":
        raise ConflictError(f"Target already exists (no silent overwrite): {target}")
    if policy == "overwrite":
        return target
    if policy == "skip":
        return None
    # rename: "report.txt" -> "report (2).txt", "report (3).txt", ...
    stem, suffix = target.stem, target.suffix
    for i in range(2, 10000):
        candidate = target.with_name(f"{stem} ({i}){suffix}")
        if not candidate.exists() and not candidate.is_symlink():
            return candidate
    raise ConflictError(f"Could not find a free name near: {target}")


@dataclass(frozen=True)
class Entry:
    path: Path
    name: str
    is_dir: bool
    size: int  # dirs report 0; size is only meaningful for files
    mtime: float


def _entry(path: Path) -> Entry:
    try:
        st = path.stat()
    except OSError as exc:
        raise wrap_os_error(exc, str(path)) from exc
    return Entry(
        path=path,
        name=path.name,
        is_dir=path.is_dir(),
        size=0 if path.is_dir() else st.st_size,
        mtime=st.st_mtime,
    )


def list_dir(directory: str | Path, *, sort: SortKey = "name",
             descending: bool = False, include_hidden: bool = False) -> list[Entry]:
    """List one directory (non-recursive). Hidden = name starts with '.'."""
    directory = Path(directory)
    if not directory.exists():
        raise NotFoundError(f"Directory not found: {directory}")
    if not directory.is_dir():
        raise OmSuiteError(f"Not a directory: {directory}")
    try:
        names = os.listdir(directory)
    except OSError as exc:
        raise wrap_os_error(exc, str(directory)) from exc
    entries = []
    for name in names:
        if not include_hidden and name.startswith("."):
            continue
        entries.append(_entry(directory / name))
    key = {
        "name": lambda e: e.name.lower(),
        "size": lambda e: e.size,
        "mtime": lambda e: e.mtime,
        "type": lambda e: (e.is_dir, Path(e.name).suffix.lower()),
    }[sort]
    # Directories first for name sort is a UI choice, not a contract; keep
    # the sort pure so Android/Windows render identically.
    entries.sort(key=key, reverse=descending)
    return entries


@dataclass(frozen=True)
class FileProperties:
    """Real properties of one path (never invented).

    ``size`` for a directory is the recursive total of the files inside
    it (symlinks not followed, their targets not counted); ``file_count``
    / ``dir_count`` are the recursive counts for directories and 0 for
    files/symlinks. ``readonly`` is True when no write bit is set (see
    ``_has_no_write_bits``), so it is stable even for a root process.
    """
    path: Path
    name: str
    is_dir: bool
    is_symlink: bool
    size: int
    mtime: float
    readonly: bool
    file_count: int = 0
    dir_count: int = 0


def properties(path: str | Path) -> FileProperties:
    """Return properties for a file, directory or symlink."""
    path = Path(path)
    if not path.exists() and not path.is_symlink():
        raise NotFoundError(f"Not found: {path}")
    try:
        st = path.lstat()
    except OSError as exc:
        raise wrap_os_error(exc, str(path)) from exc
    is_link = path.is_symlink()
    is_dir = path.is_dir() and not is_link
    size = 0
    file_count = dir_count = 0
    if is_link:
        size = st.st_size
    elif is_dir:
        for root, dirs, files in os.walk(path, followlinks=False):
            # os.walk lists symlinked dirs in ``dirs``; never descend
            # into them (a loop would hang the walk).
            dirs[:] = [d for d in dirs
                       if not (Path(root) / d).is_symlink()]
            dir_count += len(dirs)
            for name in files:
                fpath = Path(root) / name
                if fpath.is_symlink():
                    continue
                file_count += 1
                try:
                    size += fpath.stat().st_size
                except OSError:
                    continue
    else:
        size = st.st_size
    return FileProperties(
        path=path, name=path.name, is_dir=is_dir, is_symlink=is_link,
        size=size, mtime=st.st_mtime,
        readonly=_has_no_write_bits(path),
        file_count=file_count, dir_count=dir_count)


def cleanup_temp_files(directory: str | Path) -> list[Path]:
    """Remove this engine's own atomic-write leftovers from a directory
    (crash recovery, Master Instructions §8: clean temp files after a
    crash). Only files whose name carries the ``.om_tmp_`` marker — the
    exact marker ``atomic_write`` uses — are removed, so a user's own
    hidden files (``.hidden`` etc.) are never touched. Returns what was
    removed. Missing directory -> NOT_FOUND; unreadable entries skipped.
    """
    directory = Path(directory)
    if not directory.exists():
        raise NotFoundError(f"Directory not found: {directory}")
    removed: list[Path] = []
    try:
        names = os.listdir(directory)
    except OSError as exc:
        raise wrap_os_error(exc, str(directory)) from exc
    for name in names:
        if ".om_tmp_" not in name or not name.startswith("."):
            continue
        target = directory / name
        if target.is_symlink() or target.is_file():
            try:
                target.unlink()
                removed.append(target)
            except OSError:
                continue
    return removed


def filter_entries(entries: Iterable[Entry], *,
                   extensions: Iterable[str] | None = None,
                   min_size: int | None = None,
                   max_size: int | None = None,
                   dirs_only: bool = False,
                   files_only: bool = False) -> list[Entry]:
    """Filter a list_dir / search result by extension (name suffix,
    case-insensitive, given with or without the leading dot) and/or by
    file size (directories report size 0 and are therefore only kept by
    a size filter when the bound includes 0)."""
    wanted = None
    if extensions is not None:
        wanted = {e.lower() if e.startswith(".") else f".{e.lower()}"
                  for e in extensions}
    out: list[Entry] = []
    for entry in entries:
        if dirs_only and not entry.is_dir:
            continue
        if files_only and entry.is_dir:
            continue
        if wanted is not None and \
                Path(entry.name).suffix.lower() not in wanted:
            continue
        if min_size is not None and entry.size < min_size:
            continue
        if max_size is not None and entry.size > max_size:
            continue
        out.append(entry)
    return out


def search(directory: str | Path, query: str, *, recursive: bool = True,
           search_content: bool = False, case_sensitive: bool = False,
           max_results: int = 1000,
           max_content_bytes: int = 10 * 1024 * 1024,
           extensions: Iterable[str] | None = None,
           min_size: int | None = None,
           max_size: int | None = None) -> list[Entry]:
    """Search by file name, optionally also by text content.

    Content search only reads files <= ``max_content_bytes`` that decode as
    UTF-8 (binary files are skipped, never executed or parsed). Symlinked
    directories are not followed (avoids loops). ``extensions`` /
    ``min_size`` / ``max_size`` filter candidates before they consume a
    result slot (same semantics as ``filter_entries``).
    """
    directory = Path(directory)
    if not directory.exists():
        raise NotFoundError(f"Directory not found: {directory}")
    needle = query if case_sensitive else query.lower()
    results: list[Entry] = []

    def _match_text(text: str) -> bool:
        return needle in text if case_sensitive else needle in text.lower()

    def _walk(root: Path) -> Iterator[Path]:
        try:
            with os.scandir(root) as it:
                for item in it:
                    p = Path(item.path)
                    yield p
                    if recursive and item.is_dir(follow_symlinks=False):
                        yield from _walk(p)
        except PermissionError:
            return  # unreadable subdir: skip it, do not abort the search
        except OSError:
            return

    def _accept(path: Path) -> None:
        entry = _entry(path)
        if filter_entries([entry], extensions=extensions,
                          min_size=min_size, max_size=max_size):
            results.append(entry)

    for path in _walk(directory):
        if len(results) >= max_results:
            break
        if _match_text(path.name):
            _accept(path)
            continue
        if search_content and path.is_file() and not path.is_symlink():
            try:
                if path.stat().st_size > max_content_bytes:
                    continue
                text = path.read_bytes().decode("utf-8")
            except (OSError, UnicodeDecodeError):
                continue
            if _match_text(text):
                _accept(path)
    return results


def _check_space(dst_dir: Path, needed: int) -> None:
    try:
        free = shutil.disk_usage(dst_dir).free
    except OSError:
        return  # cannot determine: let the write itself fail honestly
    if needed > free:
        raise InsufficientStorageError(
            f"Need {needed} bytes but only {free} free in {dst_dir}")


def _has_no_write_bits(path: Path) -> bool:
    """True when NO write bit (owner/group/other) is set.

    ``os.access`` returns True for root regardless of mode bits, so a
    read-only file (mode 0444) would look writable to a root process.
    Checking the bits explicitly makes read-only handling identical for
    every user, including root — matching the "read-only files" rule in
    the Master Instructions §3.1.
    """
    try:
        return stat.S_IMODE(path.lstat().st_mode) & 0o222 == 0
    except OSError:
        return False


def _check_writable(path: Path) -> None:
    parent = path.parent if path.parent != Path("") else Path(".")
    if not parent.exists():
        raise NotFoundError(f"Destination directory not found: {parent}")
    if not os.access(parent, os.W_OK) or _has_no_write_bits(parent):
        raise PermissionDeniedError(f"Directory not writable: {parent}")
    if path.exists() and (not os.access(path, os.W_OK)
                          or _has_no_write_bits(path)):
        raise ReadOnlyError(f"File is read-only: {path}")


def _size_of(src: Path) -> int:
    if src.is_dir():
        return sum(p.stat().st_size for p in src.rglob("*") if p.is_file())
    return src.stat().st_size


def _refuse_symlinks_in_tree(src: Path) -> None:
    """A directory copy must not silently follow a symlink inside the
    tree (its target could be anywhere on disk)."""
    for root, dirs, files in os.walk(src, followlinks=False):
        for name in dirs + files:
            if (Path(root) / name).is_symlink():
                raise UnsafePathError(
                    f"Refusing to copy a tree containing a symlink: "
                    f"{Path(root) / name}")


def _confirmed(dst: Path, policy: ConflictPolicy,
               confirm_overwrite: Callable[[Path], bool] | None) -> bool:
    """True when an overwrite may proceed. The confirmation callback is
    only consulted for policy "overwrite" on an existing target; it is
    ignored for every other policy (there is nothing to confirm)."""
    if policy != "overwrite" or confirm_overwrite is None:
        return True
    if not dst.exists() and not dst.is_symlink():
        return True
    return bool(confirm_overwrite(dst))


def copy(src: str | Path, dst: str | Path, *,
         policy: ConflictPolicy = "error",
         max_bytes: int = DEFAULT_MAX_FILE_BYTES,
         confirm_overwrite: Callable[[Path], bool] | None = None,
         ) -> Path | None:
    """Copy a file or directory. Returns the destination used, or None on skip.

    When ``policy`` is "overwrite" and ``confirm_overwrite`` is given and
    declines the existing target, this behaves as "skip" (returns None,
    destination untouched) — the overwrite-with-confirmation path. The
    callback is never consulted for other policies.
    """
    src, dst = Path(src), Path(dst)
    if not src.exists() and not src.is_symlink():
        raise NotFoundError(f"Source not found: {src}")
    if src.is_symlink():
        raise UnsafePathError(f"Refusing to copy a symlink (no target surprise): {src}")
    if src.is_dir():
        _refuse_symlinks_in_tree(src)
    if src.is_dir() and (dst == src or dst in src.parents or src in dst.parents and dst != src):
        # Copying a directory into itself (or its own parent chain in the
        # destination direction) would recurse forever.
        if dst.resolve() == src.resolve() or src.resolve() in dst.resolve().parents:
            raise UnsafePathError(f"Refusing to copy a directory into itself: {src} -> {dst}")
    total = _size_of(src)
    if total > max_bytes:
        raise OversizedInputError(f"Copy size {total} exceeds limit {max_bytes}")
    _check_space(dst.parent, total)
    _check_writable(dst)
    final = resolve_conflict(dst, policy)
    if final is None:
        return None
    if not _confirmed(final, policy, confirm_overwrite):
        return None  # confirmation declined: behaves as skip
    try:
        if src.is_dir():
            shutil.copytree(src, final)
        else:
            shutil.copy2(src, final)
    except OSError as exc:
        raise wrap_os_error(exc, str(final)) from exc
    return final


def move(src: str | Path, dst: str | Path, *,
         policy: ConflictPolicy = "error",
         confirm_overwrite: Callable[[Path], bool] | None = None,
         ) -> Path | None:
    """Move a file or directory. Returns the destination used, or None on skip.

    Same overwrite-with-confirmation semantics as ``copy``: a declined
    confirmation behaves as "skip" (the source is NOT moved).
    """
    src, dst = Path(src), Path(dst)
    if not src.exists() and not src.is_symlink():
        raise NotFoundError(f"Source not found: {src}")
    if src.is_dir() and (dst.resolve() == src.resolve()
                         or src.resolve() in dst.resolve().parents):
        raise UnsafePathError(f"Refusing to move a directory into itself: {src} -> {dst}")
    _check_writable(dst)
    final = resolve_conflict(dst, policy)
    if final is None:
        return None
    if not _confirmed(final, policy, confirm_overwrite):
        return None
    try:
        shutil.move(str(src), str(final))
    except OSError as exc:
        raise wrap_os_error(exc, str(final)) from exc
    return final


def rename(path: str | Path, new_name: str, *,
           policy: ConflictPolicy = "error",
           confirm_overwrite: Callable[[Path], bool] | None = None,
           ) -> Path | None:
    """Rename within the same directory. Returns the new path, or None on skip.

    Same overwrite-with-confirmation semantics as ``copy``.
    """
    path = Path(path)
    if not path.exists() and not path.is_symlink():
        raise NotFoundError(f"Not found: {path}")
    validate_name(new_name)
    final = resolve_conflict(path.with_name(new_name), policy)
    if final is None:
        return None
    if not _confirmed(final, policy, confirm_overwrite):
        return None
    try:
        os.rename(path, final)
    except OSError as exc:
        raise wrap_os_error(exc, str(final)) from exc
    return final


@dataclass
class BatchItemResult:
    """One item of a ``copy_many`` / ``move_many`` run."""
    src: Path
    dst: Path
    outcome: str  # "ok" | "skipped"
    result: Path | None  # destination used, or None when skipped


@dataclass
class BatchResult:
    """Outcome of a multi-file run. ``errors`` maps ``str(src)`` to the
    error message for items that failed; it is only non-empty when
    ``continue_on_error`` was True (otherwise the first error raises
    and no BatchResult is returned). ``items`` never contains failures.
    """
    items: list[BatchItemResult] = field(default_factory=list)
    errors: dict[str, str] = field(default_factory=dict)

    @property
    def succeeded(self) -> list[BatchItemResult]:
        return [i for i in self.items if i.outcome == "ok"]

    @property
    def skipped(self) -> list[BatchItemResult]:
        return [i for i in self.items if i.outcome == "skipped"]


def _batch(operation, pairs: Iterable[tuple[str | Path, str | Path]], *,
           policy: ConflictPolicy,
           progress: Callable[[int, int, str], None] | None,
           confirm_overwrite: Callable[[Path], bool] | None,
           continue_on_error: bool,
           **kwargs) -> BatchResult:
    pairs = [(Path(s), Path(d)) for s, d in pairs]
    result = BatchResult()
    total = len(pairs)
    for idx, (src, dst) in enumerate(pairs, start=1):
        try:
            out = operation(src, dst, policy=policy,
                            confirm_overwrite=confirm_overwrite, **kwargs)
        except OmSuiteError as exc:
            if not continue_on_error:
                raise
            result.errors[str(src)] = str(exc)
            if progress:
                progress(idx, total, src.name)
            continue
        result.items.append(BatchItemResult(
            src=src, dst=dst,
            outcome="ok" if out is not None else "skipped", result=out))
        if progress:
            progress(idx, total, src.name)
    return result


def copy_many(pairs: Iterable[tuple[str | Path, str | Path]], *,
              policy: ConflictPolicy = "error",
              progress: Callable[[int, int, str], None] | None = None,
              confirm_overwrite: Callable[[Path], bool] | None = None,
              continue_on_error: bool = False,
              max_bytes: int = DEFAULT_MAX_FILE_BYTES) -> BatchResult:
    """Copy many files/directories. ``progress(done, total, src_name)``
    is called after each item; an exception inside it aborts the run
    (items already copied stay copied — the caller sees the partial
    state via the exception, and via ``BatchResult`` only when
    ``continue_on_error`` collected the failure instead)."""
    return _batch(copy, pairs, policy=policy, progress=progress,
                  confirm_overwrite=confirm_overwrite,
                  continue_on_error=continue_on_error, max_bytes=max_bytes)


def move_many(pairs: Iterable[tuple[str | Path, str | Path]], *,
              policy: ConflictPolicy = "error",
              progress: Callable[[int, int, str], None] | None = None,
              confirm_overwrite: Callable[[Path], bool] | None = None,
              continue_on_error: bool = False) -> BatchResult:
    """Move many files/directories (same progress / error semantics as
    ``copy_many``)."""
    return _batch(move, pairs, policy=policy, progress=progress,
                  confirm_overwrite=confirm_overwrite,
                  continue_on_error=continue_on_error)


def duplicate(path: str | Path, *, policy: ConflictPolicy = "rename") -> Path:
    """Duplicate a file/dir next to the original: 'name (copy).ext'.

    Default policy is "rename" (a duplicate must never silently overwrite).
    """
    path = Path(path)
    if not path.exists():
        raise NotFoundError(f"Not found: {path}")
    stem, suffix = path.stem, path.suffix
    candidate = path.with_name(f"{stem} (copy){suffix}")
    if candidate.exists():
        candidate = resolve_conflict(candidate, "rename")  # (copy) -> (copy) (2)...
        assert candidate is not None
    # Reuse copy() with error policy: the candidate is already known-free.
    result = copy(path, candidate, policy="error")
    assert result is not None
    return result


def delete(path: str | Path, *, recursive: bool = False) -> None:
    """Delete a file, or a directory only when ``recursive`` is True.

    Symlinks are unlinked, never followed. There is deliberately no trash
    can in this engine: Android SAF and Windows Recycle Bin differ too much
    to share safely (see README). Apps must confirm with the user first.
    """
    path = Path(path)
    if path.is_symlink() or path.is_file():
        try:
            path.unlink()
        except OSError as exc:
            raise wrap_os_error(exc, str(path)) from exc
        return
    if path.is_dir():
        if not recursive:
            raise OmSuiteError(f"Refusing to delete a non-empty directory without recursive=True: {path}")
        try:
            shutil.rmtree(path)
        except OSError as exc:
            raise wrap_os_error(exc, str(path)) from exc
        return
    raise NotFoundError(f"Not found: {path}")


def atomic_write(path: str | Path, data: bytes, *,
                 policy: ConflictPolicy = "overwrite",
                 confirm_overwrite: Callable[[Path], bool] | None = None,
                 ) -> Path:
    """Write ``data`` atomically: temp file in the same dir + os.replace.

    Policy "error" refuses to replace an existing file; "overwrite" is the
    normal save path (an explicit user save, not a silent overwrite from a
    copy). When ``confirm_overwrite`` is given with policy "overwrite"
    and declines, the old file is left untouched and ``path`` is returned
    unchanged (skip semantics). The temp file is removed on failure, and
    its name carries the ``.om_tmp_`` marker so ``cleanup_temp_files``
    can find crash leftovers later.
    """
    path = Path(path)
    validate_name(path.name)
    if path.exists() and policy == "error":
        raise ConflictError(f"Refusing to overwrite existing file: {path}")
    if path.exists() and policy == "skip":
        return path
    if path.exists() and policy == "rename":
        path = resolve_conflict(path, "rename")  # type: ignore[assignment]
        assert path is not None
    if path.exists() and not _confirmed(path, policy, confirm_overwrite):
        return path
    _check_space(path.parent, len(data))
    _check_writable(path)
    fd, tmp_name = tempfile.mkstemp(prefix=f".{path.name}.om_tmp_",
                                    dir=str(path.parent))
    tmp = Path(tmp_name)
    try:
        with os.fdopen(fd, "wb") as fh:
            fh.write(data)
            fh.flush()
            os.fsync(fh.fileno())
        # Preserve the old file's permission bits when replacing it.
        if path.exists():
            try:
                os.chmod(tmp, stat.S_IMODE(path.stat().st_mode))
            except OSError:
                pass
        os.replace(tmp, path)
    except OSError as exc:
        try:
            tmp.unlink(missing_ok=True)
        except OSError:
            pass
        raise wrap_os_error(exc, str(path)) from exc
    return path


def read_bytes_capped(path: str | Path, *, max_bytes: int) -> bytes:
    """Read a file, refusing files larger than ``max_bytes``."""
    path = Path(path)
    if not path.exists():
        raise NotFoundError(f"Not found: {path}")
    try:
        size = path.stat().st_size
    except OSError as exc:
        raise wrap_os_error(exc, str(path)) from exc
    if size > max_bytes:
        raise OversizedInputError(f"File {size} bytes exceeds limit {max_bytes}")
    try:
        return path.read_bytes()
    except OSError as exc:
        raise wrap_os_error(exc, str(path)) from exc
