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

Also in this module (added in the correction pass):
- ``markdown_to_html``: a small SAFE subset — headings, paragraphs,
  bold/italic, inline code, fenced code, lists, blockquotes, rules,
  simple tables, links and images. Safety first: user text is HTML-
  escaped BEFORE any markup is applied, so embedded ``<script>`` can
  only ever render as visible text; links with dangerous schemes
  (``javascript:``, ``data:``, ...) are rendered as plain text with a
  warning. This is a preview renderer, not a full Markdown engine
  (no nested lists, no reference links, no raw-HTML passthrough).
- ``tokenize_code``: a display-only tokenizer (comments, strings,
  numbers, keywords, identifiers, operators) plus ``tokens_to_html``
  for safe preview rendering. It is a highlighter heuristic, NOT a
  parser: it never executes code and it does not validate syntax.

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


# ------------------------------------------------------- Markdown -> HTML ----

DEFAULT_MAX_MD_CHARS = 1_000_000
_SAFE_LINK_SCHEMES = {"http", "https", "mailto"}
_UNSAFE_SCHEME_RE = re.compile(r"^\s*([A-Za-z][A-Za-z0-9+.-]*):")


def _safe_href(url: str) -> bool:
    """True for relative / anchor / http(s) / mailto links. Any other
    scheme (javascript:, data:, vbscript:, file:, ...) is unsafe in a
    preview and must be rendered as plain text instead."""
    match = _UNSAFE_SCHEME_RE.match(url)
    if not match:
        return True
    return match.group(1).lower() in _SAFE_LINK_SCHEMES


def _inline_html(chunk: str, warnings: list[str]) -> str:
    """Inline Markdown inside ONE already-escaped chunk of text.

    The chunk is escaped first (by the caller), so this function only
    ever ADDS the known-safe tags below — it can never turn user input
    into a script tag. Order matters: code spans first (their contents
    must not be link/bold-processed), then images, links, bold, italic.
    """
    out = html.escape(chunk, quote=True)
    # Code spans: `...` (content already escaped, kept verbatim).
    out = re.sub(r"`([^`\n]+)`", r"<code>\1</code>", out)
    # Images: ![alt](url) — unsafe URLs become plain alt text.
    # NOTE: the URL is captured from already-escaped text, so unescape
    # it once before re-escaping — otherwise "&" would double-escape
    # into "&amp;amp;" in the href.
    def _image(match: re.Match) -> str:
        alt, url = match.group(1), html.unescape(match.group(2))
        if not _safe_href(url):
            warnings.append(f"Unsafe image URL scheme dropped: {url[:40]!r}")
            return alt
        return (f'<img src="{html.escape(url, quote=True)}" '
                f'alt="{alt}">')
    # URL pattern allows ONE level of balanced parens, so a URL like
    # javascript:alert(1) is captured whole (and refused whole) instead
    # of being cut at the inner ")".
    _url = r"\(([^()]*(?:\([^()]*\)[^()]*)*)\)"
    out = re.sub(r"!\[([^\]]*)\]" + _url, _image, out)
    # Links: [text](url) — unsafe URLs become plain text.
    def _link(match: re.Match) -> str:
        label, url = match.group(1), html.unescape(match.group(2))
        if not _safe_href(url):
            warnings.append(f"Unsafe link URL scheme dropped: {url[:40]!r}")
            return label
        return f'<a href="{html.escape(url, quote=True)}">{label}</a>'
    out = re.sub(r"\[([^\]]*)\]" + _url, _link, out)
    # Bold, then italic (word-guarded so snake_case is not mangled).
    out = re.sub(r"(\*\*|__)(.+?)\1", r"<strong>\2</strong>", out)
    out = re.sub(r"(?<!\w)(\*|_)([^*_]+?)\1(?!\w)", r"<em>\2</em>", out)
    return out


def _md_table_cells(line: str) -> list[str]:
    body = line.strip()
    if body.startswith("|"):
        body = body[1:]
    if body.endswith("|") and not body.endswith("\\|"):
        body = body[:-1]
    return [c.strip().replace("\\|", "|")
            for c in re.split(r"(?<!\\)\|", body)]


def _is_separator_row(line: str) -> bool:
    cells = _md_table_cells(line)
    return bool(cells) and all(
        re.fullmatch(r":?-{3,}:?", c) for c in cells)


def markdown_to_html(text: str, *,
                     max_chars: int = DEFAULT_MAX_MD_CHARS
                     ) -> tuple[str, list[str]]:
    """Render the safe Markdown subset to HTML. Returns ``(html,
    warnings)``. Empty input renders as ``""``. Binary input (NUL) and
    oversize input are errors, never silently rendered. Warnings cover
    dropped unsafe URLs and unclosed code fences; nested lists,
    reference links and raw HTML are NOT supported (raw HTML in the
    input is escaped and shown as text — that is the safety rule, not
    a bug)."""
    if "\x00" in text:
        raise MalformedInputError("Markdown input looks binary (NUL byte).")
    if len(text) > max_chars:
        raise OversizedInputError(
            f"Markdown input {len(text)} chars exceeds limit {max_chars}")
    warnings: list[str] = []
    lines = text.splitlines()
    blocks: list[str] = []
    i = 0
    while i < len(lines):
        line = lines[i]
        stripped = line.strip()
        if not stripped:
            i += 1
            continue
        if stripped.startswith("```"):
            # Fenced code block (language tag ignored, content escaped).
            fence_lines = []
            i += 1
            closed = False
            while i < len(lines):
                if lines[i].strip().startswith("```"):
                    closed = True
                    i += 1
                    break
                fence_lines.append(lines[i])
                i += 1
            if not closed:
                warnings.append("Unclosed code fence: rest of document "
                                "treated as code.")
            code = html.escape("\n".join(fence_lines), quote=True)
            blocks.append(f"<pre><code>{code}</code></pre>")
            continue
        heading = re.match(r"^(#{1,6})\s+(.*)$", stripped)
        if heading:
            level = len(heading.group(1))
            blocks.append(f"<h{level}>"
                          f"{_inline_html(heading.group(2), warnings)}</h{level}>")
            i += 1
            continue
        if re.fullmatch(r"(-{3,}|\*{3,}|_{3,})", stripped):
            blocks.append("<hr>")
            i += 1
            continue
        if stripped.startswith(">"):
            quote_lines = []
            while i < len(lines) and lines[i].strip().startswith(">"):
                quote_lines.append(re.sub(r"^>\s?", "", lines[i].strip()))
                i += 1
            inner = "<br>".join(_inline_html(q, warnings)
                                for q in quote_lines)
            blocks.append(f"<blockquote>{inner}</blockquote>")
            continue
        list_match = re.match(r"^\s*([-*+]|\d+[.)])\s+(.*)$", line)
        if list_match:
            ordered = bool(re.match(r"\d+[.)]", list_match.group(1)))
            tag = "ol" if ordered else "ul"
            items = []
            while i < len(lines):
                m = re.match(r"^\s*([-*+]|\d+[.)])\s+(.*)$", lines[i])
                if not m:
                    break
                if bool(re.match(r"\d+[.)]", m.group(1))) != ordered:
                    break
                items.append(_inline_html(m.group(2), warnings))
                i += 1
            blocks.append(f"<{tag}>" + "".join(f"<li>{it}</li>"
                                               for it in items) + f"</{tag}>")
            continue
        if stripped.startswith("|"):
            # Simple table: header row + separator row + body rows.
            if i + 1 < len(lines) and _is_separator_row(lines[i + 1]):
                header = _md_table_cells(line)
                head = "".join(f"<th>{_inline_html(c, warnings)}</th>"
                               for c in header)
                rows = [f"<thead><tr>{head}</tr></thead>"]
                i += 2
                body_rows = []
                while i < len(lines) and lines[i].strip().startswith("|"):
                    cells = _md_table_cells(lines[i])
                    if len(cells) < len(header):
                        cells += [""] * (len(header) - len(cells))
                    cells = cells[:len(header)]
                    body_rows.append("<tr>" + "".join(
                        f"<td>{_inline_html(c, warnings)}</td>"
                        for c in cells) + "</tr>")
                    i += 1
                if body_rows:
                    rows.append("<tbody>" + "".join(body_rows) + "</tbody>")
                blocks.append("<table>" + "".join(rows) + "</table>")
                continue
            # A lone | line is not a table: fall through to paragraph.
        # Plain paragraph: consecutive plain lines joined with spaces.
        para_lines = []
        while i < len(lines):
            s = lines[i].strip()
            if not s or s.startswith(("```", "#", ">", "|")) or \
                    re.match(r"^\s*([-*+]|\d+[.)])\s+", lines[i]) or \
                    re.fullmatch(r"(-{3,}|\*{3,}|_{3,})", s):
                break
            para_lines.append(s)
            i += 1
        blocks.append(f"<p>{_inline_html(' '.join(para_lines), warnings)}</p>")
    return "\n".join(blocks), warnings


# ---------------------------------------------------------- code tokens ----

@dataclass
class Token:
    """One display token: ``kind`` is comment / string / number /
    keyword / identifier / whitespace / operator / other."""
    kind: str
    text: str


_CODE_KEYWORDS = {
    # Python / JS / C-family union, for display highlighting only.
    "and", "as", "assert", "async", "await", "break", "case", "catch",
    "class", "const", "continue", "default", "def", "del", "delete", "do",
    "elif", "else", "except", "export", "extends", "false", "finally",
    "for", "from", "function", "global", "if", "import", "in",
    "instanceof", "is", "lambda", "let", "new", "none", "nonlocal",
    "not", "null", "or", "pass", "raise", "return", "super", "switch",
    "this", "throw", "true", "try", "typeof", "var", "void", "while",
    "with", "yield", "True", "False", "None",
}

_TOKEN_RE = re.compile(r"""
    (?P<comment>\#[^\n]*|//[^\n]*)
    | (?P<string>"(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*'|`(?:\\.|[^`\\])*`)
    | (?P<number>\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)
    | (?P<identifier>[A-Za-z_][A-Za-z0-9_]*)
    | (?P<whitespace>\s+)
    | (?P<operator>[+\-*/%=<>!&|^~?:;,.()\[\]{}]+)
    | (?P<other>.)
""", re.VERBOSE)

DEFAULT_MAX_CODE_CHARS = 1_000_000


def tokenize_code(text: str, *,
                  max_chars: int = DEFAULT_MAX_CODE_CHARS) -> list[Token]:
    """Split code text into display tokens. This is a highlighting
    heuristic, NOT a parser: it does not validate syntax, understand
    nesting, or execute anything. Empty input yields ``[]``; binary
    (NUL) and oversize inputs are errors."""
    if "\x00" in text:
        raise MalformedInputError("Code input looks binary (NUL byte).")
    if len(text) > max_chars:
        raise OversizedInputError(
            f"Code input {len(text)} chars exceeds limit {max_chars}")
    tokens: list[Token] = []
    for match in _TOKEN_RE.finditer(text):
        kind = match.lastgroup or "other"
        value = match.group()
        if kind == "identifier" and value in _CODE_KEYWORDS:
            kind = "keyword"
        tokens.append(Token(kind=kind, text=value))
    return tokens


def tokens_to_html(tokens: list[Token]) -> str:
    """Render tokens as safe HTML: text escaped, non-whitespace tokens
    wrapped in ``<span class="tok-<kind>">``. Whitespace is left bare
    so ``<pre>`` rendering preserves layout."""
    parts = []
    for token in tokens:
        escaped = html.escape(token.text, quote=True)
        if token.kind == "whitespace":
            parts.append(escaped)
        else:
            parts.append(f'<span class="tok-{token.kind}">{escaped}</span>')
    return "".join(parts)
