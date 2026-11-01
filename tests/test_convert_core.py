"""Tests for shared/convert_core.py. Run: python3 -m unittest discover -s tests -v"""
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "shared"))

import convert_core as cc
from errors import MalformedInputError


class ConvertTest(unittest.TestCase):
    def test_txt_to_md_plain_and_warning(self):
        out, warnings = cc.txt_to_md("hello\nworld\n")
        self.assertEqual(out, "hello\nworld\n")
        self.assertEqual(warnings, [])
        _, warnings = cc.txt_to_md("# not really a heading\nplain\n")
        self.assertTrue(any("Line 1" in w for w in warnings))

    def test_md_to_txt_losses_are_warned(self):
        md = "# Title\nSome **bold** and [link](https://example.com) text.\n"
        out, warnings = cc.md_to_txt(md)
        self.assertEqual(out, "Title\nSome bold and link text.\n")
        self.assertTrue(any("heading" in w for w in warnings))
        self.assertTrue(any("link URL" in w for w in warnings))
        out, _ = cc.md_to_txt("```\ncode <b>kept</b>\n```\n")
        self.assertIn("code <b>kept</b>", out)

    def test_json_pretty_minify_roundtrip(self):
        pretty, _ = cc.json_pretty('{"a":1}')
        mini, _ = cc.json_minify(pretty)
        self.assertEqual(mini, '{"a":1}')
        pretty2, _ = cc.json_pretty(mini)
        self.assertEqual(pretty2, pretty)

    def test_csv_json_roundtrip(self):
        csv_text = "name,age\nnimu,30\nada,25\n"
        js, warnings = cc.csv_to_json(csv_text)
        self.assertEqual(warnings, [])
        back, warnings = cc.json_to_csv(js)
        self.assertEqual(back, csv_text)
        # Values stay strings: leading zeros survive.
        js, _ = cc.csv_to_json("code\n007\n")
        self.assertIn('"007"', js)

    def test_csv_ragged_and_duplicate_warnings(self):
        _, warnings = cc.csv_to_json("a,b\n1\n")
        self.assertTrue(any("short row" in w for w in warnings))
        _, warnings = cc.csv_to_json("a,a\n1,2\n")
        self.assertTrue(any("Duplicate" in w for w in warnings))
        _, warnings = cc.csv_to_json("a,b\n1,2,3\n")
        self.assertTrue(any("extra cells" in w for w in warnings))
        self.assertRaises(MalformedInputError, cc.csv_to_json, "")
        self.assertRaises(MalformedInputError, cc.csv_to_json, "a,,c\n1,2,3\n")

    def test_json_to_csv_nested_and_missing(self):
        js = '[{"a": 1, "b": {"x": 2}}, {"a": 3}]'
        csv_text, warnings = cc.json_to_csv(js)
        self.assertIn("a,b", csv_text.splitlines()[0])
        self.assertTrue(any("Nested" in w for w in warnings))
        self.assertTrue(any("missing key" in w for w in warnings))
        self.assertRaises(MalformedInputError, cc.json_to_csv, '{"a": 1}')
        self.assertRaises(MalformedInputError, cc.json_to_csv, 'not json')

    def test_csv_md_table_roundtrip(self):
        csv_text = "name,note\nada,has | pipe\n"
        table, _ = cc.csv_to_md_table(csv_text)
        self.assertIn("\\|", table)
        back, warnings = cc.md_table_to_csv(table)
        self.assertEqual(back, csv_text)
        self.assertEqual(warnings, [])
        self.assertRaises(MalformedInputError, cc.md_table_to_csv, "no table here\n")
        self.assertRaises(MalformedInputError, cc.md_table_to_csv,
                          "| a |\n| not a separator |\n| 1 |\n")


class ConvertExtraTest(unittest.TestCase):
    """Added 1 Nov 2026: CSV<->JSON and JSON pretty-print already exist
    in convert_core (csv_to_json / json_to_csv / json_pretty); these
    tests pin the harder round-trips rather than re-implementing them."""

    def test_csv_json_roundtrip_hard_cells(self):
        csv_text = ('name,note,empty\n'
                    '"ada, a","has ""quotes"" and, commas",\n'
                    'béla,"multi\nline",x\n')
        js, warnings = cc.csv_to_json(csv_text)
        self.assertEqual(warnings, [])
        back, warnings = cc.json_to_csv(js)
        self.assertEqual(back, csv_text)

    def test_json_pretty_options_and_roundtrip(self):
        pretty, _ = cc.json_pretty('{"b": [1, 2], "a": {"x": "é"}}', indent=4)
        self.assertIn('    "b"', pretty)
        mini, _ = cc.json_minify(pretty)
        self.assertEqual(mini, '{"b":[1,2],"a":{"x":"é"}}')
        pretty2, _ = cc.json_pretty(mini, indent=4)
        self.assertEqual(pretty2, pretty)

    def test_csv_derived_json_pretty_prints(self):
        js, _ = cc.csv_to_json("code\n007\n")
        pretty, _ = cc.json_pretty(js)
        self.assertIn('"007"', pretty)  # still a string after pretty-print


if __name__ == "__main__":
    unittest.main()
