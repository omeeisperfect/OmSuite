"""Conversion engine (reference implementation, Python stdlib only).

ONLY the conversions below are implemented and tested. Each function
returns ``(output_text, warnings)``; warnings describe fidelity loss and
must be shown to the user — a conversion that silently drops data is a
bug, not a feature.

Implemented:
1. txt_to_md / md_to_txt
2. json_pretty / json_minify (via text_core)
3. csv_to_json / json_to_csv
4. csv_to_md_table / md_table_to_csv

NOT implemented (no verified engine here): DOCX / XLSX / PPTX / PDF /
EPUB / image / audio / video conversion, OCR. See STATUS.md.
"""

from __future__ import annotations

import csv
import io
import json
import re

from errors import MalformedInputError
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
