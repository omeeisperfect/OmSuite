"""EPUB reading engine (reference implementation, Python stdlib only).

Supported, tested: open an EPUB (a ZIP), follow ``META-INF/container.xml``
to the OPF package file, read its manifest + spine, and extract chapter
text with tags stripped and paragraphs preserved.

NOT supported: EPUB writing/editing, DRM-protected books, NCX navigation
(the spine order is the reading order), embedded fonts/images, or any
content outside the spine. A chapter file that is missing from the ZIP
is an error, not a silent skip. Non-linear spine items (``linear="no"``)
are skipped and noted on the book.

Chapter text extraction uses ``html.parser`` (not an XML parser) because
real-world EPUB XHTML is often not strictly well-formed XML; tag soup
still yields its paragraphs. Script/style content is dropped.
"""

from __future__ import annotations

import posixpath
import zipfile
from dataclasses import dataclass, field
from html.parser import HTMLParser
from pathlib import Path
import xml.etree.ElementTree as ET

from errors import MalformedInputError, NotFoundError, wrap_os_error

_BLOCK_TAGS = {"p", "h1", "h2", "h3", "h4", "h5", "h6", "li", "blockquote",
               "pre", "dt", "dd", "figcaption"}
_SKIP_TAGS = {"script", "style", "head"}


class _ChapterParser(HTMLParser):
    """Collects block-level paragraphs; nested blocks flush inner-first
    so a <div><p>...</p></div> yields the paragraph once, not twice."""

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.paragraphs: list[str] = []
        self._stack: list[list[str]] = []
        self._skip_depth = 0
        self.title: str | None = None

    def handle_starttag(self, tag: str, attrs) -> None:
        tag = tag.lower()
        if tag in _SKIP_TAGS:
            self._skip_depth += 1
            return
        if self._skip_depth:
            return
        if tag == "br":
            if self._stack:
                self._stack[-1].append("\n")
            return
        if tag in _BLOCK_TAGS:
            self._stack.append([])

    def handle_endtag(self, tag: str) -> None:
        tag = tag.lower()
        if tag in _SKIP_TAGS:
            self._skip_depth = max(0, self._skip_depth - 1)
            return
        if self._skip_depth:
            return
        if tag in _BLOCK_TAGS and self._stack:
            text = "".join(self._stack.pop()).strip()
            if text:
                if self.title is None and tag in ("h1", "h2"):
                    self.title = " ".join(text.split())
                self.paragraphs.append(text)

    def handle_data(self, data: str) -> None:
        if self._skip_depth:
            return
        if self._stack:
            self._stack[-1].append(data)

    def close(self) -> None:
        super().close()
        # Unclosed trailing blocks still yield their text.
        while self._stack:
            text = "".join(self._stack.pop()).strip()
            if text:
                self.paragraphs.append(text)


def _local(tag: str) -> str:
    return tag.rsplit("}", 1)[-1]


def _parse_xml(data: bytes, what: str) -> ET.Element:
    try:
        return ET.fromstring(data)
    except ET.ParseError as exc:
        raise MalformedInputError(f"Invalid {what}: {exc}") from exc


def _chapter_from_xhtml(data: bytes) -> tuple[list[str], str | None]:
    parser = _ChapterParser()
    try:
        parser.feed(data.decode("utf-8", errors="replace"))
    except Exception as exc:  # HTMLParser is forgiving; guard anyway
        raise MalformedInputError(f"Cannot parse chapter XHTML: {exc}") from exc
    parser.close()
    return parser.paragraphs, parser.title


@dataclass
class Chapter:
    """One spine chapter: ``id`` (manifest id), ``href`` (path inside
    the EPUB), ``title`` (first h1/h2, or None), ``paragraphs`` and
    ``text`` (paragraphs joined with blank lines)."""
    id: str
    href: str
    title: str | None
    paragraphs: list[str] = field(default_factory=list)

    @property
    def text(self) -> str:
        return "\n\n".join(self.paragraphs)


@dataclass
class EpubBook:
    title: str | None
    creator: str | None
    chapters: list[Chapter] = field(default_factory=list)
    skipped_nonlinear: list[str] = field(default_factory=list)

    def full_text(self) -> str:
        """All chapters in spine order, separated by blank lines."""
        return "\n\n".join(ch.text for ch in self.chapters)

    def chapter_text(self, index: int) -> str:
        return self.chapters[index].text


def load_epub(path: str | Path) -> EpubBook:
    """Open an EPUB file and parse its spine chapters."""
    path = Path(path)
    if not path.exists():
        raise NotFoundError(f"EPUB not found: {path}")
    try:
        zf = zipfile.ZipFile(path, "r")
    except zipfile.BadZipFile as exc:
        raise MalformedInputError(f"Not a valid EPUB (ZIP) file: {path}") from exc
    except OSError as exc:
        raise wrap_os_error(exc, str(path)) from exc
    with zf:
        names = set(zf.namelist())
        if "META-INF/container.xml" not in names:
            raise MalformedInputError("EPUB has no META-INF/container.xml")
        container = _parse_xml(zf.read("META-INF/container.xml"), "container.xml")
        opf_path = None
        for el in container.iter():
            if _local(el.tag) == "rootfile":
                media = el.get("media-type", "")
                if media in ("", "application/oebps-package+xml"):
                    opf_path = el.get("full-path")
                    break
        if not opf_path:
            raise MalformedInputError("container.xml names no OPF rootfile")
        if opf_path not in names:
            raise MalformedInputError(f"OPF file missing from EPUB: {opf_path}")
        opf = _parse_xml(zf.read(opf_path), "content.opf")
        opf_dir = posixpath.dirname(opf_path)
        title = creator = None
        manifest: dict[str, str] = {}
        spine: list[tuple[str, bool]] = []
        for el in opf.iter():
            name = _local(el.tag)
            if name == "title" and title is None:
                title = (el.text or "").strip() or None
            elif name == "creator" and creator is None:
                creator = (el.text or "").strip() or None
            elif name == "item":
                item_id, href = el.get("id"), el.get("href")
                if item_id and href:
                    manifest[item_id] = href
            elif name == "itemref":
                idref = el.get("idref")
                if idref:
                    spine.append((idref, el.get("linear", "yes") != "no"))
        if not spine:
            raise MalformedInputError("OPF spine is empty")
        chapters: list[Chapter] = []
        skipped: list[str] = []
        for idref, linear in spine:
            if not linear:
                skipped.append(idref)
                continue
            if idref not in manifest:
                raise MalformedInputError(
                    f"Spine item {idref!r} is not in the manifest")
            href = manifest[idref]
            entry = posixpath.normpath(posixpath.join(opf_dir, href)) \
                if opf_dir else posixpath.normpath(href)
            if entry not in names:
                raise MalformedInputError(
                    f"Chapter file missing from EPUB: {entry}")
            paragraphs, ch_title = _chapter_from_xhtml(zf.read(entry))
            chapters.append(Chapter(id=idref, href=entry,
                                    title=ch_title, paragraphs=paragraphs))
        return EpubBook(title=title, creator=creator,
                        chapters=chapters, skipped_nonlinear=skipped)
