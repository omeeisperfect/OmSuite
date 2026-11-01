"""Best-effort PDF text extraction (reference implementation, stdlib only).

What it does: finds content streams in a PDF, decompresses ``FlateDecode``
streams with ``zlib``, and reads the ``Tj`` / ``TJ`` text-showing
operators (plus ``'`` and ``"``), decoding literal strings, hex strings
and common escapes.

What it does NOT do (do not claim it):
- Layout reconstruction: word/line order follows content-stream order,
  and spacing between runs is NOT reconstructed from positioning
  operators. ``Td``/``TD``/``T*`` insert a newline as a best-effort
  line break; ``TJ`` numeric adjustments are ignored.
- Font handling: no ``ToUnicode`` maps, no embedded-subset-font decoding.
  PDFs whose text uses custom encodings may yield garbled output, and
  scanned/image-only PDFs yield nothing (OCR is a separate, unbuilt
  engine). Object streams / xref streams are not parsed.
- Encrypted PDFs are not supported; their streams stay undecodable and
  are skipped.

Consequences for callers: a result of ``""`` means "no decodable text
found", not "the PDF is empty". Streams that fail to decompress are
skipped, never fatal. This engine never executes PDF content (no
JavaScript, no actions) — bytes are only decompressed and scanned.
"""

from __future__ import annotations

import re
import zlib
from pathlib import Path

from errors import NotFoundError, wrap_os_error

_STREAM_RE = re.compile(rb"stream(\r\n|\n|\r)")
_ENDSTREAM = b"endstream"


def _stream_dict(data: bytes, stream_start: int) -> bytes:
    """The ``<< ... >>`` dictionary immediately before a stream keyword."""
    end = data.rfind(b">>", 0, stream_start)
    start = data.rfind(b"<<", 0, end) if end != -1 else -1
    if start == -1 or end == -1:
        return b""
    return data[start:end + 2]


def _find_streams(data: bytes) -> list[bytes]:
    """Raw (still compressed) content-stream bodies."""
    streams: list[bytes] = []
    pos = 0
    while True:
        match = _STREAM_RE.search(data, pos)
        if not match:
            break
        body_start = match.end()
        end = data.find(_ENDSTREAM, body_start)
        if end == -1:
            break
        body = data[body_start:end]
        # The EOL before endstream is a delimiter, not stream data.
        if body.endswith(b"\r\n"):
            body = body[:-2]
        elif body.endswith(b"\n") or body.endswith(b"\r"):
            body = body[:-1]
        streams.append((data, match.start(), body))
        pos = end + len(_ENDSTREAM)
    return streams


def _decode_stream(data: bytes, dict_bytes: bytes) -> bytes | None:
    """Decompress if FlateDecode is declared; return None if undecodable."""
    if b"/FlateDecode" in dict_bytes or b"/Fl" in dict_bytes:
        try:
            return zlib.decompress(data)
        except zlib.error:
            try:
                return zlib.decompressobj().decompress(data)
            except zlib.error:
                return None
    return data


_ESCAPES = {ord("n"): b"\n", ord("r"): b"\r", ord("t"): b"\t",
            ord("b"): b"\b", ord("f"): b"\f",
            ord("("): b"(", ord(")"): b")", ord("\\"): b"\\"}


def _parse_literal(data: bytes, pos: int) -> tuple[bytes, int]:
    """Parse a ``(...)`` literal string starting at ``data[pos] == '('``.
    Returns ``(raw_bytes, next_pos)``; handles nesting and escapes."""
    assert data[pos:pos + 1] == b"("
    pos += 1
    depth = 1
    out = bytearray()
    while pos < len(data) and depth:
        ch = data[pos]
        if ch == 0x5C:  # backslash
            nxt = data[pos + 1:pos + 2]
            if nxt in (b"\n", b"\r"):
                # line continuation: backslash + EOL is ignored
                pos += 2
                if nxt == b"\r" and data[pos:pos + 1] == b"\n":
                    pos += 1
                continue
            if nxt and nxt in b"01234567":
                oct_digits = b""
                j = pos + 1
                while j < len(data) and len(oct_digits) < 3 and data[j:j + 1] in b"01234567":
                    oct_digits += data[j:j + 1]
                    j += 1
                out.append(int(oct_digits, 8) & 0xFF)
                pos = j
                continue
            if nxt:
                out.extend(_ESCAPES.get(nxt[0], nxt))
                pos += 2
                continue
            pos += 1
            continue
        if ch == 0x28:  # (
            depth += 1
            out.append(ch)
            pos += 1
            continue
        if ch == 0x29:  # )
            depth -= 1
            if depth:
                out.append(ch)
            pos += 1
            continue
        out.append(ch)
        pos += 1
    return bytes(out), pos


def _parse_hex(data: bytes, pos: int) -> tuple[bytes, int]:
    """Parse a ``<hex>`` string; a ``<`` starting ``<<`` is a dict, not
    a string, and must never reach here."""
    end = data.find(b">", pos)
    if end == -1:
        return b"", len(data)
    hex_text = re.sub(rb"[^0-9A-Fa-f]", b"", data[pos + 1:end])
    if len(hex_text) % 2:
        hex_text += b"0"
    try:
        return bytes.fromhex(hex_text.decode("ascii")), end + 1
    except ValueError:
        return b"", end + 1


def _decode_text_bytes(raw: bytes) -> str:
    """PDF text bytes -> str. A UTF-16BE BOM means UTF-16BE text;
    otherwise latin-1 preserves every byte (glyph mapping is a font
    concern this engine does not solve — see module docstring)."""
    if raw.startswith(b"\xfe\xff"):
        return raw[2:].decode("utf-16-be", errors="replace")
    if raw.startswith(b"\xff\xfe"):
        return raw[2:].decode("utf-16-le", errors="replace")
    return raw.decode("latin-1")


def _extract_from_content(content: bytes) -> str:
    """Scan one decompressed content stream for Tj / TJ / ' / " text."""
    fragments: list[str] = []
    pending: list[str] = []  # strings since the last showing operator
    pos = 0
    n = len(content)
    while pos < n:
        ch = content[pos:pos + 1]
        if ch == b"(":
            raw, pos = _parse_literal(content, pos)
            pending.append(_decode_text_bytes(raw))
            continue
        if ch == b"<" and content[pos:pos + 2] != b"<<":
            raw, pos = _parse_hex(content, pos)
            pending.append(_decode_text_bytes(raw))
            continue
        if ch == b"%":
            # comment runs to end of line
            end = content.find(b"\n", pos)
            pos = n if end == -1 else end + 1
            continue
        # Operators: check longest first where prefixes collide.
        rest = content[pos:]
        if rest.startswith(b"TJ") and not rest[2:3].isalnum():
            fragments.append("".join(pending))
            pending = []
            pos += 2
            continue
        if rest.startswith(b"Tj") and not rest[2:3].isalnum():
            fragments.append("".join(pending))
            pending = []
            pos += 2
            continue
        if rest.startswith(b"TD") and not rest[2:3].isalnum():
            fragments.append("\n")
            pending = []
            pos += 2
            continue
        if rest.startswith(b"Td") and not rest[2:3].isalnum():
            fragments.append("\n")
            pending = []
            pos += 2
            continue
        if rest.startswith(b"T*") and not rest[2:3].isalnum():
            fragments.append("\n")
            pending = []
            pos += 2
            continue
        if ch in (b"'", b'"'):
            fragments.append("".join(pending))
            fragments.append("\n")
            pending = []
            pos += 1
            continue
        pos += 1
    # A trailing string with no operator is not shown text: drop it.
    return "".join(fragments)


def extract_parts_from_bytes(data: bytes) -> list[str]:
    """One text part per decodable content stream, in file order.
    Undecodable streams are skipped. Empty parts are kept out."""
    parts: list[str] = []
    for full, start, body in _find_streams(data):
        decoded = _decode_stream(body, _stream_dict(full, start))
        if decoded is None:
            continue
        text = _extract_from_content(decoded)
        if text:
            parts.append(text)
    return parts


def extract_text_from_bytes(data: bytes) -> str:
    """Best-effort full text: stream parts joined with newlines."""
    return "\n".join(extract_parts_from_bytes(data))


def extract_text(path: str | Path) -> str:
    """Best-effort text of a PDF file. See module docstring for limits."""
    path = Path(path)
    if not path.exists():
        raise NotFoundError(f"PDF not found: {path}")
    try:
        data = path.read_bytes()
    except OSError as exc:
        raise wrap_os_error(exc, str(path)) from exc
    return extract_text_from_bytes(data)
