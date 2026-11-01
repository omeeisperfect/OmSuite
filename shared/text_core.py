"""Text / document engine (reference implementation, Python stdlib only).

Formats actually implemented and tested here:
- TXT / MD: plain text, read + write.
- JSON: validation + pretty-print / minify.
- XML: well-formedness validation + pretty-print (ElementTree).
- YAML: a SMALL documented subset (see yaml_load / yaml_dump limits).
  Full YAML (anchors, tags, multi-document, block scalars) is NOT
  implemented — yaml_load raises MalformedInputError on those constructs
  instead of silently mis-parsing them.

NOT implemented: DOCX / XLSX / PPTX / PDF / EPUB (no verified engine here).

Preservation rules:
- Encoding: UTF-8 (with or without BOM) is detected; anything else falls
  back to latin-1 ONLY for reading, and the detected encoding is reported
  so a write-back can warn. Writes default to UTF-8 without BOM unless the
  original document had a BOM (then it is preserved).
- Line endings: the document's dominant newline (\\n, \\r\\n, or \\r) is
  detected and preserved on write-back unless the caller overrides it.
  Mixed endings are reported in ``warnings``.
- Nothing here executes content: no macros, no scripts. ``html_escape``
  exists so app preview renderers can show text safely without script
  execution; engines themselves never render HTML.
"""

from __future__ import annotations

import html
import json
import re
import xml.etree.ElementTree as ET
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from errors import (
    MalformedInputError,
    NotFoundError,
    OversizedInputError,
    wrap_os_error,
)
from file_core import atomic_write, read_bytes_capped

DEFAULT_MAX_TEXT_BYTES = 50 * 1024 * 1024  # 50 MiB


@dataclass
class Document:
    text: str
    encoding: str  # "utf-8", "utf-8-sig", or "latin-1" (fallback, lossy flag)
    newline: str  # "\n", "\r\n", "\r", or "" (no newlines in document)
    had_bom: bool
    warnings: list[str] = field(default_factory=list)


def _detect_newline(raw: bytes) -> tuple[str, bool]:
    """Return (dominant newline, mixed?)."""
    crlf = raw.count(b"\r\n")
    lone_lf = raw.count(b"\n") - crlf
    lone_cr = raw.count(b"\r") - crlf
    counts = {"\r\n": crlf, "\n": lone_lf, "\r": lone_cr}
    nonzero = {k: v for k, v in counts.items() if v}
    if not nonzero:
        return "", False
    dominant = max(nonzero, key=lambda k: nonzero[k])
    return dominant, len(nonzero) > 1


def read_text(path: str | Path, *,
              max_bytes: int = DEFAULT_MAX_TEXT_BYTES) -> Document:
    """Read a text file, detecting BOM, encoding and line endings."""
    path = Path(path)
    raw = read_bytes_capped(path, max_bytes=max_bytes)
    if b"\x00" in raw:
        raise MalformedInputError(f"File looks binary (NUL byte), not text: {path}")
    warnings: list[str] = []
    if raw.startswith(b"\xef\xbb\xbf"):
        encoding, had_bom = "utf-8-sig", True
        text = raw.decode("utf-8-sig")
    else:
        had_bom = False
        try:
            text = raw.decode("utf-8")
            encoding = "utf-8"
        except UnicodeDecodeError:
            text = raw.decode("latin-1")
            encoding = "latin-1"
            warnings.append("Not valid UTF-8; read as latin-1 (write-back as "
                            "UTF-8 may change bytes — re-encode explicitly).")
    newline, mixed = _detect_newline(raw)
    if mixed:
        warnings.append(f"Mixed line endings detected; dominant is {newline!r}.")
    return Document(text=text, encoding=encoding, newline=newline,
                    had_bom=had_bom, warnings=warnings)


def write_text(path: str | Path, doc: Document | str, *,
               encoding: str | None = None,
               newline: str | None = None,
               policy: str = "overwrite") -> Path:
    """Write text, preserving the original BOM / newline unless overridden.

    ``doc`` may be a raw string (UTF-8, LF) or a Document from read_text.
    """
    if isinstance(doc, str):
        text, enc, nl, bom = doc, "utf-8", "\n", False
    else:
        text, enc, nl, bom = doc.text, doc.encoding, doc.newline, doc.had_bom
    enc = encoding or enc
    nl = newline if newline is not None else (nl or "\n")
    if nl not in ("\n", "\r\n", "\r"):
        raise MalformedInputError(f"Invalid newline style: {nl!r}")
    # Normalize to LF first, then convert to the target style.
    normalized = text.replace("\r\n", "\n").replace("\r", "\n")
    out_text = normalized.replace("\n", nl) if nl != "\n" else normalized
    raw = out_text.encode("utf-8-sig" if bom and enc.startswith("utf-8") else enc,
                          errors="strict") if enc != "latin-1" else out_text.encode("latin-1")
    return atomic_write(path, raw, policy=policy)  # type: ignore[arg-type]


# ---------------------------------------------------------------- JSON ----

def validate_json(text: str) -> Any:
    """Parse JSON. Returns the value; raises MalformedInputError on failure."""
    try:
        return json.loads(text)
    except json.JSONDecodeError as exc:
        raise MalformedInputError(f"Invalid JSON at line {exc.lineno}, "
                                  f"column {exc.colno}: {exc.msg}") from exc


def format_json(text: str, *, indent: int = 2, sort_keys: bool = False,
                minify: bool = False) -> tuple[str, list[str]]:
    """Validate + reformat JSON. Returns (formatted_text, warnings).

    Warnings: duplicate object keys are reported (the LAST value wins, per
    the JSON parser — data is lost, so the caller must surface this).
    """
    warnings = _duplicate_key_warnings(text)
    value = validate_json(text)
    if minify:
        return json.dumps(value, ensure_ascii=False, separators=(",", ":"), sort_keys=sort_keys), warnings
    return (json.dumps(value, ensure_ascii=False, indent=indent, sort_keys=sort_keys) + "\n",
            warnings)


def _duplicate_key_warnings(text: str) -> list[str]:
    warnings: list[str] = []

    def hook(pairs):
        seen: set[str] = set()
        for key, _ in pairs:
            if key in seen:
                warnings.append(f"Duplicate key {key!r}: earlier value discarded.")
            seen.add(key)
        return dict(pairs)

    try:
        json.loads(text, object_pairs_hook=hook)
    except json.JSONDecodeError:
        pass  # validate_json reports the real error
    return warnings


# ----------------------------------------------------------------- XML ----

def validate_xml(text: str) -> ET.Element:
    """Parse XML. Returns the root element; raises MalformedInputError."""
    try:
        return ET.fromstring(text)
    except ET.ParseError as exc:
        raise MalformedInputError(f"Invalid XML: {exc}") from exc


def format_xml(text: str) -> tuple[str, list[str]]:
    """Validate + pretty-print XML. Returns (formatted, warnings).

    Fidelity limit: ElementTree re-serialization DROPS comments,
    processing instructions and the original DOCTYPE. The warning says so;
    apps must not use this as a lossless round-trip for such documents.
    """
    root = validate_xml(text)
    ET.indent(root, space="  ")
    warnings = []
    if "<!--" in text or "<?" in text and not text.lstrip().startswith("<?xml"):
        warnings.append("Comments / processing instructions are dropped by XML re-serialization.")
    if "<!DOCTYPE" in text:
        warnings.append("DOCTYPE is dropped by XML re-serialization.")
    return ET.tostring(root, encoding="unicode") + "\n", warnings


# ---------------------------------------------------------------- YAML ----

_YAML_FORBIDDEN = ("&", "*", "!", "|", ">", "%", "---", "...")


def _yaml_scalar(token: str) -> Any:
    token = token.strip()
    if token in ("", "~", "null", "Null", "NULL"):
        return None
    if token in ("true", "True", "TRUE"):
        return True
    if token in ("false", "False", "FALSE"):
        return False
    if len(token) >= 2 and token[0] == token[-1] and token[0] in ("'", '"'):
        try:
            return json.loads(token) if token[0] == '"' else token[1:-1]
        except json.JSONDecodeError:
            return token[1:-1]
    if re.fullmatch(r"-?\d+", token):
        return int(token)
    if re.fullmatch(r"-?\d+\.\d+([eE][+-]?\d+)?", token):
        return float(token)
    return token


def _strip_yaml_comment(line: str) -> str:
    """Remove a ' # comment' outside quotes (best effort for the subset)."""
    in_single = in_double = False
    for i, ch in enumerate(line):
        if ch == "'" and not in_double:
            in_single = not in_single
        elif ch == '"' and not in_single:
            in_double = not in_double
        elif ch == "#" and not in_single and not in_double and i > 0 and line[i - 1] == " ":
            return line[:i].rstrip()
    return line.rstrip()


def yaml_load(text: str) -> Any:
    """Parse the supported YAML subset. Raises MalformedInputError otherwise.

    Supported: block mappings (nested by 2-space indent), block sequences
    of scalars / single-key mappings, plain / single- / double-quoted
    scalars, ints, floats, bools, null, comments, and a top-level mapping,
    sequence, or scalar.
    NOT supported (explicit error, never silent mis-parse): anchors,
    aliases, tags, multi-document files, block scalars (|, >), flow
    collections ({...}, [...]), complex keys (? key).
    """
    lines: list[tuple[int, str]] = []
    for raw in text.splitlines():
        if not raw.strip() or raw.strip().startswith("#"):
            continue
        stripped = _strip_yaml_comment(raw)
        if not stripped.strip():
            continue
        indent = len(stripped) - len(stripped.lstrip(" "))
        if indent % 2 != 0:
            raise MalformedInputError(f"YAML indent must be a multiple of 2 spaces: {raw!r}")
        content = stripped.strip()
        first = content.split()[0] if content.split() else ""
        if content in ("---", "...") or content.startswith("%"):
            raise MalformedInputError("Multi-document YAML is not supported.")
        if content.startswith(("&", "*", "!", "?", "|", ">")) or content.endswith(("|", ">")) \
                or re.search(r"[:\s][&*!][\w]", content) or "{" in content or "[" in content:
            raise MalformedInputError(f"Unsupported YAML construct: {content!r}")
        lines.append((indent, content))
    if not lines:
        return None
    pos = 0

    def parse_block(indent: int) -> Any:
        nonlocal pos
        if lines[pos][1].startswith("- ") or lines[pos][1] == "-":
            return parse_seq(indent)
        if lines[pos][1].startswith(('"', "'")):
            value = _yaml_scalar(lines[pos][1])
            pos += 1
            return value
        if ":" in lines[pos][1] and not lines[pos][1].startswith(("- ",)):
            return parse_map(indent)
        value = _yaml_scalar(lines[pos][1])
        pos += 1
        return value

    def parse_map(indent: int) -> dict:
        nonlocal pos
        out: dict[str, Any] = {}
        while pos < len(lines) and lines[pos][0] == indent and not lines[pos][1].startswith("- "):
            quoted = re.match(r"""^(['"])(.*?)\1:\s*(.*)$""", lines[pos][1])
            if quoted:
                key, rest = quoted.group(2), quoted.group(3)
            else:
                key, _, rest = lines[pos][1].partition(":")
                key = key.strip()
            if not key:
                raise MalformedInputError(f"Empty YAML key at: {lines[pos][1]!r}")
            if key in out:
                raise MalformedInputError(f"Duplicate YAML key: {key!r}")
            rest = rest.strip()
            pos += 1
            if rest:
                out[key] = _yaml_scalar(rest)
            elif pos < len(lines) and lines[pos][0] > indent:
                out[key] = parse_block(lines[pos][0])
            else:
                out[key] = None
        return out

    def parse_seq(indent: int) -> list:
        nonlocal pos
        out: list[Any] = []
        while pos < len(lines) and lines[pos][0] == indent and lines[pos][1].startswith("-"):
            item = lines[pos][1][1:].strip()
            if not item:
                pos += 1
                if pos < len(lines) and lines[pos][0] > indent:
                    out.append(parse_block(lines[pos][0]))
                else:
                    out.append(None)
            elif ":" in item and not item.startswith(('"', "'")):
                # "- key: value" becomes a one-key mapping; rewrite in place.
                lines[pos] = (indent + 2, item)
                out.append(parse_map(indent + 2))
            else:
                out.append(_yaml_scalar(item))
                pos += 1
        return out

    result = parse_block(lines[0][0])
    if pos != len(lines):
        raise MalformedInputError("YAML structure error: leftover lines after parse.")
    return result


def _yaml_dump_scalar(value: Any) -> str:
    if value is None:
        return "null"
    if value is True:
        return "true"
    if value is False:
        return "false"
    if isinstance(value, (int, float)):
        return repr(value)
    text = str(value)
    if text == "" or re.search(r"[:#\n]|^\s|\s$|^- ", text) or text in ("true", "false", "null", "~"):
        return json.dumps(text, ensure_ascii=False)
    return text


def yaml_dump(value: Any, indent: int = 0) -> str:
    """Serialize to the supported YAML subset (2-space indent)."""
    pad = " " * indent
    if isinstance(value, dict):
        if not value:
            return pad + "{}\n"
        out = ""
        for key, val in value.items():
            if isinstance(val, (dict, list)) and val:
                out += f"{pad}{key}:\n" + yaml_dump(val, indent + 2)
            elif isinstance(val, list) and not val:
                out += f"{pad}{key}: []\n"
            elif isinstance(val, dict) and not val:
                out += f"{pad}{key}: {{}}\n"
            else:
                out += f"{pad}{key}: {_yaml_dump_scalar(val)}\n"
        return out
    if isinstance(value, list):
        if not value:
            return pad + "[]\n"
        out = ""
        for item in value:
            if isinstance(item, (dict, list)) and item:
                dumped = yaml_dump(item, indent + 2).lstrip()
                out += f"{pad}- {dumped}"
            else:
                out += f"{pad}- {_yaml_dump_scalar(item)}\n"
        return out
    return pad + _yaml_dump_scalar(value) + "\n"


# ------------------------------------------------------------- previews ----

def html_escape(text: str) -> str:
    """Escape text for safe display in an HTML preview (no script execution)."""
    return html.escape(text, quote=True)


def preview_text(path: str | Path, *, max_chars: int = 10_000) -> str:
    """Return the first ``max_chars`` characters of a text file, unexecuted."""
    doc = read_text(path, max_bytes=DEFAULT_MAX_TEXT_BYTES)
    text = doc.text
    if len(text) > max_chars:
        return text[:max_chars] + f"\n… [truncated, file has {len(text)} chars]"
    return text
