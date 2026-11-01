"""Tests for shared/slide_core.py. Run: python3 -m unittest discover -s tests -v"""
import base64
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "shared"))

import slide_core as sl

# A real 1x1 transparent PNG.
PNG_1X1 = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8Xw8AAwMCAO+ip1sAAAAASUVORK5CYII=")


class DeckTest(unittest.TestCase):
    def test_add_delete_reorder(self):
        deck = sl.Deck(title="Talk")
        deck.add_slide("One", "first")
        deck.add_slide("Two", "second")
        deck.add_slide("Three", "third")
        deck.move_slide(2, 0)
        self.assertEqual([s.title for s in deck.slides],
                         ["Three", "One", "Two"])
        removed = deck.delete_slide(1)
        self.assertEqual(removed.title, "One")
        self.assertEqual(len(deck), 2)
        deck.insert_slide(1, "Middle", "inserted")
        self.assertEqual([s.title for s in deck.slides],
                         ["Three", "Middle", "Two"])
        self.assertRaises(IndexError, deck.delete_slide, 5)
        self.assertRaises(IndexError, deck.move_slide, 0, 5)

    def test_html_escapes_user_text(self):
        deck = sl.Deck()
        deck.add_slide("<script>alert(1)</script>", "a <b>bold</b> & \"quoted\"")
        html_text, warnings = sl.export_html(deck)
        self.assertEqual(warnings, [])
        self.assertNotIn("<script>alert(1)</script>", html_text)
        self.assertIn("&lt;script&gt;alert(1)&lt;/script&gt;", html_text)
        self.assertIn("a &lt;b&gt;bold&lt;/b&gt; &amp; &quot;quoted&quot;", html_text)
        self.assertIn("<style>", html_text)  # inline CSS, single file
        self.assertTrue(html_text.startswith("<!DOCTYPE html>"))

    def test_image_embedded_as_data_uri(self):
        with tempfile.TemporaryDirectory() as tmp:
            img = Path(tmp) / "pic.png"
            img.write_bytes(PNG_1X1)
            deck = sl.Deck()
            deck.add_slide("Pic", "see below", image_path=str(img))
            html_text, warnings = sl.export_html(deck)
            self.assertEqual(warnings, [])
            self.assertIn("data:image/png;base64,", html_text)
            self.assertNotIn("pic.png", html_text)

    def test_missing_and_oversized_images_warned(self):
        deck = sl.Deck()
        deck.add_slide("Ghost", "no image", image_path="/nonexistent/x.png")
        html_text, warnings = sl.export_html(deck)
        self.assertTrue(any("not found" in w for w in warnings))
        self.assertNotIn("<img", html_text)
        with tempfile.TemporaryDirectory() as tmp:
            img = Path(tmp) / "big.png"
            img.write_bytes(PNG_1X1)
            deck2 = sl.Deck()
            deck2.add_slide("Big", "too big", image_path=str(img))
            html_text, warnings = sl.export_html(
                deck2, max_image_bytes=2)
            self.assertTrue(any("over 2 bytes" in w for w in warnings))
            self.assertIn("big.png", html_text)  # falls back to a reference

    def test_empty_deck_is_valid_html(self):
        html_text, warnings = sl.export_html(sl.Deck())
        self.assertEqual(warnings, [])
        self.assertIn("<title>OmSuite Slides</title>", html_text)
        self.assertNotIn("<section", html_text)


if __name__ == "__main__":
    unittest.main()
