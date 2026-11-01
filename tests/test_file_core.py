"""Tests for shared/file_core.py. Run: python3 -m unittest discover -s tests -v"""
import os
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "shared"))

import file_core as fc
from errors import (AlreadyExistsError, ConflictError, NotFoundError,
                    OmSuiteError, OversizedInputError, UnsafePathError)


class FileCoreTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)

    def tearDown(self):
        self.tmp.cleanup()

    def _file(self, name, content=b"hello"):
        p = self.root / name
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_bytes(content)
        return p

    def test_list_sort_and_hidden(self):
        self._file("b.txt", b"bb")
        self._file("a.txt", b"a")
        self._file(".hidden", b"h")
        names = [e.name for e in fc.list_dir(self.root)]
        self.assertEqual(names, ["a.txt", "b.txt"])
        self.assertEqual([e.name for e in fc.list_dir(self.root, include_hidden=True)],
                         [".hidden", "a.txt", "b.txt"])
        by_size = [e.name for e in fc.list_dir(self.root, sort="size", descending=True)]
        self.assertEqual(by_size, ["b.txt", "a.txt"])
        self.assertRaises(NotFoundError, fc.list_dir, self.root / "nope")

    def test_search_name_and_content(self):
        self._file("notes.txt", b"the secret word is banana")
        self._file("other.txt", b"nothing here")
        self._file("sub/deep.txt", b"banana split")
        found = fc.search(self.root, "banana", search_content=True)
        self.assertEqual(sorted(e.name for e in found), ["deep.txt", "notes.txt"])
        self.assertEqual([e.name for e in fc.search(self.root, "NOTES")], ["notes.txt"])
        self.assertEqual(fc.search(self.root, "zzz", search_content=True), [])

    def test_copy_conflicts(self):
        src = self._file("a.txt", b"A")
        dst = self.root / "b.txt"
        self._file("b.txt", b"B")
        self.assertRaises(ConflictError, fc.copy, src, dst, policy="error")
        self.assertIsNone(fc.copy(src, dst, policy="skip"))
        self.assertEqual((self.root / "b.txt").read_bytes(), b"B")
        renamed = fc.copy(src, dst, policy="rename")
        self.assertEqual(renamed.name, "b (2).txt")
        self.assertEqual(renamed.read_bytes(), b"A")
        fc.copy(src, dst, policy="overwrite")
        self.assertEqual((self.root / "b.txt").read_bytes(), b"A")

    def test_copy_missing_and_dir_into_itself(self):
        self.assertRaises(NotFoundError, fc.copy, self.root / "nope", self.root / "x")
        d = self.root / "dir"
        d.mkdir()
        self.assertRaises(UnsafePathError, fc.copy, d, d / "inner")

    def test_move_and_rename(self):
        src = self._file("a.txt", b"A")
        moved = fc.move(src, self.root / "b.txt")
        self.assertFalse(src.exists())
        self.assertEqual(moved.read_bytes(), b"A")
        renamed = fc.rename(moved, "c.txt")
        self.assertEqual(renamed.name, "c.txt")
        for bad in ("", "..", "a/b", "a\\b", "CON", "name."):
            self.assertRaises(UnsafePathError, fc.rename, renamed, bad)

    def test_duplicate_never_overwrites(self):
        src = self._file("report.txt", b"R")
        dup = fc.duplicate(src)
        self.assertEqual(dup.name, "report (copy).txt")
        dup2 = fc.duplicate(src)
        self.assertEqual(dup2.name, "report (copy) (2).txt")
        self.assertEqual(src.read_bytes(), b"R")

    def test_delete_rules_and_symlink(self):
        d = self.root / "dir"
        d.mkdir()
        (d / "x.txt").write_text("x")
        self.assertRaises(OmSuiteError, fc.delete, d, recursive=False)
        fc.delete(d, recursive=True)
        self.assertFalse(d.exists())
        target = self._file("real.txt", b"R")
        link = self.root / "link.txt"
        os.symlink(target, link)
        fc.delete(link)
        self.assertFalse(link.exists())
        self.assertTrue(target.exists())  # symlink target untouched
        self.assertRaises(NotFoundError, fc.delete, self.root / "gone")

    def test_atomic_write(self):
        p = self.root / "doc.txt"
        fc.atomic_write(p, b"v1")
        self.assertEqual(p.read_bytes(), b"v1")
        fc.atomic_write(p, b"v2 longer content")
        self.assertEqual(p.read_bytes(), b"v2 longer content")
        self.assertRaises(ConflictError, fc.atomic_write, p, b"v3", policy="error")
        self.assertEqual(p.read_bytes(), b"v2 longer content")  # unchanged
        renamed = fc.atomic_write(p, b"v3", policy="rename")
        self.assertEqual(renamed.name, "doc (2).txt")
        # No temp files left behind.
        leftovers = [n for n in os.listdir(self.root) if n.startswith(".doc")]
        self.assertEqual(leftovers, [])

    def test_read_capped_and_oversized(self):
        p = self._file("big.bin", b"x" * 100)
        self.assertRaises(OversizedInputError, fc.read_bytes_capped, p, max_bytes=10)
        self.assertEqual(fc.read_bytes_capped(p, max_bytes=100), b"x" * 100)
        self.assertRaises(NotFoundError, fc.read_bytes_capped, self.root / "gone",
                          max_bytes=10)

    @unittest.skipIf(os.geteuid() == 0, "root bypasses permission checks")
    def test_permission_denied_on_readonly_dir(self):
        src = self._file("a.txt", b"A")
        ro = self.root / "ro"
        ro.mkdir()
        os.chmod(ro, 0o500)
        try:
            with self.assertRaises(Exception) as ctx:
                fc.copy(src, ro / "a.txt")
            self.assertIn(type(ctx.exception).__name__,
                          ("PermissionDeniedError", "ReadOnlyError"))
        finally:
            os.chmod(ro, 0o700)


if __name__ == "__main__":
    unittest.main()
