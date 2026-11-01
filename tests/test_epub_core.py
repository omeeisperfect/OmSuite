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


class EpubCorrectionTest(unittest.TestCase):
    """Correction pass (1 Nov 2026): TOC (nav + NCX), bookmarks,
    progress, search, encryption/MOBI refusal. Existing tests untouched."""

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)

    def tearDown(self):
        self.tmp.cleanup()

    def _build(self, name, opf_manifest, spine, files, container=CONTAINER):
        opf = ("<?xml version=\"1.0\"?><package xmlns="
               "\"http://www.idpf.org/2007/opf\" version=\"3.0\">"
               "<metadata xmlns:dc=\"http://purl.org/dc/elements/1.1/\">"
               "<dc:title>B</dc:title></metadata>"
               f"<manifest>{opf_manifest}</manifest>"
               f"<spine>{spine}</spine></package>")
        p = self.root / name
        with zipfile.ZipFile(p, "w") as zf:
            zf.writestr("META-INF/container.xml", container)
            zf.writestr("OEBPS/content.opf", opf)
            for arc, data in files.items():
                zf.writestr(arc, data)
        return p

    def _book_with_nav(self):
        nav = ("<html xmlns=\"http://www.w3.org/1999/xhtml\" "
               "xmlns:epub=\"http://www.idpf.org/2007/ops\"><body>"
               "<nav epub:type=\"toc\"><ol>"
               "<li><a href=\"ch1.xhtml#s1\">Chapter One</a><ol>"
               "<li><a href=\"ch1.xhtml#s2\">Section Two</a></li></ol></li>"
               "<li><a href=\"ch2.xhtml\">Chapter Two</a></li>"
               "</ol></nav></body></html>")
        manifest = ('<item id="ch1" href="ch1.xhtml" '
                    'media-type="application/xhtml+xml"/>'
                    '<item id="ch2" href="ch2.xhtml" '
                    'media-type="application/xhtml+xml"/>'
                    '<item id="nav" href="nav.xhtml" '
                    'media-type="application/xhtml+xml" properties="nav"/>')
        return self._build("nav.epub", manifest,
                           '<itemref idref="ch1"/><itemref idref="ch2"/>',
                           {"OEBPS/ch1.xhtml": CH1, "OEBPS/ch2.xhtml": CH2,
                            "OEBPS/nav.xhtml": nav})

    def test_nav_toc_levels_and_fragments(self):
        book = ec.load_epub(self._book_with_nav())
        self.assertEqual([(e.title, e.href, e.fragment, e.level)
                          for e in book.toc],
                         [("Chapter One", "OEBPS/ch1.xhtml", "s1", 1),
                          ("Section Two", "OEBPS/ch1.xhtml", "s2", 2),
                          ("Chapter Two", "OEBPS/ch2.xhtml", "", 1)])

    def test_ncx_fallback_when_no_nav(self):
        ncx = ("<?xml version=\"1.0\"?><ncx xmlns="
               "\"http://www.daisy.org/z3986/2005/ncx/\" version=\"2005-1\">"
               "<navMap><navPoint id=\"n1\"><navLabel><text>Start</text>"
               "</navLabel><content src=\"ch1.xhtml\"/>"
               "<navPoint id=\"n2\"><navLabel><text>Deep</text></navLabel>"
               "<content src=\"ch2.xhtml#part\"/></navPoint></navPoint>"
               "</navMap></ncx>")
        manifest = ('<item id="ch1" href="ch1.xhtml" '
                    'media-type="application/xhtml+xml"/>'
                    '<item id="ch2" href="ch2.xhtml" '
                    'media-type="application/xhtml+xml"/>'
                    '<item id="ncx" href="toc.ncx" '
                    'media-type="application/x-dtbncx+xml"/>')
        book = ec.load_epub(self._build(
            "ncx.epub", manifest,
            '<itemref idref="ch1"/><itemref idref="ch2"/>',
            {"OEBPS/ch1.xhtml": CH1, "OEBPS/ch2.xhtml": CH2,
             "OEBPS/toc.ncx": ncx}))
        self.assertEqual([(e.title, e.href, e.fragment, e.level)
                          for e in book.toc],
                         [("Start", "OEBPS/ch1.xhtml", "", 1),
                          ("Deep", "OEBPS/ch2.xhtml", "part", 2)])

    def test_no_toc_is_empty_not_error(self):
        book = ec.load_epub(_build_epub(self.root / "plain.epub"))
        self.assertEqual(book.toc, [])

    def test_encrypted_and_mobi_refused(self):
        from errors import UnsupportedFormatError
        p = self.root / "enc.epub"
        with zipfile.ZipFile(p, "w") as zf:
            zf.writestr("META-INF/container.xml", CONTAINER)
            zf.writestr("META-INF/encryption.xml", "<enc/>")
        self.assertRaises(UnsupportedFormatError, ec.load_epub, p)
        mobi = self.root / "book.mobi"
        mobi.write_bytes(b"not an epub")
        self.assertRaises(UnsupportedFormatError, ec.load_epub, mobi)

    def test_search_progress_and_bookmark(self):
        book = ec.load_epub(self._book_with_nav())
        hits = ec.search_epub(book, "world")
        self.assertEqual(len(hits), 1)
        self.assertEqual(hits[0].chapter_id, "ch1")
        self.assertIn("world", hits[0].snippet)
        self.assertEqual(ec.search_epub(book, ""), [])
        self.assertEqual(ec.search_epub(book, "WORLD"), hits)  # insensitive
        self.assertEqual(ec.search_epub(book, "WORLD", case_sensitive=True),
                         [])
        total = len(book.full_text())
        self.assertGreater(total, 0)
        self.assertEqual(ec.book_progress(book, 1, 99), 1.0)  # clamped end
        self.assertEqual(ec.book_progress(book, 0, 0), 0.0)
        mid = ec.book_progress(book, 0, 1)
        self.assertTrue(0.0 < mid < 1.0)
        bookmark = ec.Bookmark(chapter_index=1, paragraph_index=2,
                               note="here")
        self.assertEqual(ec.Bookmark.from_dict(bookmark.to_dict()), bookmark)


if __name__ == "__main__":
    unittest.main()
