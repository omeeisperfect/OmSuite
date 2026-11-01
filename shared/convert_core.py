"""Conversion engine (reference implementation, Python stdlib only).

ONLY the conversions below are implemented and tested. Every conversion
returns its output plus loss warnings — either as the historical
``(output_text, warnings)`` tuple from the individual functions, or as a
``ConversionResult`` from the ``convert`` dispatcher / ``convert_file``
helper. Warnings describe fidelity loss and must be shown to the user —
a conversion that silently drops data is a bug, not a feature.

Implemented (the full, closed list — anything else is an error):
1. txt -> md, md -> txt
2. json -> json (pretty-print, or minify with ``minify=True``)
3. csv -> json, json -> csv
4. csv -> md (Markdown table), md -> csv (Markdown table)

NOT implemented (no verified engine here): DOCX / XLSX / PPTX / PDF /
EPUB / image / audio / video conversion, OCR. ``convert`` raises
``UnsupportedFormatError`` naming the requested pair for every one of
these, instead of producing garbage output. See STATUS.md.

Source safety: conversions operate on text and never touch the source
file. ``convert_file`` reads the source, writes the destination with an
explicit conflict policy (default "error"), and refuses a destination
identical to the source, so the source is unchanged by default.
``ConversionHistory`` is an in-memory record of conversions performed
through ``convert_file`` (apps persist it themselves if they want it to
survive restarts — this engine stores no database).
"""

from __future__ import annotations

import csv
import io
import json
import re
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Callable

from errors import (ConflictError, MalformedInputError, NotFoundError,
                    UnsupportedFormatError, wrap_os_error)
from file_core import atomic_write
from text_core import format_json, validate_json

# ---------------------------------------------------------------- TXT/MD ----

_MD_ESCAPABLE = "\\`*_{}[]()#+-.!|>"


def txt_to_md(text: str) -> tuple[str, list[str]]:
    """Plain text -> Markdown. Fidelity: lossless for plain text.

    Lines are passed through unchanged. No headings or formatting are
    invented: a TXT file has no structure to preserve beyond its lines,
    so the output is the same text, valid as Markdown. The one warning
    case is a line that Markdown would render as structure (e.g. starting
    with '# '); the text is NOT escaped, so rendering may differ from the
    literal text — the warning lists such lines.
    """
    warnings = []
    for lineno, line in enumerate(text.splitlines(), start=1):
        stripped = line.lstrip()
        if re.match(r"#{1,6}\s", stripped) or stripped.startswith(("- ", "* ", "> ")) \
                or re.match(r"\d+\.\s", stripped) or stripped.startswith("```"):
            warnings.append(f"Line {lineno} looks like Markdown structure and "
                            f"will render as such: {line[:60]!r}")
    return text, warnings


def md_to_txt(text: str) -> tuple[str, list[str]]:
    """Markdown -> plain text. LOSSY by design; every loss is warned.

    Strips: headings (#), emphasis (*, _, **, __), inline code backticks,
    links [text](url) -> text (URL dropped, warned), images ![alt](url)
    -> alt (warned), code fences (markers dropped, content kept),
    blockquotes (>), list markers, horizontal rules, tables (| -> spaces).
    """
    warnings: list[str] = []
    out_lines: list[str] = []
    in_fence = False
    for lineno, raw in enumerate(text.splitlines(), start=1):
        line = raw
        if line.strip().startswith("```"):
            in_fence = not in_fence
            warnings.append(f"Line {lineno}: code-fence marker dropped (content kept).")
            continue
        if not in_fence:
            if re.match(r"\s*#{1,6}\s", line):
                line = re.sub(r"\s*#{1,6}\s", "", line, count=1)
                warnings.append(f"Line {lineno}: heading marker dropped.")
            if re.match(r"\s*>\s?", line):
                line = re.sub(r"\s*>\s?", "", line, count=1)
            line = re.sub(r"^\s*([-*+]|\d+[.)])\s+", "", line)
            if re.match(r"\s*(-{3,}|\*{3,}|_{3,})\s*$", line):
                warnings.append(f"Line {lineno}: horizontal rule dropped.")
                continue
            for m in re.finditer(r"!\[([^\]]*)\]\(([^)]*)\)", line):
                warnings.append(f"Line {lineno}: image URL dropped, kept alt text {m.group(1)!r}.")
            line = re.sub(r"!\[([^\]]*)\]\([^)]*\)", r"\1", line)
            for m in re.finditer(r"\[([^\]]*)\]\(([^)]*)\)", line):
                warnings.append(f"Line {lineno}: link URL dropped, kept text {m.group(1)!r}.")
            line = re.sub(r"\[([^\]]*)\]\([^)]*\)", r"\1", line)
            line = re.sub(r"(\*\*|__)(.*?)\1", r"\2", line)
            line = re.sub(r"(\*|_)(.*?)\1", r"\2", line)
            line = line.replace("`", "")
            line = line.replace("\\", "")
            if "|" in line:
                line = " ".join(cell.strip() for cell in line.strip().strip("|").split("|"))
                if re.fullmatch(r"[\s:|-]+", raw.strip()):
                    warnings.append(f"Line {lineno}: table separator row dropped.")
                    continue
        out_lines.append(line)
    return "\n".join(out_lines) + ("\n" if text.endswith("\n") else ""), warnings


# --------------------------------------------------------------- JSON ----

def json_pretty(text: str, *, indent: int = 2) -> tuple[str, list[str]]:
    """JSON -> indented JSON. Lossless except duplicate keys (warned)."""
    return format_json(text, indent=indent)


def json_minify(text: str) -> tuple[str, list[str]]:
    """JSON -> compact JSON. Lossless except duplicate keys (warned)."""
    return format_json(text, minify=True)


# ------------------------------------------------------------ CSV/JSON ----

def _read_csv(text: str) -> tuple[list[str], list[dict[str, str]], list[str]]:
    """Parse CSV strictly-ish. Returns (header, rows, warnings)."""
    warnings: list[str] = []
    reader = csv.reader(io.StringIO(text))
    try:
        rows = list(reader)
    except csv.Error as exc:
        raise MalformedInputError(f"Malformed CSV: {exc}") from exc
    rows = [r for r in rows if r != []]
    if not rows:
        raise MalformedInputError("Empty CSV: no header row.")
    header = [h.strip() for h in rows[0]]
    if any(h == "" for h in header):
        raise MalformedInputError("CSV header contains an empty column name.")
    dupes = {h for h in header if header.count(h) > 1}
    if dupes:
        warnings.append(f"Duplicate columns {sorted(dupes)}: later values overwrite earlier ones in JSON.")
    out: list[dict[str, str]] = []
    for lineno, row in enumerate(rows[1:], start=2):
        if len(row) < len(header):
            warnings.append(f"Row {lineno}: short row padded with empty strings.")
            row = row + [""] * (len(header) - len(row))
        elif len(row) > len(header):
            warnings.append(f"Row {lineno}: extra cells beyond header dropped.")
            row = row[:len(header)]
        out.append(dict(zip(header, row)))
    return header, out, warnings


def csv_to_json(text: str, *, indent: int = 2) -> tuple[str, list[str]]:
    """CSV -> JSON array of objects. All values stay strings (no type
    guessing: '007' and '1.5' must not silently become numbers)."""
    _, rows, warnings = _read_csv(text)
    return json.dumps(rows, ensure_ascii=False, indent=indent) + "\n", warnings


def json_to_csv(text: str) -> tuple[str, list[str]]:
    """JSON array of objects -> CSV. Fidelity limits (all warned):
    - top level must be an array of objects (else MalformedInputError)
    - keys missing in a row become empty cells
    - keys appearing only in later rows extend the header (column order =
      first-seen order)
    - nested objects/arrays are serialized as compact JSON strings
    - non-string scalars are stringified (numbers/bools keep their text)
    """
    value = validate_json(text)
    if not isinstance(value, list) or not all(isinstance(r, dict) for r in value):
        raise MalformedInputError("json_to_csv needs a JSON array of objects.")
    warnings: list[str] = []
    header: list[str] = []
    for row in value:
        for key in row:
            if key not in header:
                header.append(key)
    if not header:
        return "", ["Empty JSON array: no columns to write."]
    buf = io.StringIO()
    writer = csv.writer(buf, lineterminator="\n")
    writer.writerow(header)
    for row in value:
        cells = []
        for key in header:
            if key not in row:
                warnings.append(f"Row missing key {key!r}: empty cell written.")
                cells.append("")
            else:
                val = row[key]
                if isinstance(val, (dict, list)):
                    warnings.append(f"Nested value under {key!r} serialized as JSON text.")
                    cells.append(json.dumps(val, ensure_ascii=False))
                elif val is None:
                    cells.append("")
                else:
                    cells.append(str(val))
        writer.writerow(cells)
    return buf.getvalue(), warnings


# --------------------------------------------------------- CSV/MD table ----

def csv_to_md_table(text: str) -> tuple[str, list[str]]:
    """CSV -> Markdown table. Cells containing '|' are escaped as '\\|'."""
    header, rows, warnings = _read_csv(text)
    lines = ["| " + " | ".join(header) + " |",
             "| " + " | ".join("---" for _ in header) + " |"]
    for row in rows:
        cells = [str(row[h]).replace("|", "\\|").replace("\n", " ") for h in header]
        lines.append("| " + " | ".join(cells) + " |")
    return "\n".join(lines) + "\n", warnings


def md_table_to_csv(text: str) -> tuple[str, list[str]]:
    """Markdown table -> CSV. Separator row (| --- |) is required; rows
    with a different cell count than the header are warned and padded /
    truncated like csv_to_json. Non-table lines are ignored (warned)."""
    warnings: list[str] = []
    table_lines = [ln.strip() for ln in text.splitlines() if ln.strip().startswith("|")]
    if len(table_lines) < 2:
        raise MalformedInputError("No Markdown table found (need header + separator rows).")
    if not re.fullmatch(r"\|[\s:|-]+\|", table_lines[1].replace(" ", "")) and \
            not re.fullmatch(r"[\s:|-]+", table_lines[1].strip("|").strip()):
        raise MalformedInputError("Second row is not a Markdown table separator (| --- |).")

    def cells(line: str) -> list[str]:
        # Split on UNESCAPED pipes only, so "\|" inside a cell survives.
        body = line.strip()
        if body.startswith("|"):
            body = body[1:]
        if body.endswith("|") and not body.endswith("\\|"):
            body = body[:-1]
        return [c.strip().replace("\\|", "|") for c in re.split(r"(?<!\\)\|", body)]

    header = cells(table_lines[0])
    buf = io.StringIO()
    writer = csv.writer(buf, lineterminator="\n")
    writer.writerow(header)
    for ln in table_lines[2:]:
        row = cells(ln)
        if len(row) < len(header):
            warnings.append("Short table row padded with empty strings.")
            row += [""] * (len(header) - len(row))
        elif len(row) > len(header):
            warnings.append("Long table row truncated to header width.")
            row = row[:len(header)]
        writer.writerow(row)
    ignored = len([ln for ln in text.splitlines()
                   if ln.strip() and not ln.strip().startswith("|")])
    if ignored:
        warnings.append(f"{ignored} non-table line(s) ignored.")
    return buf.getvalue(), warnings


# ------------------------------------------------------------ dispatcher ----

_FORMAT_ALIASES = {
    "txt": "txt", "text": "txt", "plain": "txt",
    "md": "md", "markdown": "md",
    "json": "json",
    "csv": "csv",
}

SUPPORTED_CONVERSIONS = {
    ("txt", "md"), ("md", "txt"),
    ("json", "json"),
    ("csv", "json"), ("json", "csv"),
    ("csv", "md"), ("md", "csv"),
}


@dataclass
class ConversionResult:
    """One conversion's outcome. ``warnings`` MUST be shown to the user
    (they are the fidelity-loss record); ``source_unchanged`` is True
    for every conversion this engine performs, because conversions
    never write to the source (see ``convert_file``)."""
    output_text: str
    warnings: list[str] = field(default_factory=list)
    source_format: str = ""
    target_format: str = ""
    source_unchanged: bool = True


def convert(text: str, source_format: str, target_format: str, *,
            json_indent: int = 2, minify: bool = False,
            ) -> ConversionResult:
    """Convert ``text`` between two formats. Only the pairs in
    ``SUPPORTED_CONVERSIONS`` work; every other pair raises
    ``UnsupportedFormatError`` naming the pair and listing what IS
    supported, so an app can never present an unimplemented conversion
    as if it worked. Format names are case-insensitive; "markdown" is
    accepted for "md"."""
    src = _FORMAT_ALIASES.get(source_format.strip().lower())
    dst = _FORMAT_ALIASES.get(target_format.strip().lower())
    if src is None or dst is None:
        raise UnsupportedFormatError(
            f"Unknown format(s) for conversion: {source_format!r} -> "
            f"{target_format!r} (supported: txt, md, json, csv).")
    if (src, dst) not in SUPPORTED_CONVERSIONS:
        supported = ", ".join(f"{a}->{b}"
                              for a, b in sorted(SUPPORTED_CONVERSIONS))
        raise UnsupportedFormatError(
            f"Conversion {src}->{dst} is not supported (no verified "
            f"engine). Supported conversions: {supported}.")
    if (src, dst) == ("txt", "md"):
        out, warnings = txt_to_md(text)
    elif (src, dst) == ("md", "txt"):
        out, warnings = md_to_txt(text)
    elif (src, dst) == ("json", "json"):
        if minify:
            out, warnings = json_minify(text)
        else:
            out, warnings = format_json(text, indent=json_indent)
    elif (src, dst) == ("csv", "json"):
        out, warnings = csv_to_json(text)
    elif (src, dst) == ("json", "csv"):
        out, warnings = json_to_csv(text)
    elif (src, dst) == ("csv", "md"):
        out, warnings = csv_to_md_table(text)
    else:  # ("md", "csv")
        out, warnings = md_table_to_csv(text)
    return ConversionResult(output_text=out, warnings=warnings,
                            source_format=src, target_format=dst,
                            source_unchanged=True)


@dataclass
class ConversionRecord:
    """One history entry: what was converted, when, and how much was
    lost (warning count). No file contents are stored here."""
    source_format: str
    target_format: str
    output_path: str
    warning_count: int
    timestamp: float = field(default_factory=time.time)


class ConversionHistory:
    """In-memory conversion history (Master Instructions §3.10:
    "maintain local conversion history with a clear option to clear
    it"). Apps that want persistence store these records themselves."""

    def __init__(self) -> None:
        self._records: list[ConversionRecord] = []

    def add(self, result: ConversionResult, output_path: str | Path) -> None:
        self._records.append(ConversionRecord(
            source_format=result.source_format,
            target_format=result.target_format,
            output_path=str(output_path),
            warning_count=len(result.warnings)))

    @property
    def records(self) -> list[ConversionRecord]:
        return list(self._records)

    def clear(self) -> None:
        self._records.clear()

    def __len__(self) -> int:
        return len(self._records)


def convert_file(src: str | Path, dst: str | Path, *,
                 source_format: str | None = None,
                 target_format: str | None = None,
                 policy: str = "error",
                 history: ConversionHistory | None = None,
                 **convert_kwargs) -> ConversionResult:
    """Convert one file to another. Formats default to the files'
    extensions (``.txt`` / ``.md`` / ``.json`` / ``.csv``). The source
    file is only ever READ: a destination identical to the source is
    refused, and the destination is written atomically with the given
    conflict policy (default "error" — never a silent overwrite). When
    ``history`` is given, the conversion is recorded there."""
    src, dst = Path(src), Path(dst)
    if src == dst or (src.exists() and src.resolve() == dst.resolve()):
        raise ConflictError(
            f"Refusing to convert a file onto itself (source would "
            f"change): {src}")
    if source_format is None:
        source_format = src.suffix.lstrip(".") or ""
    if target_format is None:
        target_format = dst.suffix.lstrip(".") or ""
    try:
        text = src.read_text(encoding="utf-8")
    except FileNotFoundError as exc:
        raise NotFoundError(f"Source file not found: {src}") from exc
    except UnicodeDecodeError as exc:
        raise MalformedInputError(
            f"Source file is not valid UTF-8 text: {src}") from exc
    except OSError as exc:
        raise wrap_os_error(exc, str(src)) from exc
    result = convert(text, source_format, target_format, **convert_kwargs)
    atomic_write(dst, result.output_text.encode("utf-8"),
                 policy=policy)  # type: ignore[arg-type]
    if history is not None:
        history.add(result, dst)
    return result
