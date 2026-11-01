"""Tests for shared/archive_core.py. Run: python3 -m unittest discover -s tests -v"""
import stat
import sys
import tempfile
import unittest
import zipfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "shared"))

import archive_core as ac
from errors import (ConflictError, MalformedInputError, NotFoundError,
                    OversizedInputError, UnsafePathError)


class ArchiveTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)

    def tearDown(self):
        self.tmp.cleanup()

    def _craft(self, name, entries):
        """entries: list of (arcname, bytes, external_attr_or_None)."""
        p = self.root / name
        with zipfile.ZipFile(p, "w", compression=zipfile.ZIP_DEFLATED) as zf:
            for arc, data, attr in entries:
                info = zipfile.ZipInfo(arc)
                # ZipInfo defaults to STORED; force DEFLATED so the bomb
                # test actually compresses (otherwise ratio ~= 1:1).
                info.compress_type = zipfile.ZIP_DEFLATED
                if attr is not None:
                    info.external_attr = attr
                zf.writestr(info, data)
        return p

    def test_create_extract_roundtrip(self):
        src = self.root / "docs"
        (src / "sub").mkdir(parents=True)
        (src / "a.txt").write_text("hello")
        (src / "sub" / "b.txt").write_text("world")
        archive = ac.create(self.root / "out.zip", [src])
        listed = ac.browse(archive)
        self.assertEqual(sorted(e["name"] for e in listed),
                         ["docs/a.txt", "docs/sub/b.txt"])
        dest = self.root / "out"
        seen = []
        written = ac.extract(archive, dest, progress=lambda d, t, n: seen.append(n))
        self.assertEqual(len(written), 2)
        self.assertEqual(len(seen), 2)
        self.assertEqual((dest / "docs" / "a.txt").read_text(), "hello")

    def test_traversal_rejected(self):
        for bad in ("../evil.txt", "/abs.txt", "a/../../evil.txt", "C:/evil.txt"):
            archive = self._craft("bad.zip", [(bad, b"x", None)])
            self.assertRaises(UnsafePathError, ac.browse, archive)
            self.assertRaises(UnsafePathError, ac.extract, archive, self.root / "d")
            self.assertFalse((self.root / "evil.txt").exists())

    def test_symlink_entry_rejected(self):
        attr = (stat.S_IFLNK | 0o777) << 16
        archive = self._craft("link.zip", [("link", b"/etc/passwd", attr)])
        self.assertRaises(UnsafePathError, ac.browse, archive)
        self.assertRaises(UnsafePathError, ac.extract, archive, self.root / "d")

    def test_bomb_ratio_rejected(self):
        # 1 MiB of zeros compresses to ~1 KiB: ratio ~1000:1.
        archive = self._craft("bomb.zip", [("zeros.bin", b"\x00" * 1024 * 1024, None)])
        self.assertRaises(OversizedInputError, ac.browse, archive, max_ratio=100)
        # A 912:1 bomb also exceeds the default 200:1 limit — correct.
        self.assertRaises(OversizedInputError, ac.browse, archive)
        # ...but an ordinary archive passes with defaults.
        normal = self._craft("normal.zip", [("a.txt", b"hello world", None)])
        self.assertEqual(len(ac.browse(normal)), 1)

    def test_entry_count_and_file_size_limits(self):
        archive = self._craft("many.zip", [(f"f{i}.txt", b"x", None) for i in range(5)])
        self.assertRaises(OversizedInputError, ac.browse, archive, max_entries=3)
        big = self._craft("big.zip", [("big.bin", b"x" * 1000, None)])
        self.assertRaises(OversizedInputError, ac.browse, big, max_file=100)

    def test_extract_selected_and_missing(self):
        archive = self._craft("sel.zip", [("a.txt", b"A", None), ("b.txt", b"B", None)])
        dest = self.root / "sel"
        written = ac.extract(archive, dest, selected=["b.txt"])
        self.assertEqual([p.name for p in written], ["b.txt"])
        self.assertFalse((dest / "a.txt").exists())
        self.assertRaises(NotFoundError, ac.extract, archive, dest,
                          selected=["ghost.txt"])

    def test_extract_conflicts(self):
        archive = self._craft("c.zip", [("a.txt", b"NEW", None)])
        dest = self.root / "c"
        dest.mkdir()
        (dest / "a.txt").write_text("OLD")
        self.assertRaises(ConflictError, ac.extract, archive, dest, policy="error")
        self.assertEqual((dest / "a.txt").read_text(), "OLD")
        written = ac.extract(archive, dest, policy="rename")
        self.assertEqual(written[0].name, "a (2).txt")
        self.assertEqual(written[0].read_text(), "NEW")
        written = ac.extract(archive, dest, policy="skip")
        self.assertEqual(written, [])

    def test_malformed_and_missing_archive(self):
        bad = self.root / "notzip.zip"
        bad.write_text("this is not a zip")
        self.assertRaises(MalformedInputError, ac.browse, bad)
        self.assertRaises(NotFoundError, ac.browse, self.root / "gone.zip")

    def test_create_conflict_and_symlink_source(self):
        src = self.root / "a.txt"
        src.write_text("A")
        archive = self.root / "o.zip"
        ac.create(archive, [src])
        self.assertRaises(ConflictError, ac.create, archive, [src], policy="error")
        link = self.root / "link.txt"
        import os
        os.symlink(src, link)
        self.assertRaises(UnsafePathError, ac.create, self.root / "o2.zip", [link])


if __name__ == "__main__":
    unittest.main()
