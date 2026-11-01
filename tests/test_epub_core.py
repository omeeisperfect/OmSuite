"""Tests for shared/epub_core.py. The EPUB fixture is built here, in
the test, with stdlib zipfile — no sample EPUB file is shipped."""
import sys
import tempfile
import unittest
import zipfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "shared"))

import epub_core as ec
from errors import MalformedInputError, NotFoundError

CONTAINER = """<?xml version="1.0"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>"""

OPF = """<?xml version="1.0"?>
<package xmlns="http://www.idpf.org/2007/opf" unique-identifier="uid" version="2.0">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:title>Test Book</dc:title>
    <dc:creator>Test Author</dc:creator>
  </metadata>
  <manifest>
    <item id="ch1" href="ch1.xhtml" media-type="application/xhtml+xml"/>
    <item id="ch2" href="ch2.xhtml" media-type="application/xhtml+xml"/>
  </manifest>
  <spine>
    <itemref idref="ch1"/>
    <itemref idref="ch2"/>
  </spine>
</package>"""

CH1 = """<?xml version="1.0"?>
<html xmlns="http://www.w3.org/1999/xhtml"><head><title>C1</title></head>
<body><h1>First Chapter</h1>
<p>Hello <b>world</b> &amp; friends.</p>
<p>Second paragraph with <a href="https://example.com">a link</a>.</p>
<script>var evil = 1;</script>
</body></html>"""

CH2 = """<?xml version="1.0"?>
<html xmlns="http://www.w3.org/1999/xhtml"><body>
<h2>Second</h2><p>Only paragraph.</p>
<ul><li>One</li><li>Two</li></ul>
</body></html>"""


def _build_epub(path, opf=OPF, ch1=CH1, ch2=CH2, container=CONTAINER):
    with zipfile.ZipFile(path, "w") as zf:
        zf.writestr("mimetype", "application/epub+zip",
                    compress_type=zipfile.ZIP_STORED)
        zf.writestr("META-INF/container.xml", container)
        zf.writestr("OEBPS/content.opf", opf)
        if ch1 is not None:
            zf.writestr("OEBPS/ch1.xhtml", ch1)
        if ch2 is not None:
            zf.writestr("OEBPS/ch2.xhtml", ch2)
    return path


class EpubTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)

    def tearDown(self):
        self.tmp.cleanup()

    def test_spine_order_chapters_and_text(self):
        book = ec.load_epub(_build_epub(self.root / "book.epub"))
        self.assertEqual(book.title, "Test Book")
        self.assertEqual(book.creator, "Test Author")
        self.assertEqual([c.id for c in book.chapters], ["ch1", "ch2"])
        self.assertEqual(book.chapters[0].title, "First Chapter")
        self.assertEqual(book.chapters[0].paragraphs[1],
                         "Hello world & friends.")
        self.assertEqual(book.chapters[0].paragraphs[2],
                         "Second paragraph with a link.")
        # Script content is dropped, tags are stripped, no markup leaks.
        self.assertNotIn("evil", book.full_text())
        self.assertNotIn("<b>", book.full_text())
        self.assertEqual(book.chapters[1].paragraphs,
                         ["Second", "Only paragraph.", "One", "Two"])
        self.assertEqual(book.chapter_text(1), book.chapters[1].text)

    def test_missing_container_or_chapter_is_error(self):
        p = self.root / "nocontainer.epub"
        with zipfile.ZipFile(p, "w") as zf:
            zf.writestr("OEBPS/content.opf", OPF)
        self.assertRaises(MalformedInputError, ec.load_epub, p)
        self.assertRaises(MalformedInputError, ec.load_epub,
                          _build_epub(self.root / "noch.epub", ch2=None))
        self.assertRaises(NotFoundError, ec.load_epub, self.root / "gone.epub")
        bad = self.root / "bad.epub"
        bad.write_text("not a zip")
        self.assertRaises(MalformedInputError, ec.load_epub, bad)

    def test_empty_spine_is_error(self):
        opf = OPF.replace("<itemref idref=\"ch1\"/>", "").replace(
            "<itemref idref=\"ch2\"/>", "")
        self.assertRaises(MalformedInputError, ec.load_epub,
                          _build_epub(self.root / "empty.epub", opf=opf))


if __name__ == "__main__":
    unittest.main()
