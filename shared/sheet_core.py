"""Spreadsheet engine (reference implementation, Python stdlib only).

Supported, all tested:
- Cell addressing (A1 notation), typed values (numbers, booleans, text),
  formulas with ``+ - * /`` parentheses, cell references, ``SUM`` and
  ``AVERAGE`` over ranges (e.g. ``=SUM(A1:A5)``).
- Formula recalculation with cycle detection: ``recalculate()`` returns
  ``(values, errors)`` — a circular reference is reported in ``errors``
  and never hangs, and one bad cell never hides the other cells' values.
- CSV load / save round-trip (see fidelity note below).
- XLSX load / save (single sheet, minimal OOXML written with stdlib
  ``zipfile`` + ``xml`` only — see fidelity note below).

Fidelity notes (honest limits, apps must not claim more):
- CSV load stores every non-empty cell as text, except cells starting
  with ``=`` which are loaded as formulas. Numbers written to CSV come
  back as strings; formula evaluation coerces numeric strings, so
  ``=SUM(A1:A3)`` still computes after a CSV round-trip, but a cell
  that held the number ``5`` holds the string ``"5"`` after reloading.
  Text-level round-trip is exact: ``sheet_to_csv(sheet_from_csv(t)) == t``
  for well-formed CSV input.
- XLSX: one worksheet only (named ``Sheet1`` on write; only
  ``xl/worksheets/sheet1.xml`` is read). No styles, fonts, colours,
  merged cells, dates (dates are plain numbers), or multiple sheets.
  Formulas are preserved as text and recomputed by this engine; cached
  values written by other producers are ignored on read.
- Formulas support numbers only for arithmetic. A reference to a text
  cell inside ``+ - * /`` is an error; inside ``SUM``/``AVERAGE`` text
  and empty cells are ignored (spreadsheet convention). String literals
  in formulas (``="hi"``) are NOT supported. Dates, percentages,
  ``IF``/``VLOOKUP`` and every other function are NOT supported.

Errors use ``errors.py`` codes; circular references use code ``CYCLE``.
No network, no account, no side effects beyond the file functions.
"""

from __future__ import annotations

import csv
import io
import re
import zipfile
from pathlib import Path
from typing import Any
import xml.etree.ElementTree as ET

from errors import MalformedInputError, NotFoundError, OmSuiteError, wrap_os_error

MAX_COL = 16384  # XFD, as in common spreadsheets
MAX_ROW = 1048576

_CELL_RE = re.compile(r"^([A-Za-z]+)([0-9]+)$")


class FormulaError(OmSuiteError):
    """A formula that cannot be evaluated (parse error, bad reference,
    division by zero, ...). Code ``MALFORMED_INPUT``."""

    code = "MALFORMED_INPUT"


class CycleError(FormulaError):
    """A circular reference (A1 -> B1 -> A1, or a self-reference)."""

    code = "CYCLE"


# ------------------------------------------------------------- addressing ----

def col_to_index(letters: str) -> int:
    """Column letters (``A`` -> 1, ``Z`` -> 26, ``AA`` -> 27)."""
    letters = letters.upper()
    if not letters.isalpha():
        raise MalformedInputError(f"Invalid column letters: {letters!r}")
    index = 0
    for ch in letters:
        index = index * 26 + (ord(ch) - ord("A") + 1)
    if index > MAX_COL:
        raise MalformedInputError(f"Column {letters!r} exceeds {MAX_COL} (XFD).")
    return index


def index_to_col(index: int) -> str:
    """1-based column index -> letters (1 -> ``A``, 27 -> ``AA``)."""
    if index < 1 or index > MAX_COL:
        raise MalformedInputError(f"Column index out of range: {index}")
    letters = ""
    while index:
        index, rem = divmod(index - 1, 26)
        letters = chr(ord("A") + rem) + letters
    return letters


def parse_cell(ref: str) -> tuple[int, int]:
    """Parse an A1 reference -> ``(row, col)``, both 1-based."""
    match = _CELL_RE.match(ref.strip()) if isinstance(ref, str) else None
    if not match:
        raise MalformedInputError(f"Invalid cell reference: {ref!r}")
    col = col_to_index(match.group(1))
    row = int(match.group(2))
    if row < 1 or row > MAX_ROW:
        raise MalformedInputError(f"Row out of range in reference: {ref!r}")
    return row, col


def cell_ref(row: int, col: int) -> str:
    """``(row, col)`` (1-based) -> A1 reference."""
    if row < 1 or row > MAX_ROW:
        raise MalformedInputError(f"Row out of range: {row}")
    return f"{index_to_col(col)}{row}"


def parse_range(text: str) -> tuple[int, int, int, int]:
    """Parse ``A1:B3`` -> ``(row1, col1, row2, col2)`` normalised so
    row1 <= row2 and col1 <= col2."""
    parts = text.split(":")
    if len(parts) != 2:
        raise MalformedInputError(f"Invalid range: {text!r}")
    r1, c1 = parse_cell(parts[0])
    r2, c2 = parse_cell(parts[1])
    return min(r1, r2), min(c1, c2), max(r1, r2), max(c1, c2)


# ------------------------------------------------------------- formula ----

_TOKEN_RE = re.compile(r"""
    \s*(?:
    (?P<num>\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)
    | (?P<ref>[A-Za-z]+[0-9]+)
    | (?P<ident>[A-Za-z]+)
    | (?P<op>[-+*/(),:])
    )
""", re.VERBOSE)

_FUNCTIONS = ("SUM", "AVERAGE")


def _tokenize(body: str) -> list[tuple[str, str]]:
    tokens: list[tuple[str, str]] = []
    pos = 0
    while pos < len(body):
        match = _TOKEN_RE.match(body, pos)
        if not match or match.start() == match.end():
            raise FormulaError(f"Cannot parse formula near {body[pos:pos + 10]!r}")
        pos = match.end()
        kind = match.lastgroup or "op"
        # NB: match.group() would include the leading \s*; the named
        # group is the token text itself (a space before "A2" used to
        # make the reference unresolvable and silently read as 0).
        tokens.append((kind, match.group(kind)))
    tokens.append(("eof", ""))
    return tokens


def _clean_number(value: float) -> int | float:
    """Return an int when a float result is integral (``10.0`` -> ``10``)."""
    if value == int(value) and abs(value) < 2 ** 53:
        return int(value)
    return value


class _Parser:
    """Recursive-descent parser; evaluation is delegated to a resolver
    so the same parser serves both evaluation and (in future) checking."""

    def __init__(self, tokens: list[tuple[str, str]], resolver: "_Evaluator") -> None:
        self.tokens = tokens
        self.pos = 0
        self.resolver = resolver

    def peek(self) -> tuple[str, str]:
        return self.tokens[self.pos]

    def next(self) -> tuple[str, str]:
        tok = self.tokens[self.pos]
        self.pos += 1
        return tok

    def expect(self, kind: str, text: str = "") -> tuple[str, str]:
        tok = self.next()
        if tok[0] != kind or (text and tok[1] != text):
            raise FormulaError(f"Expected {text or kind}, got {tok[1]!r}")
        return tok

    def parse(self) -> Any:
        value = self.parse_expr()
        if self.peek()[0] != "eof":
            raise FormulaError(f"Unexpected trailing input: {self.peek()[1]!r}")
        return value

    def parse_expr(self) -> Any:
        value = self.parse_term()
        while self.peek() == ("op", "+") or self.peek() == ("op", "-"):
            op = self.next()[1]
            rhs = self.parse_term()
            value = self._arith(value, op, rhs)
        return value

    def parse_term(self) -> Any:
        value = self.parse_factor()
        while self.peek() == ("op", "*") or self.peek() == ("op", "/"):
            op = self.next()[1]
            rhs = self.parse_factor()
            value = self._arith(value, op, rhs)
        return value

    def parse_factor(self) -> Any:
        kind, text = self.next()
        if kind == "num":
            return int(text) if re.fullmatch(r"\d+", text) else float(text)
        if kind == "ref":
            if self.peek() == ("op", ":"):
                raise FormulaError(
                    "Ranges (A1:B2) are only allowed inside SUM/AVERAGE, "
                    f"not as a bare value near {text!r}")
            return self.resolver.ref_value(text)
        if kind == "ident":
            if self.peek() != ("op", "("):
                raise FormulaError(f"Unknown name {text!r} (only cell refs and "
                                   f"{', '.join(_FUNCTIONS)} are supported)")
            return self.parse_function(text)
        if kind == "op" and text == "(":
            value = self.parse_expr()
            self.expect("op", ")")
            return value
        if kind == "op" and text == "-":
            operand = self.parse_factor()
            return self._arith(0, "-", operand)
        if kind == "op" and text == "+":
            return self.parse_factor()
        raise FormulaError(f"Unexpected token {text!r} in formula")

    def parse_function(self, name: str) -> Any:
        fname = name.upper()
        if fname not in _FUNCTIONS:
            raise FormulaError(f"Unsupported function {name!r} "
                               f"(supported: {', '.join(_FUNCTIONS)})")
        self.expect("op", "(")
        values: list[float] = []
        if self.peek() == ("op", ")"):
            raise FormulaError(f"{fname} needs at least one argument")
        while True:
            kind, text = self.peek()
            if kind == "ref" and self.tokens[self.pos + 1] == ("op", ":"):
                self.next()  # start ref
                self.next()  # ':'
                end_kind, end_text = self.next()
                if end_kind != "ref":
                    raise FormulaError("Range end must be a cell reference")
                values.extend(self.resolver.range_values(f"{text}:{end_text}"))
            else:
                values.append(self._to_number(self.parse_expr(),
                                             f"argument of {fname}"))
            if self.peek() == ("op", ","):
                self.next()
                continue
            break
        self.expect("op", ")")
        if fname == "SUM":
            return _clean_number(sum(values))
        # AVERAGE: values holds only numeric cells (text/empty ignored).
        if not values:
            raise FormulaError("AVERAGE of no numbers")
        return _clean_number(sum(values) / len(values))

    @staticmethod
    def _to_number(value: Any, context: str) -> float:
        if isinstance(value, bool):
            raise FormulaError(f"Boolean is not a number ({context})")
        if isinstance(value, (int, float)):
            return float(value)
        if isinstance(value, str):
            try:
                return float(value.strip())
            except ValueError:
                raise FormulaError(
                    f"Text {value!r} is not a number ({context})") from None
        raise FormulaError(f"Value {value!r} is not a number ({context})")

    def _arith(self, lhs: Any, op: str, rhs: Any) -> Any:
        left = self._to_number(lhs, "left operand")
        right = self._to_number(rhs, "right operand")
        if op == "+":
            return _clean_number(left + right)
        if op == "-":
            return _clean_number(left - right)
        if op == "*":
            return _clean_number(left * right)
        if op == "/":
            if right == 0:
                raise FormulaError("Division by zero")
            return _clean_number(left / right)
        raise FormulaError(f"Unknown operator {op!r}")


class _Evaluator:
    """Evaluates one sheet's formulas with a per-run cache and a
    visiting stack, so cycles raise CycleError instead of recursing."""

    def __init__(self, sheet: "Sheet") -> None:
        self.sheet = sheet
        self.cache: dict[str, Any] = {}
        self.visiting: list[str] = []

    def cell_value(self, ref: str) -> Any:
        ref = ref.strip().upper()
        if ref in self.cache:
            return self.cache[ref]
        if ref in self.visiting:
            chain = " -> ".join(self.visiting + [ref])
            raise CycleError(f"Circular reference: {chain}")
        raw = self.sheet.cells.get(ref)
        if raw is None:
            return 0  # empty cell reads as 0 in formulas
        if not (isinstance(raw, str) and raw.startswith("=")):
            return raw
        self.visiting.append(ref)
        try:
            value = _Parser(_tokenize(raw[1:]), self).parse()
        finally:
            self.visiting.pop()
        self.cache[ref] = value
        return value

    def ref_value(self, ref: str) -> Any:
        return self.cell_value(ref)

    def range_values(self, text: str) -> list[float]:
        r1, c1, r2, c2 = parse_range(text)
        values: list[float] = []
        for row in range(r1, r2 + 1):
            for col in range(c1, c2 + 1):
                ref = cell_ref(row, col)
                raw = self.sheet.cells.get(ref)
                if raw is None:
                    continue
                value = self.cell_value(ref)
                if isinstance(value, bool) or isinstance(value, str):
                    # Text in a range is ignored (spreadsheet convention);
                    # a numeric string coerces.
                    if isinstance(value, str):
                        try:
                            values.append(float(value.strip()))
                        except ValueError:
                            continue
                    continue
                if isinstance(value, (int, float)):
                    values.append(float(value))
        return values


# ---------------------------------------------------------------- sheet ----

class Sheet:
    """A single worksheet: cells keyed by uppercase A1 reference.

    Raw values: ``None`` (clears the cell), ``int``/``float``/``bool``,
    plain ``str``, or a formula ``str`` starting with ``=``. Formula
    errors are NOT raised by ``set_cell`` — they surface from ``value()``
    / ``recalculate()``, as in a real spreadsheet.
    """

    def __init__(self) -> None:
        self.cells: dict[str, Any] = {}

    def set_cell(self, ref: str, value: Any) -> None:
        row, col = parse_cell(ref)
        ref = cell_ref(row, col)
        if value is None:
            self.cells.pop(ref, None)
            return
        if isinstance(value, (int, float, bool, str)):
            self.cells[ref] = value
            return
        raise MalformedInputError(
            f"Cell value must be a number, boolean or string, got {type(value).__name__}")

    def get_cell(self, ref: str) -> Any:
        """Raw stored value (formula text for formulas), or None."""
        row, col = parse_cell(ref)
        return self.cells.get(cell_ref(row, col))

    def value(self, ref: str) -> Any:
        """Computed value of one cell; raises FormulaError / CycleError
        for bad formulas. Non-formula cells return their raw value."""
        row, col = parse_cell(ref)
        return _Evaluator(self).cell_value(cell_ref(row, col))

    def recalculate(self) -> tuple[dict[str, Any], dict[str, str]]:
        """Compute every cell. Returns ``(values, errors)``: ``values``
        maps A1 refs to computed values (raw values for non-formulas),
        ``errors`` maps A1 refs of broken formulas to a readable message.
        Never hangs: cycles are reported, not recursed."""
        evaluator = _Evaluator(self)
        values: dict[str, Any] = {}
        errors: dict[str, str] = {}
        for ref in sorted(self.cells, key=lambda r: (parse_cell(r)[0], parse_cell(r)[1])):
            try:
                values[ref] = evaluator.cell_value(ref)
            except (FormulaError, CycleError) as exc:
                errors[ref] = str(exc)
        return values, errors

    def dimensions(self) -> tuple[int, int]:
        """``(max_row, max_col)`` over stored cells, or ``(0, 0)``."""
        if not self.cells:
            return 0, 0
        rows, cols = zip(*(parse_cell(r) for r in self.cells))
        return max(rows), max(cols)

    def __len__(self) -> int:
        return len(self.cells)


# ------------------------------------------------------------------ CSV ----

def sheet_from_csv(text: str) -> Sheet:
    """Load CSV text into a sheet (A1 = first cell). Every non-empty
    cell becomes text, except cells starting with ``=`` which become
    formulas. Blank lines advance the row counter but store nothing."""
    sheet = Sheet()
    try:
        rows = list(csv.reader(io.StringIO(text)))
    except csv.Error as exc:
        raise MalformedInputError(f"Malformed CSV: {exc}") from exc
    for row_no, row in enumerate(rows, start=1):
        for col_no, cell in enumerate(row, start=1):
            if cell == "":
                continue
            sheet.cells[cell_ref(row_no, col_no)] = cell
    return sheet


def sheet_to_csv(sheet: Sheet) -> str:
    """Save a sheet as CSV text (rectangular grid up to its dimensions).
    Formulas are written as their formula text; booleans as TRUE/FALSE."""
    max_row, max_col = sheet.dimensions()
    if max_row == 0:
        return ""
    buf = io.StringIO()
    writer = csv.writer(buf, lineterminator="\n")
    for row in range(1, max_row + 1):
        cells = []
        for col in range(1, max_col + 1):
            raw = sheet.cells.get(cell_ref(row, col))
            if raw is None:
                cells.append("")
            elif isinstance(raw, bool):
                cells.append("TRUE" if raw else "FALSE")
            else:
                cells.append(str(raw))
        writer.writerow(cells)
    return buf.getvalue()


# ----------------------------------------------------------------- XLSX ----

_NS = "http://schemas.openxmlformats.org/spreadsheetml/2006/main"
_RNS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
ET.register_namespace("", _NS)
ET.register_namespace("r", _RNS)

_CONTENT_TYPES = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/></Types>"""

_RELS = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>"""

_WORKBOOK = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Sheet1" sheetId="1" r:id="rId1"/></sheets></workbook>"""

_WORKBOOK_RELS = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/></Relationships>"""


def sheet_to_xlsx(sheet: Sheet, path: str | Path) -> Path:
    """Write a sheet as a minimal single-worksheet .xlsx file (stdlib
    zip/xml only). See the module docstring for what is NOT preserved."""
    path = Path(path)
    values, _errors = sheet.recalculate()
    shared: list[str] = []
    shared_index: dict[str, int] = {}

    def shared_id(text: str) -> int:
        if text not in shared_index:
            shared_index[text] = len(shared)
            shared.append(text)
        return shared_index[text]

    root = ET.Element(f"{{{_NS}}}worksheet")
    data = ET.SubElement(root, f"{{{_NS}}}sheetData")
    max_row, _ = sheet.dimensions()
    for row_no in range(1, max_row + 1):
        row_el = ET.SubElement(data, f"{{{_NS}}}row", {"r": str(row_no)})
        for ref in sorted(
                (r for r in sheet.cells if parse_cell(r)[0] == row_no),
                key=lambda r: parse_cell(r)[1]):
            raw = sheet.cells[ref]
            cell_el = ET.SubElement(row_el, f"{{{_NS}}}c", {"r": ref})
            if isinstance(raw, str) and raw.startswith("="):
                f_el = ET.SubElement(cell_el, f"{{{_NS}}}f")
                f_el.text = raw[1:]
                cached = values.get(ref)
                if isinstance(cached, bool):
                    cell_el.set("t", "b")
                    v_el = ET.SubElement(cell_el, f"{{{_NS}}}v")
                    v_el.text = "1" if cached else "0"
                elif isinstance(cached, (int, float)):
                    v_el = ET.SubElement(cell_el, f"{{{_NS}}}v")
                    v_el.text = repr(cached)
                elif isinstance(cached, str):
                    cell_el.set("t", "str")
                    v_el = ET.SubElement(cell_el, f"{{{_NS}}}v")
                    v_el.text = cached
                # error cells: formula kept, no cached value
            elif isinstance(raw, bool):
                cell_el.set("t", "b")
                v_el = ET.SubElement(cell_el, f"{{{_NS}}}v")
                v_el.text = "1" if raw else "0"
            elif isinstance(raw, (int, float)):
                v_el = ET.SubElement(cell_el, f"{{{_NS}}}v")
                v_el.text = repr(raw)
            else:
                cell_el.set("t", "s")
                v_el = ET.SubElement(cell_el, f"{{{_NS}}}v")
                v_el.text = str(shared_id(str(raw)))
    sheet_xml = ET.tostring(root, encoding="utf-8", xml_declaration=True)
    ss_root = ET.Element(f"{{{_NS}}}sst",
                         {"count": str(len(shared)), "uniqueCount": str(len(shared))})
    for text in shared:
        si = ET.SubElement(ss_root, f"{{{_NS}}}si")
        t_el = ET.SubElement(si, f"{{{_NS}}}t")
        t_el.text = text
    ss_xml = ET.tostring(ss_root, encoding="utf-8", xml_declaration=True)
    try:
        with zipfile.ZipFile(path, "w", compression=zipfile.ZIP_DEFLATED) as zf:
            zf.writestr("[Content_Types].xml", _CONTENT_TYPES)
            zf.writestr("_rels/.rels", _RELS)
            zf.writestr("xl/workbook.xml", _WORKBOOK)
            zf.writestr("xl/_rels/workbook.xml.rels", _WORKBOOK_RELS)
            zf.writestr("xl/worksheets/sheet1.xml", sheet_xml)
            zf.writestr("xl/sharedStrings.xml", ss_xml)
    except OSError as exc:
        raise wrap_os_error(exc, str(path)) from exc
    return path


def sheet_from_xlsx(path: str | Path | bytes) -> Sheet:
    """Read a .xlsx file's first worksheet (``xl/worksheets/sheet1.xml``).
    Shared strings, inline strings, numbers, booleans and formulas are
    restored; styles and all other sheets are ignored (see docstring)."""
    try:
        if isinstance(path, bytes):
            zf = zipfile.ZipFile(io.BytesIO(path), "r")
        else:
            if not Path(path).exists():
                raise NotFoundError(f"Spreadsheet not found: {path}")
            zf = zipfile.ZipFile(path, "r")
    except zipfile.BadZipFile as exc:
        raise MalformedInputError(f"Not a valid .xlsx (ZIP) file: {path if not isinstance(path, bytes) else '<bytes>'}") from exc
    except OSError as exc:
        raise wrap_os_error(exc, str(path)) from exc
    with zf:
        names = set(zf.namelist())
        if "xl/worksheets/sheet1.xml" not in names:
            raise MalformedInputError("No xl/worksheets/sheet1.xml in .xlsx file")
        shared: list[str] = []
        if "xl/sharedStrings.xml" in names:
            try:
                ss_root = ET.fromstring(zf.read("xl/sharedStrings.xml"))
            except ET.ParseError as exc:
                raise MalformedInputError(f"Invalid sharedStrings.xml: {exc}") from exc
            for si in ss_root.findall(f"{{{_NS}}}si"):
                shared.append("".join(t.text or ""
                                     for t in si.iter(f"{{{_NS}}}t")))
        try:
            ws_root = ET.fromstring(zf.read("xl/worksheets/sheet1.xml"))
        except ET.ParseError as exc:
            raise MalformedInputError(f"Invalid worksheet XML: {exc}") from exc
        sheet = Sheet()
        for cell_el in ws_root.iter(f"{{{_NS}}}c"):
            ref = cell_el.get("r")
            if not ref:
                continue
            f_el = cell_el.find(f"{{{_NS}}}f")
            if f_el is not None and f_el.text is not None:
                sheet.cells[ref.upper()] = "=" + f_el.text
                continue
            v_el = cell_el.find(f"{{{_NS}}}v")
            is_el = cell_el.find(f"{{{_NS}}}is")
            ctype = cell_el.get("t")
            if ctype == "s" and v_el is not None and v_el.text is not None:
                try:
                    sheet.cells[ref.upper()] = shared[int(v_el.text)]
                except (ValueError, IndexError) as exc:
                    raise MalformedInputError(
                        f"Shared-string index out of range in {ref}") from exc
            elif ctype == "inlineStr" and is_el is not None:
                sheet.cells[ref.upper()] = "".join(
                    t.text or "" for t in is_el.iter(f"{{{_NS}}}t"))
            elif ctype == "b" and v_el is not None:
                sheet.cells[ref.upper()] = v_el.text == "1"
            elif ctype == "str" and v_el is not None:
                sheet.cells[ref.upper()] = v_el.text or ""
            elif ctype == "e":
                sheet.cells[ref.upper()] = v_el.text if v_el is not None else ""
            elif v_el is not None and v_el.text is not None:
                text = v_el.text
                if re.fullmatch(r"-?\d+", text):
                    sheet.cells[ref.upper()] = int(text)
                else:
                    try:
                        sheet.cells[ref.upper()] = float(text)
                    except ValueError:
                        sheet.cells[ref.upper()] = text
            # cells with neither value nor formula store nothing
    return sheet
