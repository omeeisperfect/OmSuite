"""File operations engine (reference implementation, Python stdlib only).

Contract (see CONTRACTS.md):
- list / sort / search over a real directory (never invented entries)
- copy / move / rename / delete / duplicate
- conflict resolution is EXPLICIT: default policy is "error" (never a
  silent overwrite). Other policies: "rename", "overwrite", "skip".
- atomic_write: write to a temp file in the SAME directory, flush + fsync,
  then os.replace. A crash mid-write leaves the old file or the temp file,
  never a half-written target.
- Nothing here executes file contents. No macros, no scripts, no HTML
  interpretation. Content is bytes/text only.
"""

from __future__ import annotations

import os
import re
import shutil
import stat
import tempfile
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable, Iterator, Literal

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


def search(directory: str | Path, query: str, *, recursive: bool = True,
           search_content: bool = False, case_sensitive: bool = False,
           max_results: int = 1000,
           max_content_bytes: int = 10 * 1024 * 1024) -> list[Entry]:
    """Search by file name, optionally also by text content.

    Content search only reads files <= ``max_content_bytes`` that decode as
    UTF-8 (binary files are skipped, never executed or parsed). Symlinked
    directories are not followed (avoids loops).
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

    for path in _walk(directory):
        if len(results) >= max_results:
            break
        if _match_text(path.name):
            results.append(_entry(path))
            continue
        if search_content and path.is_file() and not path.is_symlink():
            try:
                if path.stat().st_size > max_content_bytes:
                    continue
                text = path.read_bytes().decode("utf-8")
            except (OSError, UnicodeDecodeError):
                continue
            if _match_text(text):
                results.append(_entry(path))
    return results


def _check_space(dst_dir: Path, needed: int) -> None:
    try:
        free = shutil.disk_usage(dst_dir).free
    except OSError:
        return  # cannot determine: let the write itself fail honestly
    if needed > free:
        raise InsufficientStorageError(
            f"Need {needed} bytes but only {free} free in {dst_dir}")


def _check_writable(path: Path) -> None:
    parent = path.parent if path.parent != Path("") else Path(".")
    if not os.access(parent, os.W_OK):
        raise PermissionDeniedError(f"Directory not writable: {parent}")
    if path.exists() and not os.access(path, os.W_OK):
        raise ReadOnlyError(f"File is read-only: {path}")


def _size_of(src: Path) -> int:
    if src.is_dir():
        return sum(p.stat().st_size for p in src.rglob("*") if p.is_file())
    return src.stat().st_size


def copy(src: str | Path, dst: str | Path, *,
         policy: ConflictPolicy = "error",
         max_bytes: int = DEFAULT_MAX_FILE_BYTES) -> Path | None:
    """Copy a file or directory. Returns the destination used, or None on skip."""
    src, dst = Path(src), Path(dst)
    if not src.exists() and not src.is_symlink():
        raise NotFoundError(f"Source not found: {src}")
    if src.is_symlink():
        raise UnsafePathError(f"Refusing to copy a symlink (no target surprise): {src}")
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
    try:
        if src.is_dir():
            shutil.copytree(src, final)
        else:
            shutil.copy2(src, final)
    except OSError as exc:
        raise wrap_os_error(exc, str(final)) from exc
    return final


def move(src: str | Path, dst: str | Path, *,
         policy: ConflictPolicy = "error") -> Path | None:
    """Move a file or directory. Returns the destination used, or None on skip."""
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
    try:
        shutil.move(str(src), str(final))
    except OSError as exc:
        raise wrap_os_error(exc, str(final)) from exc
    return final


def rename(path: str | Path, new_name: str, *,
           policy: ConflictPolicy = "error") -> Path | None:
    """Rename within the same directory. Returns the new path, or None on skip."""
    path = Path(path)
    if not path.exists() and not path.is_symlink():
        raise NotFoundError(f"Not found: {path}")
    validate_name(new_name)
    final = resolve_conflict(path.with_name(new_name), policy)
    if final is None:
        return None
    try:
        os.rename(path, final)
    except OSError as exc:
        raise wrap_os_error(exc, str(final)) from exc
    return final


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
                 policy: ConflictPolicy = "overwrite") -> Path:
    """Write ``data`` atomically: temp file in the same dir + os.replace.

    Policy "error" refuses to replace an existing file; "overwrite" is the
    normal save path (an explicit user save, not a silent overwrite from a
    copy). The temp file is removed on failure.
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
    _check_space(path.parent, len(data))
    _check_writable(path)
    fd, tmp_name = tempfile.mkstemp(prefix=f".{path.name}.", dir=str(path.parent))
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
