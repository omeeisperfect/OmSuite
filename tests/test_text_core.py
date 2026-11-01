"""Tests for shared/text_core.py. Run: python3 -m unittest discover -s tests -v"""
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "shared"))

import text_core as tc
from errors import MalformedInputError


class TextTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)

    def tearDown(self):
        self.tmp.cleanup()

    def _write(self, name, raw: bytes):
        p = self.root / name
        p.write_bytes(raw)
        return p

    def test_crlf_and_bom_preserved(self):
        p = self._write("doc.txt", b"\xef\xbb\xbfline1\r\nline2\r\n")
        doc = tc.read_text(p)
        self.assertTrue(doc.had_bom)
        self.assertEqual(doc.newline, "\r\n")
        out = self.root / "out.txt"
        tc.write_text(out, doc)
        self.assertEqual(out.read_bytes(), b"\xef\xbb\xbfline1\r\nline2\r\n")

    def test_lf_default_and_override(self):
        p = self._write("a.txt", b"one\ntwo\n")
        doc = tc.read_text(p)
        self.assertEqual(doc.newline, "\n")
        out = self.root / "b.txt"
        tc.write_text(out, "x\ny\n", newline="\r\n")
        self.assertEqual(out.read_bytes(), b"x\r\ny\r\n")

    def test_mixed_endings_warned(self):
        p = self._write("mix.txt", b"a\r\nb\nc\r\n")
        doc = tc.read_text(p)
        self.assertTrue(any("Mixed" in w for w in doc.warnings))

    def test_latin1_fallback_and_binary_rejected(self):
        p = self._write("lat.txt", b"caf\xe9\n")
        doc = tc.read_text(p)
        self.assertEqual(doc.encoding, "latin-1")
        self.assertTrue(doc.warnings)
        bad = self._write("bin.dat", b"a\x00b")
        self.assertRaises(MalformedInputError, tc.read_text, bad)

    def test_json_validate_format_and_dupes(self):
        value = tc.validate_json('{"a": 1}')
        self.assertEqual(value, {"a": 1})
        self.assertRaises(MalformedInputError, tc.validate_json, '{"a": }')
        pretty, warnings = tc.format_json('{"b":1,"a":[1,2]}')
        self.assertIn('"b": 1', pretty)
        self.assertEqual(warnings, [])
        _, warnings = tc.format_json('{"a": 1, "a": 2}')
        self.assertTrue(any("Duplicate" in w for w in warnings))
        mini, _ = tc.format_json('{\n  "a": 1\n}', minify=True)
        self.assertEqual(mini, '{"a":1}')

    def test_xml_validate_format_and_comment_warning(self):
        root = tc.validate_xml("<root><child>hi</child></root>")
        self.assertEqual(root.tag, "root")
        self.assertRaises(MalformedInputError, tc.validate_xml, "<root><oops>")
        formatted, warnings = tc.format_xml("<!-- note --><root><a/></root>")
        self.assertIn("<root>", formatted)
        self.assertTrue(any("Comments" in w for w in warnings))
        _, warnings = tc.format_xml("<!DOCTYPE root><root/>")
        self.assertTrue(any("DOCTYPE" in w for w in warnings))

    def test_yaml_subset_roundtrip(self):
        text = ("name: OmSuite\nversion: 1\nprivate: true\n"
                "tags:\n  - files\n  - docs\nnested:\n  deep: 42\n")
        value = tc.yaml_load(text)
        self.assertEqual(value["name"], "OmSuite")
        self.assertEqual(value["tags"], ["files", "docs"])
        self.assertEqual(value["nested"]["deep"], 42)
        dumped = tc.yaml_dump(value)
        self.assertEqual(tc.yaml_load(dumped), value)

    def test_yaml_list_of_mappings_roundtrip(self):
        value = {"items": [{"name": "a", "n": 1}, {"name": "b", "n": 2}]}
        dumped = tc.yaml_dump(value)
        self.assertEqual(tc.yaml_load(dumped), value)

    def test_yaml_unsupported_rejected(self):
        self.assertRaises(MalformedInputError, tc.yaml_load, "a: &anchor 1\nb: *anchor\n")
        self.assertRaises(MalformedInputError, tc.yaml_load, "---\na: 1\n---\nb: 2\n")
        self.assertRaises(MalformedInputError, tc.yaml_load, "a: |\n  block\n")
        self.assertRaises(MalformedInputError, tc.yaml_load, "a: 1\na: 2\n")

    def test_html_escape_and_preview(self):
        self.assertEqual(tc.html_escape("<script>alert(1)</script>"),
                         "&lt;script&gt;alert(1)&lt;/script&gt;")
        p = self._write("long.txt", b"x" * 100)
        preview = tc.preview_text(p, max_chars=10)
        self.assertTrue(preview.startswith("x" * 10))
        self.assertIn("truncated", preview)


class TextCorrectionTest(unittest.TestCase):
    """Correction pass (1 Nov 2026): Markdown->HTML subset safety,
    code tokenizer edge cases. Existing tests above are untouched."""

    def test_markdown_subset_structure(self):
        html_text, warnings = tc.markdown_to_html(
            "# Title\n\nHello **bold** and *italic* with `code`.\n\n"
            "- one\n- two\n\n1. first\n2. second\n\n> quoted\n\n---\n")
        self.assertIn("<h1>Title</h1>", html_text)
        self.assertIn("<strong>bold</strong>", html_text)
        self.assertIn("<em>italic</em>", html_text)
        self.assertIn("<code>code</code>", html_text)
        self.assertIn("<ul><li>one</li><li>two</li></ul>", html_text)
        self.assertIn("<ol><li>first</li><li>second</li></ol>", html_text)
        self.assertIn("<blockquote>quoted</blockquote>", html_text)
        self.assertIn("<hr>", html_text)
        self.assertEqual(warnings, [])

    def test_markdown_script_never_executes(self):
        html_text, _ = tc.markdown_to_html(
            "<script>alert(1)</script>\n\n"
            "[click](javascript:alert(2))\n\n"
            "![pic](data:image/png;base64,AAA)\n")
        self.assertNotIn("<script>", html_text)
        self.assertIn("&lt;script&gt;alert(1)&lt;/script&gt;", html_text)
        self.assertNotIn("javascript:", html_text)
        self.assertNotIn("data:image", html_text)
        self.assertIn("click", html_text)  # label kept, URL dropped
        self.assertIn("pic", html_text)  # alt text kept, URL dropped

    def test_markdown_safe_links_and_table(self):
        html_text, _ = tc.markdown_to_html(
            "[ok](https://example.com/?a=1&b=2)\n\n"
            "| name | age |\n| --- | --- |\n| ada | 36 |\n")
        self.assertIn('<a href="https://example.com/?a=1&amp;b=2">ok</a>',
                      html_text)
        self.assertIn("<th>name</th>", html_text)
        self.assertIn("<td>ada</td>", html_text)

    def test_markdown_fence_and_unclosed_fence_warning(self):
        html_text, warnings = tc.markdown_to_html(
            "```python\nprint('<b>')\n```\n")
        self.assertIn("<pre><code>", html_text)
        # html.escape(quote=True) escapes the quotes too — correct.
        self.assertIn("print(&#x27;&lt;b&gt;&#x27;)", html_text)
        self.assertEqual(warnings, [])
        _, warnings = tc.markdown_to_html("```\nnever closed\n")
        self.assertTrue(any("Unclosed" in w for w in warnings))

    def test_markdown_edge_cases(self):
        from errors import OversizedInputError
        self.assertEqual(tc.markdown_to_html(""), ("", []))
        self.assertRaises(MalformedInputError, tc.markdown_to_html,
                          "bad\x00text")
        self.assertRaises(OversizedInputError, tc.markdown_to_html,
                          "x" * 50, max_chars=10)

    def test_tokenizer_kinds_and_html(self):
        tokens = tc.tokenize_code("def f(x): # note\n    return x + 1\n")
        kinds = [(t.kind, t.text) for t in tokens if t.kind != "whitespace"]
        self.assertIn(("keyword", "def"), kinds)
        self.assertIn(("comment", "# note"), kinds)
        self.assertIn(("keyword", "return"), kinds)
        self.assertIn(("number", "1"), kinds)
        self.assertIn(("identifier", "f"), kinds)
        rendered = tc.tokens_to_html(tokens)
        self.assertIn('<span class="tok-keyword">def</span>', rendered)
        self.assertNotIn("<script>", tc.tokens_to_html(
            tc.tokenize_code("s = '<script>'\n")))
        self.assertIn("&lt;script&gt;", tc.tokens_to_html(
            tc.tokenize_code("s = '<script>'\n")))

    def test_tokenizer_edge_cases(self):
        from errors import OversizedInputError
        self.assertEqual(tc.tokenize_code(""), [])
        self.assertRaises(MalformedInputError, tc.tokenize_code, "a\x00b")
        self.assertRaises(OversizedInputError, tc.tokenize_code,
                          "x" * 50, max_chars=10)


if __name__ == "__main__":
    unittest.main()
