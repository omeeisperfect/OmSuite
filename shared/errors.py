"""Shared error types for the OmSuite reference engines.

Every engine raises these (or a subclass) instead of returning a canned
"success" value. Callers on Android / Windows should map them to their own
user-visible messages; the ``code`` attribute is the stable contract.
"""

from __future__ import annotations


class OmSuiteError(Exception):
    """Base class. ``code`` is stable across languages; ``detail`` is free text."""

    code = "OMSUITE_ERROR"

    def __init__(self, message: str, detail: str = "") -> None:
        super().__init__(message)
        self.message = message
        self.detail = detail


class NotFoundError(OmSuiteError):
    code = "NOT_FOUND"


class AlreadyExistsError(OmSuiteError):
    code = "ALREADY_EXISTS"


class PermissionDeniedError(OmSuiteError):
    code = "PERMISSION_DENIED"


class ReadOnlyError(PermissionDeniedError):
    code = "READ_ONLY"


class InsufficientStorageError(OmSuiteError):
    code = "INSUFFICIENT_STORAGE"


class MalformedInputError(OmSuiteError):
    code = "MALFORMED_INPUT"


class OversizedInputError(OmSuiteError):
    code = "OVERSIZED_INPUT"


class UnsafePathError(OmSuiteError):
    code = "UNSAFE_PATH"


class ConflictError(OmSuiteError):
    code = "CONFLICT"


class UnsupportedFormatError(OmSuiteError):
    code = "UNSUPPORTED_FORMAT"


def wrap_os_error(exc: OSError, path: str = "") -> OmSuiteError:
    """Translate a stdlib OSError into the matching OmSuiteError."""
    import errno

    if isinstance(exc, FileNotFoundError):
        return NotFoundError(f"Not found: {path or exc.filename or ''}")
    if isinstance(exc, FileExistsError):
        return AlreadyExistsError(f"Already exists: {path or ''}")
    if isinstance(exc, PermissionError):
        return PermissionDeniedError(f"Permission denied: {path or ''}")
    if exc.errno == errno.ENOSPC:
        return InsufficientStorageError(f"Insufficient storage: {path or ''}")
    if exc.errno == errno.EROFS:
        return ReadOnlyError(f"Read-only filesystem: {path or ''}")
    return OmSuiteError(f"OS error ({exc.errno}): {exc.strerror or exc}", detail=str(exc))
