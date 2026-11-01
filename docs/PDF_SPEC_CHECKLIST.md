# OmSuite — PDF Spec Checklist (Master Instructions + Design Brief)

Date: 1 Nov 2026 (PDF-spec correction pass).
Authoritative spec: `~/workspace/user/files/OmSuite_Master_Development_Instructions.pdf`
(Master §§1, 3.1–3.12, 4, 10, 13, 16) and
`~/workspace/user/files/OmSuite_Complete_UI_UX_Design_Brief_Android_Windows.pdf`
(Design §§4–17). The user instruction for this pass: "jo PDF mene di hai, wo sab
kuch perfectly mujhe chahiye" and "mujhe app use leni hai, dikhawe ke liye nahi
hai". Breadth without depth was rejected; this checklist is the honesty record.

Status labels (Master §15):
- **Complete** — implemented to the documented scope; testing status stated separately.
- **Partially complete** — some operations work; the remainder is listed precisely.
- **Not implemented** — no real implementation exists.
- **Not verified** — code may exist, but executed verification is missing.

Testing status is separate from implementation status everywhere below:
- Windows: `npm test` 41/41 executed on Linux (correction pass). Windows runtime
  behaviour (Electron window, dialogs, fullscreen, Chromium PDF viewer) is
  **Not Tested** — CI Windows build is the next gate, device/PC testing is deferred
  per Master §13.
- Shared Python engines: `unittest` 118 run, 117 pass, 1 skipped (pre-existing
  root-permission skip). These prove the reference engines only, not the apps.
- Android: unit tests exist but were **Not Tested locally** (local Gradle is
  platform-blocked in this VM). Android compile + unit tests are verified by CI
  only. Android UI behaviour on a real device is **Not Tested**.

No module below is labelled Complete. The product as a whole is therefore
**Partially complete** under Master §1 — it must not be labelled "fully complete".

## Cross-cutting

| Requirement (Master / Design) | Android | Windows | Notes |
|---|---|---|---|
| Local-first: no Web, no cloud, no account, no sync, no telemetry | Works | Works | Verified by code inspection; no network/analytics calls in app code. GitHub is source hosting only, not a runtime feature. |
| Android touch-first bottom nav; Windows persistent sidebar + toolbar + status bar | Partially complete | Partially complete | Android bottom nav present; Windows sidebar/toolbar/status bar present. Adaptive tablet/foldable states Not verified. |
| Every visible control works or is disabled with a visible reason | Partially complete | Partially complete | Disabled-with-reason: PDF merge/split/page-ops, Windows OCR. No other enabled dead controls found in the scripted renderer audit (Windows) / code review (Android). |
| Loading / empty / error / permission-denied / success states | Partially complete | Partially complete | Present in File Manager, editors, archives, converter, scan. Large-file/long-operation states Not verified. |
| Project licence | Not implemented | Not implemented | **NOT YET SELECTED. No LICENSE file.** Blocks only the LICENSE file and reuse claims. Third-party notices still apply. |
| Signing | Not implemented | Not implemented | Android APK is debug-signed only; Windows installer is unsigned (SmartScreen warning expected). Never described as signed. |

## 1. Home Dashboard (Design §5)

| Operation | Android | Windows | Status |
|---|---|---|---|
| Recent files with type/location/modified, open action | Works | Works | Partially complete |
| Pinned files / favourite folders | Works (Room) | Works | Partially complete |
| Quick actions: New document / spreadsheet / presentation / Scan / Open / Convert | Works (navigation to the module) | Works | Partially complete |
| Storage overview where platform permits | Partially complete | Partially complete | Available-space reporting Not verified on device/PC |
| Recent activity / recovery items, no cloud activity implied | Partially complete | Partially complete | Recovery items exist as editor drafts, not a central recovery screen (see Settings) |
| Empty states explaining first open/create | Works | Works | Partially complete |

## 2. File Manager (Master §3.1, Design §6)

| Operation | Android | Windows | Status |
|---|---|---|---|
| Browse local files/folders (SAF granted folders on Android; native FS on Windows) | Works | Works | Partially complete |
| List / grid / detail views; sort name/type/size/date; search/filter | Works | Works | Partially complete |
| Favourites, recents, breadcrumbs | Works | Works | Partially complete |
| Create folder; rename, copy, move, duplicate, delete | Works | Works | Partially complete |
| Multi-select + Select all; properties (incl. modified date) | Works | Works | Partially complete |
| Preview supported types without full editor | Works (open in owning module) | Works | Partially complete |
| Progress for long operations | Partially complete (archive extraction progress) | Works (copy progress bar + counts) | Partially complete |
| Cancellation where safe | Not implemented | Not implemented | No cancel control offered; long ops run to completion or fail with an error. Not faked. |
| Conflict handling, never silently overwrite | Works (Keep both / Skip / Overwrite dialog) | Works (numbered " - Copy" name, count reported) | Partially complete |
| Permission denied / revoked / missing / read-only / low-storage handling | Works (error states; SAF revocation releases grant) | Works (error states) | Partially complete |
| Restore from Trash | Not implemented | Not implemented | Delete is permanent with confirmation on both platforms. Not offered as restore. |

## 3. Writer (Master §3.2, Design §7)

| Operation | Android | Windows | Status |
|---|---|---|---|
| Create / open / edit / save / Save As (TXT/MD/JSON/XML/YAML/HTML as text) | Works | Works | Partially complete |
| Bold / italic / underline / headings / lists | Works (Markdown markers; underline via `<u>` in preview, labelled) | Works (Markdown toolbar: bold, italic, heading, lists) | Partially complete |
| Tables, images, hyperlinks in documents | Not implemented | Not implemented | Not offered in Writer. Slides images are separate (see §5). |
| Page size / margins / orientation / headers / footers / page numbers / print preview | Not implemented | Not implemented | Not offered. Text editing is not page-layout editing. |
| Find / replace, undo / redo, selection, outline | Works (find match counts, replace-all, undo/redo, word/line/char counts) | Works | Partially complete |
| Autosave / recovery + visible save state, failure feedback | Works (draft recovery prompt, dirty/saved indicator) | Works (draft saved locally, restore prompt, saved indicator) | Partially complete |
| Preserve originals by default; overwrite confirmation | Works | Works | Partially complete |
| Spell-check | Not implemented | Not implemented | Not offered. |
| Syntax highlighting / line numbers / JSON validate+format / Markdown preview (Code Editor scope, Master §3.9) | Works (highlight toggle, line numbers in code view, JSON tools, MD preview subset) | Works (highlight toggle, line numbers gutter, find/replace, indent/outdent, CRLF/BOM preserved; mixed endings save as LF, labelled) | Partially complete |

## 4. Sheets (Master §3.3, Design §8)

| Operation | Android | Windows | Status |
|---|---|---|---|
| Grid, rows/columns, cell selection, formula bar, sheet tabs | Works (multiple sheets: add/delete/rename) | Works (multiple sheets: add/rename/delete, formula bar) | Partially complete |
| Formulas: `+ - * /`, parens, A1 refs, SUM/AVERAGE/MIN/MAX/COUNT, per-cell errors | Works (`#DIV/0!`, `#CIRC!`, `#NAME?`, `#REF!`, `#VALUE!`) | Works (same set + COUNT/MIN/MAX; errors pass through) | Partially complete |
| Other functions (IF, VLOOKUP, string literals, dates in formulas) | Not implemented | Not implemented | Error, not a fake value. |
| Number/date formats, borders, alignment, cell styles | Partially complete (General/2-decimals, ISO-date display-only) | Partially complete (General/Number/Currency/Percent/ISO Date) | Partially complete |
| Resize rows/columns, sort, filter, freeze panes | Works (sort by column header-fixed, filter, frozen header row) | Works (sort, filter, freeze first row+column, drag-resize columns) | Partially complete |
| Copy/paste, fill operations | Not implemented | Not implemented | Not offered. |
| Charts | Not implemented | Not implemented | Not offered. |
| Import/export CSV; workbook save | Works (CSV load/save; Android deck-style persistence via export) | Works (CSV per sheet; workbook Save/Open as JSON, all sheets + formats) | Partially complete |
| XLSX in the apps | Not implemented | Not implemented | Shared engine only: single-sheet, no styles/dates/charts (see Format matrix). Apps do not offer XLSX. |

## 5. Slides (Master §3.4, Design §9)

| Operation | Android | Windows | Status |
|---|---|---|---|
| Slide add / duplicate / delete / reorder; thumbnails | Works | Works | Partially complete |
| Title / body / image per slide; alignment, ordering | Works | Works | Partially complete |
| Themes, layouts, shapes | Not implemented | Not implemented | Not offered. |
| Speaker notes | Works (edited per slide, shown while presenting, exported) | Works (per-slide notes, presenting only) | Partially complete |
| Presentation mode + navigation | Works | Works (fullscreen, ←/→/Esc) | Partially complete |
| Deck save/load as a file | Not implemented (session only; HTML export is the persistence path, stated in UI) | Works (Save/Open as JSON + draft restore) | Partially complete |
| HTML export | Works (images embedded as base64 data URIs; one bad image no longer blocks export) | Works (images as data URLs) | Partially complete |
| PPTX import/export, animations, transitions | Not implemented | Not implemented | Not offered. |

## 6. PDF Studio (Master §3.5, Design §10)

| Operation | Android | Windows | Status |
|---|---|---|---|
| View, page thumbnails, page navigation, go-to-page | Works (thumbnails first 20 pages, First/Last/Prev/Next, go-to with range validation) | Works (embed viewer + navigation via viewer toolbar) | Partially complete |
| Search in extracted text, zoom, fit, rotation (view only) | Works (search count + snippet, zoom 0.5×–4×, view rotation 0/90/180/270) | Works (extracted-text search with prev/next + highlight, view zoom 0.5×–3×, view rotation 90° steps) | Partially complete |
| Save current page as image | Works (PNG via live holder) | Not implemented | Partially complete |
| Best-effort text extraction (FlateDecode, Tj/TJ) | Works | Works (tested on synthetic PDFs) | Partially complete |
| Highlights, annotations, comments, drawing, signatures, form filling | Not implemented | Not implemented | Not offered. |
| Page insert / delete / extract / reorder / rotate-in-file, merge, split, compression | Not implemented — **disabled with visible reason** (no PDF library vendored; PdfRenderer/embed view is render-only) | Not implemented — **disabled with visible reason** (same) | Partially complete (module) |
| Editing original PDF text content | Not implemented | Not implemented | Distinct from annotation; never offered. |
| Scanned / encrypted / layout-accurate PDFs | Not supported (best-effort only) | Not supported (best-effort only) | Partially complete |

## 7. Media (Master §3.6, Design §11)

| Operation | Android | Windows | Status |
|---|---|---|---|
| Image preview, zoom, rotate | Works (zoom slider 0.5×–4×, rotate, reset) | Works (zoom/rotate) | Partially complete |
| Image crop, basic adjustments, metadata display | Not implemented | Not implemented | Not offered. (Crop exists only in Scan page editing, not Media.) |
| Audio playback, seek, queue, speed | Works (queue, prev/next, auto-advance, speed 0.5×/1×/1.5×/2×) | Works (queue, seek, speed 0.5×–2×, ±10s seek) | Partially complete |
| Background audio playback (Android) | Not implemented | n/a | Not offered. |
| Video playback, seek, fullscreen | Works (seek slider + position polling, Restart, fullscreen; fullscreen restarts playback — new VideoView, noted) | Works (seek, fullscreen via HTML media) | Partially complete |
| Subtitles | Not implemented (VideoView exposes no track API; UI says so) | Partially complete (HTML media subtitle track selection where the file provides tracks) | Partially complete |
| Media editing / transcoding | Not implemented | Not implemented | View/playback only, never claimed as editing. |

## 8. E-books (Master §3.7, Design §12)

| Operation | Android | Windows | Status |
|---|---|---|---|
| EPUB open, table of contents, bookmarks, progress, text size, themes, search | Works (tappable TOC, bookmarks + position persisted in DataStore, progress % by chapter, text-size slider, Light/Sepia/Dark, search with snippets) | Works (TOC incl. NCX/nav/spine fallback, bookmarks persisted, progress resumed, text size 10–28px, Default/Sepia/Dark, search across chapters) | Partially complete |
| Reading position stored locally | Works | Works | Partially complete |
| EPUB images / styles / fonts, DRM, writing/editing | Not implemented / Not supported (DRM never bypassed; encrypted books report an error, not fake content) | Not implemented / Not supported (same; encryption flag reported, never decrypted) | Partially complete |
| MOBI / AZW | Not implemented | Not implemented | Not offered. |
| TXT fallback reading | Works | Works | Partially complete |

## 9. Archives (Master §3.8, Design §13)

| Operation | Android | Windows | Status |
|---|---|---|---|
| Browse contents before extraction | Works | Works (with per-entry checkboxes) | Partially complete |
| Extract all or selected; create ZIP | Works (extract all/selected, create ZIP, duplicate names renamed) | Works (extract all/selected, create ZIP stored+deflate, files only) | Partially complete |
| Progress, conflicts, traversal guard | Works (per-file progress, Keep both/Skip/Overwrite dialog, traversal entries skipped + reported) | Works (progress, never silently overwrites — numbered names, skipped encrypted entries reported) | Partially complete |
| Encrypted ZIP entries | Refused with error (no password support) | Refused with error, listed but not extractable | Partially complete |
| RAR / 7Z / TAR (browse, extract, create) | Not implemented | Not implemented | Not offered. RAR creation is additionally Not supported on licence grounds (UnRAR licence prohibits a RAR-compatible archiver). |
| Archive-bomb / size / nesting guards | Works (shared engine caps; app traversal guard) | Works (shared + zip-core guards) | Partially complete |

## 10. Converter (Master §3.10, Design §15)

| Operation | Android | Windows | Status |
|---|---|---|---|
| Verified pairs only, offered dynamically | Works (CSV→JSON, JSON→CSV, TXT→MD heuristic labelled, JSON pretty-print) | Works (CSV→JSON, JSON→CSV, JSON→JSON pretty, TXT→MD heuristic labelled) | Partially complete |
| Other pairs | Not implemented (not offered) | Not implemented (not offered) | Partially complete |
| Loss warnings, source unchanged by default, Save As destination | Works (source never modified, stated in UI) | Works (same; shared engine adds loss warnings) | Partially complete |
| Batch conversion | Not implemented | Not implemented | Not offered. |
| Local conversion history + clear | Works (last 10, Clear button) | Works (last 20, Clear also clears panes) | Partially complete |

## 11. Scan & OCR (Master §3.11, Design §16)

| Operation | Android | Windows | Status |
|---|---|---|---|
| Capture / import images, multi-page scans | Works (camera preview + gallery, multi-page) | Works (image pick + view only) | Partially complete |
| Crop, rotate, reorder, delete pages | Works (rotate 90°, crop via margin sliders, reorder/delete) | Works (zoom/rotate for the picked image) | Partially complete |
| On-device OCR, review + correction before export | Works (ML Kit Latin OCR, per-page separators, partial-failure honesty, editable result) | Not implemented — **disabled with visible reason** ("No OCR engine bundled (would require a Tesseract binary)") | Partially complete |
| Save scans as PDF / image / TXT | Works (TXT export; PDF export via platform PdfDocument, one image page per scan page, **no searchable text layer — stated in UI**, use TXT for searchable text) | Works (image view only; no scan PDF export) | Partially complete |
| OCR confidence display | Not implemented | n/a | Not offered. Partial-failure honesty is the substitute, not a fake confidence %. |
| Scanner driver bundled | Not implemented | Not implemented | Not offered. |

## 12. Settings, Local Data, Recovery (Master §3.12, Design §17)

| Operation | Android | Windows | Status |
|---|---|---|---|
| Light / dark / system theme, actually applied | Works (applied app-wide) | Works (applied) | Partially complete |
| Default save location, editor preferences | Works (default folder consumed by Files auto-open) | Works (default save location) | Partially complete |
| Cache clear, storage management, recents management | Works (cache clear, recents clear, favourites clear) | Works (cache clear, recents on/off + limit 0–50, favourites remove) | Partially complete |
| Autosave / recovery controls + recovery interface | Partially complete (editor draft recovery prompts; no central recovery screen) | Partially complete (editor draft recovery; no central recovery screen) | Partially complete |
| Privacy statement: no cloud account / no sync | Works (statement present and accurate) | Works (statement present and accurate) | Partially complete |
| Density / editor preference details | Not implemented | Not implemented | Not offered beyond the above. |

## Deferred testing (Master §13 — explicitly Not Tested, not claimed)

- Full functional testing of every module and every file operation.
- Android UI behaviour on a real device; Windows app runtime behaviour on Windows.
- Large-file and long-duration performance testing.
- Cross-version Android device testing; Windows version/hardware matrix.
- Round-trip fidelity across real DOCX/XLSX/PPTX/PDF samples (those formats are
  Not implemented in the apps; shared XLSX is single-sheet/no-style only).
- OCR accuracy testing across languages and image quality (Android ML Kit only).
- Archive security / malicious-file test corpus (guards are unit-tested, hostile
  files on device are Not Tested).
- Crash recovery, power interruption, low-storage scenarios.
- Accessibility testing and usability acceptance.
- Security review and dependency vulnerability audit.

## Overall verdict

**Partially complete.** All 12 modules are reachable in both apps and their
offered operations work end-to-end for real, with the Partial/Not-implemented
items above disabled or absent with reasons instead of decorative controls.
The product must not be labelled "fully complete" while any major module
remains Partial, while device/Windows-runtime testing is deferred, while
signing is debug/unsigned only, and while the project licence is not selected.
