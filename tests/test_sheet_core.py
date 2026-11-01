"""Tests for shared/sheet_core.py. Run: python3 -m unittest discover -s tests -v"""
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "shared"))

import sheet_core as sc
from errors import MalformedInputError


class AddressingTest(unittest.TestCase):
    def test_col_conversions(self):
        self.assertEqual(sc.col_to_index("A"), 1)
        self.assertEqual(sc.col_to_index("Z"), 26)
        self.assertEqual(sc.col_to_index("AA"), 27)
        self.assertEqual(sc.col_to_index("XFD"), 16384)
        self.assertEqual(sc.index_to_col(1), "A")
        self.assertEqual(sc.index_to_col(27), "AA")
        self.assertEqual(sc.index_to_col(16384), "XFD")
        for bad in ("", "A0", "A-1", "1A", "XFE"):
            self.assertRaises(MalformedInputError, sc.parse_cell, bad)

    def test_range_normalised(self):
        self.assertEqual(sc.parse_range("B3:A1"), (1, 1, 3, 2))
        self.assertEqual(sc.cell_ref(3, 2), "B3")
        self.assertRaises(MalformedInputError, sc.parse_range, "A1")


class FormulaTest(unittest.TestCase):
    def setUp(self):
        self.s = sc.Sheet()
        self.s.set_cell("A1", 2)
        self.s.set_cell("A2", 3)
        self.s.set_cell("A3", 4)

    def test_arithmetic_precedence_parens(self):
        self.s.set_cell("B1", "=A1+A2*A3")   # 2 + 12
        self.s.set_cell("B2", "=(A1+A2)*A3")  # 5 * 4
        self.s.set_cell("B3", "=-A1+10")
        self.s.set_cell("B4", "=A3/A2")       # 4/3
        values, errors = self.s.recalculate()
        self.assertEqual(errors, {})
        self.assertEqual(values["B1"], 14)
        self.assertEqual(values["B2"], 20)
        self.assertEqual(values["B3"], 8)
        self.assertAlmostEqual(values["B4"], 4 / 3)

    def test_refs_case_insensitive_and_empty_is_zero(self):
        self.s.set_cell("B1", "=a1+Z9")  # Z9 empty -> 0
        values, errors = self.s.recalculate()
        self.assertEqual(errors, {})
        self.assertEqual(values["B1"], 2)

    def test_sum_average_ranges(self):
        self.s.set_cell("B1", "=SUM(A1:A3)")
        self.s.set_cell("B2", "=AVERAGE(A1:A3)")
        self.s.set_cell("B3", "=SUM(A1, A2*2)")
        values, errors = self.s.recalculate()
        self.assertEqual(errors, {})
        self.assertEqual(values["B1"], 9)
        self.assertEqual(values["B2"], 3)
        self.assertEqual(values["B3"], 8)

    def test_sum_ignores_text_and_empty(self):
        self.s.set_cell("A4", "not a number")
        self.s.set_cell("B1", "=SUM(A1:A5)")
        self.s.set_cell("B2", "=AVERAGE(A1:A5)")
        values, errors = self.s.recalculate()
        self.assertEqual(errors, {})
        self.assertEqual(values["B1"], 9)
        self.assertEqual(values["B2"], 3)

    def test_string_passthrough_and_text_arith_error(self):
        self.s.set_cell("C1", "hello")
        self.s.set_cell("C2", "=C1")
        self.s.set_cell("C3", "=C1+1")
        values, errors = self.s.recalculate()
        self.assertEqual(values["C2"], "hello")
        self.assertIn("C3", errors)
        self.assertIn("not a number", errors["C3"])

    def test_cycle_detection_never_hangs(self):
        self.s.set_cell("C1", "=C2")
        self.s.set_cell("C2", "=C3")
        self.s.set_cell("C3", "=C1")  # 3-cycle
        self.s.set_cell("C4", "=C4")  # self-reference
        self.s.set_cell("D1", "=A1+A2")  # healthy cell must still compute
        values, errors = self.s.recalculate()
        self.assertEqual(values["D1"], 5)
        for ref in ("C1", "C2", "C3", "C4"):
            self.assertIn(ref, errors)
            self.assertIn("Circular", errors[ref])
        self.assertRaises(sc.CycleError, self.s.value, "C1")

    def test_div_zero_and_bad_formula_reported_not_raised(self):
        self.s.set_cell("C1", "=A1/0")
        self.s.set_cell("C2", "=FOO(A1)")
        self.s.set_cell("C3", "=A1+")
        self.s.set_cell("C4", "=A1:B2")  # bare range
        values, errors = self.s.recalculate()
        for ref in ("C1", "C2", "C3", "C4"):
            self.assertIn(ref, errors, ref)
        self.assertIn("Division by zero", errors["C1"])

    def test_average_of_no_numbers_is_error(self):
        self.s.set_cell("B1", "=AVERAGE(C1:C3)")  # all empty
        _, errors = self.s.recalculate()
        self.assertIn("B1", errors)


class CsvTest(unittest.TestCase):
    def test_csv_roundtrip_text_exact(self):
        text = "name,score,note\nada,9,\"has, comma\"\nbo,5,\"quoted \"\"x\"\"\"\n"
        sheet = sc.sheet_from_csv(text)
        self.assertEqual(sc.sheet_to_csv(sheet), text)
        # Formulas survive the round-trip and still compute.
        sheet.set_cell("D1", "=SUM(B2:B3)")
        out = sc.sheet_to_csv(sheet)
        reloaded = sc.sheet_from_csv(out)
        values, errors = reloaded.recalculate()
        self.assertEqual(errors, {})
        self.assertEqual(values["D1"], 14)

    def test_csv_empty_sheet(self):
        self.assertEqual(sc.sheet_to_csv(sc.Sheet()), "")
        self.assertEqual(len(sc.sheet_from_csv("")), 0)

    def test_set_cell_validation(self):
        s = sc.Sheet()
        self.assertRaises(MalformedInputError, s.set_cell, "nope", 1)
        self.assertRaises(MalformedInputError, s.set_cell, "A1", [1, 2])
        s.set_cell("a1", 5)  # lowercase accepted, stored uppercase
        self.assertEqual(s.get_cell("A1"), 5)
        s.set_cell("A1", None)
        self.assertIsNone(s.get_cell("A1"))


class XlsxTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)

    def tearDown(self):
        self.tmp.cleanup()

    def test_xlsx_roundtrip(self):
        sheet = sc.Sheet()
        sheet.set_cell("A1", "Name & <tag>")
        sheet.set_cell("B1", 42)
        sheet.set_cell("C1", 2.5)
        sheet.set_cell("D1", True)
        sheet.set_cell("A2", 3)
        sheet.set_cell("B2", 4)
        sheet.set_cell("C2", "=SUM(A2:B2)")
        sheet.set_cell("D2", "=A2*B2")
        path = sc.sheet_to_xlsx(sheet, self.root / "book.xlsx")
        # It really is a ZIP with the expected OOXML parts.
        import zipfile
        with zipfile.ZipFile(path) as zf:
            self.assertIn("xl/worksheets/sheet1.xml", zf.namelist())
            self.assertIn("xl/sharedStrings.xml", zf.namelist())
        back = sc.sheet_from_xlsx(path)
        self.assertEqual(back.get_cell("A1"), "Name & <tag>")
        self.assertEqual(back.get_cell("B1"), 42)
        self.assertEqual(back.get_cell("C1"), 2.5)
        self.assertEqual(back.get_cell("D1"), True)
        self.assertEqual(back.get_cell("C2"), "=SUM(A2:B2)")
        values, errors = back.recalculate()
        self.assertEqual(errors, {})
        self.assertEqual(values["C2"], 7)
        self.assertEqual(values["D2"], 12)

    def test_xlsx_bad_inputs(self):
        bad = self.root / "bad.xlsx"
        bad.write_text("not a zip")
        self.assertRaises(MalformedInputError, sc.sheet_from_xlsx, bad)
        self.assertRaises(Exception, sc.sheet_from_xlsx, self.root / "gone.xlsx")


if __name__ == "__main__":
    unittest.main()
