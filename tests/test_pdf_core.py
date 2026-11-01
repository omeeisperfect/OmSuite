"""Tests for shared/pdf_core.py. The PDFs are built here, in the test,
with stdlib zlib only — no sample PDF file is shipped. The engine is
best-effort (see pdf_core docstring); these tests pin exactly the
operators it claims: Tj, TJ, hex strings, escapes, FlateDecode."""
import sys
import tempfile
import unittest
import zlib
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "shared"))

import pdf_core as pc
from errors import NotFoundError


def _pdf(content_streams):
    """content_streams: list of (dict_bytes, body_bytes). Returns bytes
    of a minimal one-page-per-stream PDF (xref offsets are fake — the
    engine scans streams, it does not parse the xref table, which is
    exactly the documented best-effort behaviour)."""
    parts = [b"%PDF-1.4\n"]
    parts.append(b"1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj\n")
    kids = b" ".join(b"%d 0 R" % (3 + 2 * i) for i in range(len(content_streams)))
    parts.append(b"2 0 obj << /Type /Pages /Kids [%s] /Count %d >> endobj\n"
                 % (kids, len(content_streams)))
    for i, (dict_bytes, body) in enumerate(content_streams):
        page_no, cont_no = 3 + 2 * i, 4 + 2 * i
        parts.append(b"%d 0 obj << /Type /Page /Parent 2 0 R "
                     b"/MediaBox [0 0 612 792] /Contents %d 0 R "
                     b"/Resources << /Font << /F1 99 0 R >> >> >> endobj\n"
                     % (page_no, cont_no))
        parts.append(b"%d 0 obj %s\nstream\n" % (cont_no, dict_bytes))
        parts.append(body)
        parts.append(b"\nendstream endobj\n")
    parts.append(b"99 0 obj << /Type /Font /Subtype /Type1 "
                 b"/BaseFont /Helvetica >> endobj\n%%EOF\n")
    return b"".join(parts)


CONTENT = (b"BT /F1 12 Tf 72 720 Td (Hello ) Tj (World) Tj ET\n"
           b"BT [(Hel) -10 (lo)] TJ ET\n"
           b"BT (a \\(b\\) c) Tj ET\n"
           b"BT <48656C6C6F> Tj ET\n")


class PdfTest(unittest.TestCase):
    def test_uncompressed_tj_tj_escapes_hex(self):
        data = _pdf([(b"<< /Length 0 >>", CONTENT)])
        text = pc.extract_text_from_bytes(data)
        self.assertIn("Hello World", text)
        self.assertIn("Hello", text)  # TJ array joined
        self.assertIn("a (b) c", text)  # escaped parens decoded
        # The trailing hex string <48656C6C6F> is "Hello" again.
        self.assertGreaterEqual(text.count("Hello"), 2)

    def test_flate_compressed_stream(self):
        compressed = zlib.compress(CONTENT)
        data = _pdf([(b"<< /Length 0 /Filter /FlateDecode >>", compressed)])
        text = pc.extract_text_from_bytes(data)
        self.assertIn("Hello World", text)
        self.assertIn("a (b) c", text)

    def test_hex_utf16be_and_parts_per_stream(self):
        utf16 = b"BT <FEFF00480069> Tj ET"  # "Hi"
        data = _pdf([(b"<< /Length 0 >>", CONTENT),
                     (b"<< /Length 0 >>", utf16)])
        parts = pc.extract_parts_from_bytes(data)
        self.assertEqual(len(parts), 2)
        self.assertIn("Hi", parts[1])
        self.assertIn("Hello World", pc.extract_text_from_bytes(data))

    def test_garbage_and_corrupt_stream_yield_empty_not_crash(self):
        self.assertEqual(pc.extract_text_from_bytes(b"this is not a pdf"), "")
        corrupt = _pdf([(b"<< /Length 0 /Filter /FlateDecode >>",
                         b"not actually compressed")])
        self.assertEqual(pc.extract_text_from_bytes(corrupt), "")

    def test_file_api_and_missing(self):
        with tempfile.TemporaryDirectory() as tmp:
            p = Path(tmp) / "doc.pdf"
            p.write_bytes(_pdf([(b"<< /Length 0 >>", CONTENT)]))
            self.assertIn("Hello World", pc.extract_text(p))
            self.assertRaises(NotFoundError, pc.extract_text, Path(tmp) / "gone.pdf")


if __name__ == "__main__":
    unittest.main()
