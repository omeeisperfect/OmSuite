"""Slide-deck model + single-file HTML export (stdlib only).

This is genuinely shared logic, not app UI: it defines the deck model
(add / insert / delete / reorder slides, each with a title, body text
and an optional image path) and the one portable export every app can
produce from it — a single HTML file with inline CSS.

Export honesty notes:
- All user text (titles, bodies, notes) is HTML-escaped: a slide
  containing ``<script>`` exports as visible text, never as executable
  markup.
- Images: when the image file exists, is a recognised image type
  (png/jpg/jpeg/gif/webp) and is under ``max_image_bytes``, it is
  embedded as a data URI, so the HTML really is a single file. Otherwise
  the export falls back to an escaped ``src`` reference (or drops the
  image) and reports a warning — the warning must be shown, because a
  referenced image breaks the "single file" claim.
- Speaker notes: each slide has a ``notes`` field (presenter notes,
  Master Instructions §3.4 "speaker notes where supported"). They are
  NOT shown in the presentation by default: ``export_html`` only renders
  them (as an escaped ``<aside class="notes">``) when
  ``include_notes=True`` — a presenter handout, not the slide itself.
- No animations, transitions or PPTX import/export: those are NOT
  implemented. PPTX is a separate, unbuilt engine.
"""

from __future__ import annotations

import base64
import html
from dataclasses import dataclass, field
from pathlib import Path

DEFAULT_MAX_IMAGE_BYTES = 5 * 1024 * 1024  # 5 MiB embedded per image
_EMBEDDABLE = {".png": "image/png", ".jpg": "image/jpeg",
               ".jpeg": "image/jpeg", ".gif": "image/gif",
               ".webp": "image/webp"}


@dataclass
class Slide:
    title: str = ""
    body: str = ""
    image_path: str | None = None
    notes: str = ""  # speaker notes; not shown unless export asks for them


@dataclass
class Deck:
    title: str = ""
    slides: list[Slide] = field(default_factory=list)

    def add_slide(self, title: str = "", body: str = "",
                  image_path: str | None = None, notes: str = "") -> Slide:
        slide = Slide(title=title, body=body, image_path=image_path,
                      notes=notes)
        self.slides.append(slide)
        return slide

    def insert_slide(self, index: int, title: str = "", body: str = "",
                     image_path: str | None = None, notes: str = "") -> Slide:
        if index < 0 or index > len(self.slides):
            raise IndexError(f"Slide index out of range: {index}")
        slide = Slide(title=title, body=body, image_path=image_path,
                      notes=notes)
        self.slides.insert(index, slide)
        return slide

    def delete_slide(self, index: int) -> Slide:
        if index < 0 or index >= len(self.slides):
            raise IndexError(f"Slide index out of range: {index}")
        return self.slides.pop(index)

    def duplicate_slide(self, index: int) -> Slide:
        """Copy slide ``index`` and insert the copy right after it
        (the standard duplicate-slide operation). The copy is a new
        Slide object, so editing it never changes the original."""
        if index < 0 or index >= len(self.slides):
            raise IndexError(f"Slide index out of range: {index}")
        original = self.slides[index]
        copy = Slide(title=original.title, body=original.body,
                     image_path=original.image_path, notes=original.notes)
        self.slides.insert(index + 1, copy)
        return copy

    def clear(self) -> None:
        """Remove all slides (the deck object itself is kept)."""
        self.slides.clear()

    def move_slide(self, from_index: int, to_index: int) -> None:
        """Move a slide so it ends up at ``to_index`` (final position)."""
        if from_index < 0 or from_index >= len(self.slides):
            raise IndexError(f"Slide index out of range: {from_index}")
        if to_index < 0 or to_index >= len(self.slides):
            raise IndexError(f"Slide index out of range: {to_index}")
        slide = self.slides.pop(from_index)
        self.slides.insert(to_index, slide)

    def __len__(self) -> int:
        return len(self.slides)


def _image_tag(slide: Slide, index: int, warnings: list[str], *,
               embed_images: bool,
               max_image_bytes: int) -> str:
    if not slide.image_path:
        return ""
    path = Path(slide.image_path)
    alt = html.escape(slide.title or f"Slide {index + 1} image", quote=True)
    if not embed_images:
        return (f'<img src="{html.escape(slide.image_path, quote=True)}" '
                f'alt="{alt}">')
    if not path.exists():
        warnings.append(f"Slide {index + 1}: image not found, dropped: "
                        f"{slide.image_path}")
        return ""
    mime = _EMBEDDABLE.get(path.suffix.lower())
    if mime is None:
        warnings.append(f"Slide {index + 1}: image type {path.suffix!r} not "
                        f"embeddable, kept as a file reference.")
        return (f'<img src="{html.escape(slide.image_path, quote=True)}" '
                f'alt="{alt}">')
    try:
        data = path.read_bytes()
    except OSError:
        warnings.append(f"Slide {index + 1}: image unreadable, dropped: "
                        f"{slide.image_path}")
        return ""
    if len(data) > max_image_bytes:
        warnings.append(f"Slide {index + 1}: image over {max_image_bytes} "
                        f"bytes, kept as a file reference instead of embedded.")
        return (f'<img src="{html.escape(slide.image_path, quote=True)}" '
                f'alt="{alt}">')
    encoded = base64.b64encode(data).decode("ascii")
    return f'<img src="data:{mime};base64,{encoded}" alt="{alt}">'


_CSS = ("body{font-family:system-ui,sans-serif;margin:0;background:#111827}"
        ".slide{min-height:100vh;box-sizing:border-box;padding:8vh 8vw;"
        "background:#fff;border-bottom:2px solid #111827}"
        ".slide h1{font-size:2.2em;margin:0 0 .4em}"
        ".slide p{font-size:1.2em;line-height:1.6;white-space:pre-wrap}"
        ".slide img{max-width:100%;max-height:60vh;display:block;margin-top:1em}"
        ".notes{margin-top:2em;padding:1em;background:#fef9c3;"
        "border-left:4px solid #eab308;font-size:1em;white-space:pre-wrap}")


def export_html(deck: Deck, *, embed_images: bool = True,
                max_image_bytes: int = DEFAULT_MAX_IMAGE_BYTES,
                include_notes: bool = False,
                ) -> tuple[str, list[str]]:
    """Render a deck as one self-contained HTML document (inline CSS,
    user text escaped). Returns ``(html, warnings)``; warnings cover
    images that could not be embedded (see module docstring) and must
    be shown, since they break the single-file claim. Speaker notes are
    only rendered when ``include_notes`` is True (handout mode); by
    default they stay out of the presentation entirely.
    """
    warnings: list[str] = []
    doc_title = html.escape(deck.title or
                            (deck.slides[0].title if deck.slides else
                             "OmSuite Slides"), quote=True)
    parts = ["<!DOCTYPE html>\n<html lang=\"en\">\n<head>\n<meta charset=\"utf-8\">\n",
             f"<title>{doc_title}</title>\n<style>{_CSS}</style>\n</head>\n<body>\n"]
    for index, slide in enumerate(deck.slides):
        parts.append('<section class="slide">\n')
        if slide.title:
            parts.append(f"<h1>{html.escape(slide.title, quote=True)}</h1>\n")
        if slide.body:
            parts.append(f"<p>{html.escape(slide.body, quote=True)}</p>\n")
        if include_notes and slide.notes:
            parts.append("<aside class=\"notes\">"
                         f"{html.escape(slide.notes, quote=True)}</aside>\n")
        tag = _image_tag(slide, index, warnings,
                         embed_images=embed_images,
                         max_image_bytes=max_image_bytes)
        if tag:
            parts.append(tag + "\n")
        parts.append("</section>\n")
    parts.append("</body>\n</html>\n")
    return "".join(parts), warnings
