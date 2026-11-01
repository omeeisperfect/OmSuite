"""EPUB reading engine (reference implementation, Python stdlib only).

Supported, tested: open an EPUB (a ZIP), follow ``META-INF/container.xml``
to the OPF package file, read its manifest + spine, and extract chapter
text with tags stripped and paragraphs preserved. Table of contents is
read from the EPUB3 navigation document (``properties="nav"``) when
present, falling back to the EPUB2 NCX ``navMap``; when neither exists
the TOC is simply empty (a missing TOC is not an error — many books
have none). Bookmarks and reading progress are plain data helpers
(``Bookmark`` + ``book_progress``) over chapter/paragraph positions;
apps persist them locally (Master Instructions §8: reading positions
are local metadata, never a copy of the book).

NOT supported: EPUB writing/editing, DRM-protected / encrypted books
(``META-INF/encryption.xml`` present -> a clear UNSUPPORTED_FORMAT
error, never garbled text), MOBI / AZW (separate formats, no parser
here — also a clear error, not a ZIP mis-parse), embedded fonts /
images / styles (text only), or any content outside the spine. A
chapter file that is missing from the ZIP is an error, not a silent
skip. Non-linear spine items (``linear="no"``) are skipped and noted
on the book.

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

from errors import (MalformedInputError, NotFoundError,
                    UnsupportedFormatError, wrap_os_error)

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
class TocEntry:
    """One table-of-contents entry. ``href`` is the resolved path of
    the target file inside the EPUB; ``fragment`` is the ``#...`` part
    of the original link ("" when absent); ``level`` is the nesting
    depth (1 = top level)."""
    title: str
    href: str
    fragment: str = ""
    level: int = 1


@dataclass
class Bookmark:
    """A reading position: chapter + paragraph index, optional note.
    Plain data — apps store it locally (see module docstring)."""
    chapter_index: int
    paragraph_index: int = 0
    note: str = ""

    def to_dict(self) -> dict:
        return {"chapter_index": self.chapter_index,
                "paragraph_index": self.paragraph_index,
                "note": self.note}

    @classmethod
    def from_dict(cls, data: dict) -> "Bookmark":
        return cls(chapter_index=int(data["chapter_index"]),
                   paragraph_index=int(data.get("paragraph_index", 0)),
                   note=str(data.get("note", "")))


@dataclass
class SearchHit:
    """One search hit: where it is, plus a snippet of the paragraph
    around the first match (ellipsis when truncated)."""
    chapter_index: int
    chapter_id: str
    paragraph_index: int
    snippet: str


@dataclass
class EpubBook:
    title: str | None
    creator: str | None
    chapters: list[Chapter] = field(default_factory=list)
    skipped_nonlinear: list[str] = field(default_factory=list)
    toc: list[TocEntry] = field(default_factory=list)

    def full_text(self) -> str:
        """All chapters in spine order, separated by blank lines."""
        return "\n\n".join(ch.text for ch in self.chapters)

    def chapter_text(self, index: int) -> str:
        return self.chapters[index].text


def book_progress(book: EpubBook, chapter_index: int,
                  paragraph_index: int = 0) -> float:
    """Reading progress as a 0.0–1.0 fraction of the book's characters:
    characters in earlier chapters plus characters in earlier paragraphs
    of the current chapter, over the book's total characters. Indices
    are clamped (a position past the end is 1.0, not an error). A book
    with no text at all reports 0.0."""
    total = sum(len(ch.text) for ch in book.chapters)
    if total == 0 or not book.chapters:
        return 0.0
    chapter_index = max(0, min(chapter_index, len(book.chapters) - 1))
    done = sum(len(book.chapters[i].text) for i in range(chapter_index))
    chapter = book.chapters[chapter_index]
    paragraph_index = max(0, min(paragraph_index, len(chapter.paragraphs)))
    # Count exactly as Chapter.text joins (blank lines between
    # paragraphs), so the last paragraph of the last chapter is 1.0.
    if paragraph_index:
        done += len("\n\n".join(chapter.paragraphs[:paragraph_index]))
    return done / total


def search_epub(book: EpubBook, query: str, *,
                case_sensitive: bool = False,
                max_results: int = 50) -> list[SearchHit]:
    """Search chapter paragraphs (text only — markup is already
    stripped). Returns at most ``max_results`` hits in reading order.
    An empty query returns no hits (it matches everywhere, which is
    useless to a reader)."""
    if not query:
        return []
    needle = query if case_sensitive else query.lower()
    hits: list[SearchHit] = []
    for ci, chapter in enumerate(book.chapters):
        for pi, paragraph in enumerate(chapter.paragraphs):
            hay = paragraph if case_sensitive else paragraph.lower()
            at = hay.find(needle)
            if at == -1:
                continue
            start = max(0, at - 40)
            end = min(len(paragraph), at + len(query) + 80)
            snippet = paragraph[start:end]
            if start > 0:
                snippet = "…" + snippet
            if end < len(paragraph):
                snippet = snippet + "…"
            hits.append(SearchHit(chapter_index=ci, chapter_id=chapter.id,
                                  paragraph_index=pi, snippet=snippet))
            if len(hits) >= max_results:
                return hits
    return hits


class _NavParser(HTMLParser):
    """Collects TOC links from an EPUB3 navigation document: inside
    ``<nav epub:type="toc">``, each ``<a>`` inside a nested ``<ol>``
    becomes an entry whose level is the ``<ol>`` depth there."""

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.entries: list[tuple[str, str, int]] = []  # (title, href, level)
        self._in_toc = False
        self._ol_depth = 0
        self._link: list[str] | None = None
        self._link_href = ""

    def handle_starttag(self, tag: str, attrs) -> None:
        tag = tag.lower()
        attr = {k.lower(): v for k, v in attrs}
        if tag == "nav" and "toc" in attr.get("epub:type", "").split():
            self._in_toc = True
            return
        if not self._in_toc:
            return
        if tag == "ol":
            self._ol_depth += 1
        elif tag == "a" and self._link is None:
            self._link = []
            self._link_href = attr.get("href", "")

    def handle_endtag(self, tag: str) -> None:
        tag = tag.lower()
        if tag == "nav" and self._in_toc:
            self._in_toc = False
            return
        if not self._in_toc:
            return
        if tag == "ol":
            self._ol_depth = max(0, self._ol_depth - 1)
        elif tag == "a" and self._link is not None:
            title = "".join(self._link).strip()
            if title and self._link_href:
                self.entries.append((title, self._link_href,
                                     max(1, self._ol_depth)))
            self._link = None

    def handle_data(self, data: str) -> None:
        if self._in_toc and self._link is not None:
            self._link.append(data)


def _resolve_href(opf_dir: str, href: str) -> tuple[str, str]:
    """Split off any ``#fragment`` and resolve the file part against
    the OPF directory, as a POSIX path inside the EPUB."""
    file_part, _, fragment = href.partition("#")
    file_part = file_part.replace("\\", "/")
    entry = posixpath.normpath(posixpath.join(opf_dir, file_part)) \
        if opf_dir else posixpath.normpath(file_part)
    return entry, fragment


def load_epub(path: str | Path) -> EpubBook:
    """Open an EPUB file and parse its spine chapters (plus TOC when
    the book has a nav document or NCX)."""
    path = Path(path)
    if path.suffix.lower() in (".mobi", ".azw", ".azw3", ".kfx"):
        raise UnsupportedFormatError(
            f"MOBI/AZW books are not supported by the EPUB reader "
            f"(no verified parser here): {path}")
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
        if "META-INF/encryption.xml" in names:
            raise UnsupportedFormatError(
                "EPUB appears encrypted or DRM-protected "
                "(META-INF/encryption.xml present); DRM is never bypassed, "
                "and its text cannot be read by this engine.")
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
        manifest_props: dict[str, str] = {}
        manifest_types: dict[str, str] = {}
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
                    manifest_props[item_id] = el.get("properties", "")
                    manifest_types[item_id] = el.get("media-type", "")
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
            entry, _frag = _resolve_href(opf_dir, manifest[idref])
            if entry not in names:
                raise MalformedInputError(
                    f"Chapter file missing from EPUB: {entry}")
            paragraphs, ch_title = _chapter_from_xhtml(zf.read(entry))
            chapters.append(Chapter(id=idref, href=entry,
                                    title=ch_title, paragraphs=paragraphs))
        toc = _load_toc(zf, names, opf_dir, manifest,
                        manifest_props, manifest_types)
        return EpubBook(title=title, creator=creator,
                        chapters=chapters, skipped_nonlinear=skipped,
                        toc=toc)


def _load_toc(zf: zipfile.ZipFile, names: set, opf_dir: str,
              manifest: dict, manifest_props: dict,
              manifest_types: dict) -> list[TocEntry]:
    """EPUB3 nav document first, EPUB2 NCX as fallback, else []. A
    broken TOC never fails the whole book load — it is navigation
    metadata, not content — so parse errors here yield an empty TOC."""
    nav_id = next((i for i, props in manifest_props.items()
                   if "nav" in props.split()), None)
    if nav_id is not None:
        entry, _ = _resolve_href(opf_dir, manifest[nav_id])
        if entry in names:
            try:
                parser = _NavParser()
                parser.feed(zf.read(entry).decode("utf-8", errors="replace"))
                parser.close()
                out = []
                for title, href, level in parser.entries:
                    target, fragment = _resolve_href(opf_dir, href)
                    out.append(TocEntry(title=title, href=target,
                                        fragment=fragment, level=level))
                return out
            except Exception:
                return []
    ncx_id = next((i for i, mtype in manifest_types.items()
                   if mtype == "application/x-dtbncx+xml"), None)
    if ncx_id is not None:
        entry, _ = _resolve_href(opf_dir, manifest[ncx_id])
        if entry in names:
            try:
                root = _parse_xml(zf.read(entry), "toc.ncx")
            except MalformedInputError:
                return []
            out: list[TocEntry] = []

            def walk(node, level: int) -> None:
                for point in node:
                    if _local(point.tag) != "navPoint":
                        continue
                    label = ""
                    src = ""
                    for child in point:
                        if _local(child.tag) == "navLabel":
                            for text_el in child.iter():
                                if _local(text_el.tag) == "text":
                                    label = (text_el.text or "").strip()
                        elif _local(child.tag) == "content":
                            src = child.get("src", "")
                    if label and src:
                        target, fragment = _resolve_href(opf_dir, src)
                        out.append(TocEntry(title=label, href=target,
                                            fragment=fragment, level=level))
                    walk(point, level + 1)

            for el in root.iter():
                if _local(el.tag) == "navMap":
                    walk(el, 1)
                    break
            return out
    return []
