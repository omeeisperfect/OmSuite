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


class ArchiveExtraTest(unittest.TestCase):
    """Added 1 Nov 2026: binary round-trip, deep nesting, explicit
    directory entries — gaps in the original coverage, no change to
    existing tests above."""

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)

    def tearDown(self):
        self.tmp.cleanup()

    def test_binary_and_deep_nesting_roundtrip(self):
        src = self.root / "pkg"
        deep = src / "a" / "b" / "c" / "d"
        deep.mkdir(parents=True)
        blob = bytes(range(256)) * 4  # every byte value, incl. NUL
        (deep / "blob.bin").write_bytes(blob)
        (src / "notes.txt").write_text("plain")
        archive = ac.create(self.root / "pkg.zip", [src])
        dest = self.root / "out"
        ac.extract(archive, dest)
        self.assertEqual((dest / "pkg" / "a" / "b" / "c" / "d" / "blob.bin").read_bytes(), blob)
        self.assertEqual((dest / "pkg" / "notes.txt").read_text(), "plain")

    def test_explicit_empty_dir_created_and_traversal_dir_rejected(self):
        p = self.root / "dirs.zip"
        with zipfile.ZipFile(p, "w") as zf:
            zf.writestr(zipfile.ZipInfo("empty/"), b"")
            zf.writestr("empty/keep.txt", b"K")
        dest = self.root / "d1"
        ac.extract(p, dest)
        self.assertTrue((dest / "empty").is_dir())
        self.assertEqual((dest / "empty" / "keep.txt").read_text(), "K")
        bad = self.root / "baddir.zip"
        with zipfile.ZipFile(bad, "w") as zf:
            zf.writestr(zipfile.ZipInfo("../evil/"), b"")
        self.assertRaises(UnsafePathError, ac.extract, bad, self.root / "d2")
        self.assertFalse((self.root / "evil").exists())


class ArchiveCorrectionTest(unittest.TestCase):
    """Correction pass (1 Nov 2026): empty dirs, encrypted entries,
    non-ZIP refusal, nested archives, partial extraction, CRC safety.
    Existing tests above are untouched."""

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)

    def tearDown(self):
        self.tmp.cleanup()

    def test_empty_dir_create_extract_roundtrip(self):
        src = self.root / "pkg"
        (src / "empty").mkdir(parents=True)
        (src / "f.txt").write_text("F")
        archive = ac.create(self.root / "pkg.zip", [src])
        names = sorted(e["name"] for e in ac.browse(archive))
        self.assertIn("pkg/empty/", names)
        dest = self.root / "out"
        ac.extract(archive, dest)
        self.assertTrue((dest / "pkg" / "empty").is_dir())
        self.assertEqual((dest / "pkg" / "f.txt").read_text(), "F")

    def test_empty_source_dir_roundtrip(self):
        src = self.root / "void"
        src.mkdir()
        archive = ac.create(self.root / "void.zip", [src])
        dest = self.root / "out"
        ac.extract(archive, dest)
        self.assertTrue((dest / "void").is_dir())

    def test_encrypted_entry_refused(self):
        import struct
        from errors import UnsupportedFormatError
        p = self.root / "enc.zip"
        with zipfile.ZipFile(p, "w") as zf:
            zf.writestr("secret.txt", b"data")
        # writestr() resets flag_bits, so patch the flag into the local
        # header (+6) and central directory (+8) byte-wise instead.
        data = bytearray(p.read_bytes())
        lh = data.find(b"PK\x03\x04")
        cd = data.find(b"PK\x01\x02")
        struct.pack_into("<H", data, lh + 6, 0x1)
        struct.pack_into("<H", data, cd + 8, 0x1)
        p.write_bytes(bytes(data))
        self.assertRaises(UnsupportedFormatError, ac.browse, p)
        self.assertRaises(UnsupportedFormatError, ac.extract, p,
                          self.root / "d")
        self.assertFalse((self.root / "d" / "secret.txt").exists())

    def test_non_zip_formats_refused_clearly(self):
        from errors import UnsupportedFormatError
        rar = self.root / "x.rar"
        rar.write_bytes(b"Rar!\x1a\x07\x00junk")
        self.assertRaises(UnsupportedFormatError, ac.browse, rar)
        src = self.root / "a.txt"
        src.write_text("A")
        self.assertRaises(UnsupportedFormatError, ac.create,
                          self.root / "x.7z", [src])
        self.assertRaises(UnsupportedFormatError, ac.create,
                          self.root / "x.tar", [src])

    def test_nested_zip_is_opaque_file(self):
        inner = self.root / "inner.zip"
        with zipfile.ZipFile(inner, "w") as zf:
            zf.writestr("in.txt", b"IN")
        outer = ac.create(self.root / "outer.zip", [inner])
        dest = self.root / "out"
        ac.extract(outer, dest)
        # Extracted as a file, NOT expanded: no in.txt beside it.
        self.assertTrue(zipfile.is_zipfile(dest / "inner.zip"))
        self.assertFalse((dest / "in.txt").exists())

    def test_partial_paths_on_conflict(self):
        p = self.root / "c.zip"
        with zipfile.ZipFile(p, "w") as zf:
            zf.writestr("a.txt", b"NEW-A")
            zf.writestr("b.txt", b"NEW-B")
        dest = self.root / "d"
        dest.mkdir()
        (dest / "b.txt").write_text("OLD")
        with self.assertRaises(ConflictError) as ctx:
            ac.extract(p, dest, policy="error")
        self.assertEqual(ctx.exception.partial_paths, [dest / "a.txt"])
        self.assertEqual((dest / "b.txt").read_text(), "OLD")

    def test_crc_failure_preserves_overwrite_target(self):
        from errors import MalformedInputError
        p = self.root / "bad.zip"
        with zipfile.ZipFile(p, "w") as zf:
            zf.writestr("v.txt", b"hello world")
        data = bytearray(p.read_bytes())
        i = data.find(b"hello")
        data[i] ^= 0xFF
        p.write_bytes(bytes(data))
        dest = self.root / "d"
        dest.mkdir()
        (dest / "v.txt").write_text("ORIGINAL")
        with self.assertRaises(MalformedInputError) as ctx:
            ac.extract(p, dest, policy="overwrite")
        self.assertEqual(ctx.exception.partial_paths, [])
        self.assertEqual((dest / "v.txt").read_text(), "ORIGINAL")

    def test_forged_small_header_refused_without_partial_file(self):
        import struct
        from errors import MalformedInputError, OversizedInputError
        p = self.root / "forge.zip"
        with zipfile.ZipFile(p, "w",
                             compression=zipfile.ZIP_DEFLATED) as zf:
            zf.writestr("big.txt", b"x" * 100)
        data = bytearray(p.read_bytes())
        lh = data.find(b"PK\x03\x04")
        struct.pack_into("<I", data, lh + 22, 5)  # local file_size
        cd = data.find(b"PK\x01\x02")
        struct.pack_into("<I", data, cd + 24, 5)  # central file_size
        p.write_bytes(bytes(data))
        # Header says 5 bytes, so the header check passes...
        self.assertEqual(ac.browse(p, max_file=10)[0]["size"], 5)
        # ...but extraction must still refuse (CRC and/or size guard).
        with self.assertRaises((MalformedInputError, OversizedInputError)):
            ac.extract(p, self.root / "d", max_file=10)
        self.assertFalse((self.root / "d" / "big.txt").exists())

    def test_selected_empty_dir_created(self):
        p = self.root / "dirs.zip"
        with zipfile.ZipFile(p, "w") as zf:
            zf.writestr(zipfile.ZipInfo("empty/"), b"")
            zf.writestr("empty/keep.txt", b"K")
        dest = self.root / "d"
        ac.extract(p, dest, selected=["empty/"])
        self.assertTrue((dest / "empty").is_dir())
        self.assertFalse((dest / "empty" / "keep.txt").exists())


if __name__ == "__main__":
    unittest.main()
