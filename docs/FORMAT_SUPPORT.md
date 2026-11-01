# OmSuite — Format Support Matrix

> **Status:** Stream 1 (architecture + research) draft, 31 Oct 2026.
> **No cell in this matrix is backed by an executed OmSuite test.** This stream wrote no
> application code and ran no format tests. Every cell therefore defaults to
> **Not verified** except where a hard, evidenced reason makes a capability
> **Not supported** (exactly one such case: RAR creation — see Archives).
>
> **How to read a cell:**
> - **Supported** — implemented and verified by an executed test. *No cell currently holds
>   this value.* Any future claim of Supported must cite the test evidence.
> - **Partial** — some of the operation works, with stated limits. *No cell currently
>   holds this value either* — partial support is expected for legacy formats once
>   engines are integrated, but expecting it is not evidence of it.
> - **Not supported** — evidenced as unavailable (licence prohibition, platform lack,
>   or an explicit design exclusion). Only RAR creation qualifies today.
> - **Not verified** — the default. It means: *we do not know yet*. It does **not** mean
>   "probably works", "the extension is recognised", or "another app can do it".
>
> **Never advertise a capability from extension recognition alone.** A file row showing
> a `.docx` icon is not DOCX editing. A Converter entry must come from the per-platform
> conversion registry (ARCHITECTURE.md §5.8) with a tested engine behind it — otherwise
> the conversion simply does not appear in the UI.
>
> **Per-platform, always.** A capability on Android says nothing about Windows and vice
> versa, because the engines differ (DECISION_LOG.md D-03, D-07).
>
> **Project licence: NOT YET SELECTED.** No `LICENSE` file exists. Third-party engine
> licences are recorded in DEPENDENCIES_AND_LICENSES.md and still apply in full.

## Coverage counts (this draft)

| Scope | Count |
|---|---|
| Formats evaluated | **37** (see list below) |
| Cells per format | 8 (Android Open/Create/Edit/Convert + Windows Open/Create/Edit/Convert) |
| Total cells | **296** |
| Supported | **0** |
| Partial | **0** |
| Not supported | **2** (RAR Create on Android + RAR Create on Windows) |
| Not verified | **294** |

Formats: DOC, DOCX, ODT, RTF, TXT, XLS, XLSX, ODS, CSV, PPT, PPTX, ODP, PDF, JPG, PNG,
SVG, TIFF, HEIC, ZIP, RAR, 7Z, TAR, EPUB, MOBI, AZW, HTML, MHTML, MD, JSON, XML, YAML,
PSD, AI, EML, MSG, VCF, ICS.

## Completion pass — 1 Nov 2026: verified promotions (supersedes the table below ONLY for the cells listed here)

Test evidence: Windows `npm test` 31/31; shared `unittest` 69 run / 68 pass / 1 skipped;
Android unit tests exist but are CI-verified only (local Gradle blocked), and Android
device behaviour is Not Tested — so Android cells below are Partial at most, never
Supported on device evidence alone.

- **TXT Open/Create/Edit → Supported (both platforms, UTF-8 plain text).** Writer/Editor
  + text-core tests (Windows) and TextUtils tests (shared/Android).
- **MD Open/Create/Edit → Partial (both platforms).** Markdown subset only (headings,
  bold, italic, lists, code) per markdown tests; tables/footnotes Not verified.
- **JSON Open/Create/Edit + Convert (pretty-print) → Supported (both platforms).**
  validateJson/format tests (Windows, shared, Android JsonUtils).
- **CSV Open/Create/Edit → Partial (both platforms).** Sheets grid + CSV load/save;
  formulas limited to `+ - * /`, parens, A1 refs, SUM/AVERAGE (sheet-core / Sheet tests).
  CSV→JSON and JSON→CSV Convert → Partial (round-trip tested, shared + apps).
- **XLSX → Partial for the shared engine ONLY** (single worksheet, no styles/dates/
  merged cells, formulas preserved and recomputed; sheet_core tests). App Sheets cells
  for XLSX remain **Not verified** — the apps load/save CSV, not XLSX.
- **PDF Open (view) → Partial (both platforms).** Android PdfRenderer view; Windows
  embed view + best-effort text extract (pdf-core tests on synthetic PDFs). PDF
  Create/Edit (merge/split/annotation) → **Not supported in this build** (no PDF library
  vendored; buttons disabled with reason). PDF text extract is best-effort only
  (no layout, font/ToUnicode, scanned-image, or encrypted-PDF support).
- **ZIP Open (browse)/Create/Extract → Supported (both platforms, stored+deflate).**
  zip-core / ZipUtils / archive_core round-trip tests, traversal guard tested.
  Encrypted entries are refused, not extracted. Zip64, RAR, 7Z, TAR remain Not verified
  (RAR Create remains Not supported per the licence reason in the table).
- **EPUB Open → Partial (both platforms).** Plain-text chapter reading only (container/
  OPF/spine, paragraph text; epub-core / EpubParser tests on synthetic EPUBs).
  No images, styles, DRM, or EPUB Create/Edit.
- **HTML Create → Partial (Slides export only).** Deck → single HTML file (slide_core
  tests; Android export is text-only, Windows embeds images as data URLs).
- **JPG/PNG/audio/video, MOBI/AZW, DOC/DOCX, XLS, ODS, PPT/PPTX, ODP, SVG/TIFF/HEIC,
  PSD/AI, EML/MSG/VCF/ICS, ODT/RTF/XML/YAML → unchanged: Not verified** in this matrix.
  Media playback and OCR have no executed playback/recognition test in this pass, so
  they are NOT promoted here even though viewer/player/ML Kit UI exists in the apps.
  All other cells in the table below remain as written.

> Note on "Open" vs "Preview": the Master Instructions use Open/Preview as one column.
> In this matrix, **Open** means read + display in the owning module (or a preview where
> the module's scope is preview-only, stated in the notes). A format whose only honest
> behaviour is "show a preview, cannot edit" will be recorded as Open = Partial with a
> note, once an engine proves even that — today it is Not verified.

---

## 1. Documents

| Format | Android Open | Android Create | Android Edit | Android Convert | Windows Open | Windows Create | Windows Edit | Windows Convert | Notes / limitations |
|---|---|---|---|---|---|---|---|---|---|
| DOC | Not verified | Not verified | Not verified | Not verified | Not verified | Not verified | Not verified | Not verified | Legacy binary (OLE2). Candidate engine family: Apache POI HWPF — documented as early-stage/partial in POI's own history; editing fidelity expected to be weaker than DOCX, but that expectation is **not** evidence. No test run. |
| DOCX | Not verified | Not verified | Not verified | Not verified | Not verified | Not verified | Not verified | Not verified | OOXML. Candidate: POI XWPF (Android/JVM) / Windows engine per stack decision. POI is a file-model library, not a layout engine — pagination/rendering fidelity is a separate verification. Tracked changes, fields, content controls: separately Not verified. |
| ODT | Not verified | Not verified | Not verified | Not verified | Not verified | Not verified | Not verified | Not verified | OpenDocument Text. No default engine selected yet; ODF Toolkit/ODFDOM is a candidate to evaluate at integration. Do not assume POI covers ODT editing. |
| RTF | Not verified | Not verified | Not verified | Not verified | Not verified | Not verified | Not verified | Not verified | Rich Text Format. No engine candidate selected yet. Text-level handling may be simpler than DOCX, but no implementation or test exists. |
| TXT | Not verified | Not verified | Not verified | Not verified | Not verified | Not verified | Not verified | Not verified | Plain text. Implementable via the Code/Text Editor with no binary engine — but "implementable" is not "implemented". Encoding/line-ending preservation is a stated requirement, still untested. Closest to genuinely shippable first; still Not verified until the editor exists and is tested. |

## 2. Spreadsheets

| Format | Android Open | Android Create | Android Edit | Android Convert | Windows Open | Windows Create | Windows Edit | Windows Convert | Notes / limitations |
|---|---|---|---|---|---|---|---|---|---|
| XLS | Not verified | Not verified | Not verified | Not verified | Not verified | Not verified | Not verified | Not verified | Legacy binary (BIFF, OLE2). Candidate: POI HSSF. Advanced features may not round-trip; formula/chart/pivot/macro compatibility each separately Not verified. |
| XLSX | Not verified | Not verified | Not verified | Not verified | Not verified | Not verified | Not verified | Not verified | OOXML. Candidate: POI XSSF + its formula evaluator (the "real formula engine" requirement). Formula errors must surface per-cell; charts, pivots, macros each separately Not verified. POI does not render charts — chart display is a separate verification. |
| ODS | Not verified | Not verified | Not verified | Not verified | Not verified | Not verified | Not verified | Not verified | OpenDocument Spreadsheet. No default engine selected yet; ODF candidate to evaluate. Formula compatibility with XLSX formulas is separately Not verified. |
| CSV | Not verified | Not verified | Not verified | Not verified | Not verified | Not verified | Not verified | Not verified | Plain tabular text. No formulas, styles, or multiple sheets by definition. Any XLSX→CSV conversion must warn about loss (extra sheets, formatting, formulas→values) — warning text is specified, conversion itself is Not verified. Delimiter/encoding handling untested. |

## 3. Presentations

| Format | Android Open | Android Create | Android Edit | Android Convert | Windows Open | Windows Create | Windows Edit | Windows Convert | Notes / limitations |
|---|---|---|---|---|---|---|---|---|---|
| PPT | Not verified | Not verified | Not verified | Not verified | Not verified | Not verified | Not verified | Not verified | Legacy binary (OLE2). Candidate: POI HSLF. Viewing/playing ≠ authoring; editing fidelity expected weaker than PPTX, unverified. |
| PPTX | Not verified | Not verified | Not verified | Not verified | Not verified | Not verified | Not verified | Not verified | OOXML. Candidate: POI XSLF (Android/JVM) / Windows engine per stack. Slide rendering, animations, transitions, speaker notes each separately Not verified. |
| ODP | Not verified | Not verified | Not verified | Not verified | Not verified | Not verified | Not verified | Not verified | OpenDocument Presentation. No default engine selected yet; ODF candidate to evaluate. |

## 4. PDF

| Format | Android Open | Android Create | Android Edit | Android Convert | Windows Open | Windows Create | Windows Edit | Windows Convert | Notes / limitations |
|---|---|---|---|---|---|---|---|---|---|
| PDF | Not verified | Not verified | Not verified | Not verified | Not verified | Not verified | Not verified | Not verified | **"Edit" here is defined narrowly** (ARCHITECTURE.md §5.4): annotation (highlight/comment/drawing/signature) + page operations (insert/delete/extract/reorder/rotate) + form filling where supported. **Editing the original PDF text content is a distinct capability and is Not verified for every candidate.** Candidates: PDFium (BSD-3-Clause) for rendering/parsing; PDFBox (Apache-2.0) as a manipulation candidate on JVM. Android `PdfRenderer` is viewing-only. Merge/split, compression, and PDF↔image conversion are separately Not verified and only to be offered where quality is verified. |

## 5. Images

| Format | Android Open | Android Create | Android Edit | Android Convert | Windows Open | Windows Create | Windows Edit | Windows Convert | Notes / limitations |
|---|---|---|---|---|---|---|---|---|---|
| JPG / JPEG | Not verified | Not verified | Not verified | Not verified | Not verified | Not verified | Not verified | Not verified | Preview + basic adjust (rotate/crop/adjust) is the scoped Media behaviour; "Edit" means those operations only, not advanced editing. Codec support is per-platform (OS decoders). |
| PNG | Not verified | Not verified | Not verified | Not verified | Not verified | Not verified | Not verified | Not verified | As JPG, plus transparency handling untested. |
| SVG | Not verified | Not verified | Not verified | Not verified | Not verified | Not verified | Not verified | Not verified | Vector format: preview/rendering depends on the platform renderer; no vector-editing engine is proposed. Edit is expected to be at most "open as image / replace", but even that is Not verified. Do not promise SVG editing. |
| TIFF | Not verified | Not verified | Not verified | Not verified | Not verified | Not verified | Not verified | Not verified | Multi-page TIFF, compression variants (LZW, JPEG, etc.), and bit depths vary by codec; per-platform codec support must be tested per variant, not per extension. |
| HEIC | Not verified | Not verified | Not verified | Not verified | Not verified | Not verified | Not verified | Not verified | Codec availability differs sharply by platform and OS version (Android device codecs vs Windows HEIF extension availability). This is the highest-risk image row: **do not assume HEIC opens on Windows** without verifying the target PC's codec situation. |

## 6. Archives

Archive operations are recorded as **Browse / Extract / Create** in the module spec
(Master §3.8), mapped here onto Open (= browse + preview contents) / Create / Edit
(= extract is not "edit" — see note) / Convert. Read the notes: the mapping is explicit
so the table shape stays uniform without mislabelling extraction as editing.

| Format | Android Open (browse) | Android Create | Android Extract* | Android Convert | Windows Open (browse) | Windows Create | Windows Extract* | Windows Convert | Notes / limitations |
|---|---|---|---|---|---|---|---|---|---|
| ZIP | Not verified | Not verified | Not verified | Not verified | Not verified | Not verified | Not verified | Not verified | *Extract is shown in the Edit column position for table uniformity; it means extraction, not editing the archive in place. Candidate: Commons Compress / `java.util.zip` (Android); Windows engine per stack. Creation of ZIP is the one archive-creation capability the Master Instructions require. Zip64, encoding, split archives: separately Not verified. |
| RAR | Not verified | **Not supported** | Not verified | Not verified | Not verified | **Not supported** | Not verified | Not verified | **Create = Not supported (both platforms) — the only Not-supported cells in this matrix.** Reason (evidenced, 31 Oct 2026): the UnRAR licence permits handling RAR archives but prohibits using the code to develop a RAR-compatible archiver or re-create the proprietary RAR compression algorithm. Extraction (browse/extract) is a separate, candidate-dependent capability (junrar/unrar-based or platform libarchive on Windows 11 23H2+) and remains Not verified, including RAR5 coverage. |
| 7Z | Not verified | Not verified | Not verified | Not verified | Not verified | Not verified | Not verified | Not verified | Candidate: Commons Compress (needs XZ for Java; file/seekable-channel based, not streaming; subset of 7Z methods; no multi-volume writing; no encryption on write; encryption read is a subset). Windows 7-Zip native (LGPL + unRAR restriction) is an alternative to evaluate against the not-yet-selected project licence. |
| TAR | Not verified | Not verified | Not verified | Not verified | Not verified | Not verified | Not verified | Not verified | Candidate: Commons Compress (subset of GNU/POSIX extensions; sparse-file write unsupported). TAR is usually combined with a compressor (`.tar.gz`); the combined form's support follows both layers and is separately Not verified. |

Archive safety rules (binding, ARCHITECTURE.md §7): traversal/absolute-path/symlink
entries rejected or neutralised; entry-count, total-size, per-file-size, and nesting
caps; conflict policy never silently overwrites. These rules are specified, not tested.

## 7. E-books

| Format | Android Open | Android Create | Android Edit | Android Convert | Windows Open | Windows Create | Windows Edit | Windows Convert | Notes / limitations |
|---|---|---|---|---|---|---|---|---|---|
| EPUB | Not verified | Not verified | Not verified | Not verified | Not verified | Not verified | Not verified | Not verified | Priority reader target (ZIP+XML standard). Candidate parser family: epublib (licence to be confirmed at integration — recorded as "to verify", not assumed). TOC, bookmarks, progress, search, themes, text size are reader features, each separately Not verified. |
| MOBI | Not verified | Not verified | Not verified | Not verified | Not verified | Not verified | Not verified | Not verified | PalmDB-derived container; needs its own parser evidence. No engine candidate selected. Do not infer MOBI support from EPUB support. |
| AZW | Not verified | Not verified | Not verified | Not verified | Not verified | Not verified | Not verified | Not verified | Amazon variant, often DRM-wrapped. **DRM is never bypassed.** A protected file that cannot be opened legitimately reports "cannot open (protected)". No engine candidate selected. |

## 8. Web / text formats

| Format | Android Open | Android Create | Android Edit | Android Convert | Windows Open | Windows Create | Windows Edit | Windows Convert | Notes / limitations |
|---|---|---|---|---|---|---|---|---|---|
| HTML | Not verified | Not verified | Not verified | Not verified | Not verified | Not verified | Not verified | Not verified | Edited as text; preview treats content as **untrusted** — no script execution, no external resources. "Open" as a rendered page ≠ safe preview; the safe-preview behaviour is specified, not tested. |
| MHTML | Not verified | Not verified | Not verified | Not verified | Not verified | Not verified | Not verified | Not verified | Single-file web archive (multipart). Parsing the multipart container and rendering embedded parts safely are separate, Not verified capabilities. No engine candidate selected. |
| MD | Not verified | Not verified | Not verified | Not verified | Not verified | Not verified | Not verified | Not verified | Markdown text editing + preview (preview renderer per platform, to be selected). Preview fidelity (tables, code blocks, footnotes) separately Not verified. |
| JSON | Not verified | Not verified | Not verified | Not verified | Not verified | Not verified | Not verified | Not verified | Text editing + validation/formatting helper. Validation rules and formatting behaviour are specified, not tested. |
| XML | Not verified | Not verified | Not verified | Not verified | Not verified | Not verified | Not verified | Not verified | Text editing; well-formedness checking is a helper, not a schema validator, unless a validator is integrated and tested. |
| YAML | Not verified | Not verified | Not verified | Not verified | Not verified | Not verified | Not verified | Not verified | Text editing; indentation sensitivity makes "formatting helpers" risky — any auto-format must warn or be opt-in. Parser (e.g. SnakeYAML, Apache-2.0) is a candidate for validation only, not selected. |

## 9. Design formats

| Format | Android Open | Android Create | Android Edit | Android Convert | Windows Open | Windows Create | Windows Edit | Windows Convert | Notes / limitations |
|---|---|---|---|---|---|---|---|---|---|
| PSD | Not verified | Not verified | Not verified | Not verified | Not verified | Not verified | Not verified | Not verified | Preview/limited import only, unless genuine editing is proven (Master §4). No editing engine is proposed. Layered-PSD rendering fidelity is a separate, Not verified question. Do not promise PSD editing. |
| AI | Not verified | Not verified | Not verified | Not verified | Not verified | Not verified | Not verified | Not verified | As PSD, with the added complication that modern AI files are PDF-based containers in some versions and proprietary in others — version-dependent behaviour must be tested per variant, not per extension. |

## 10. Other formats

| Format | Android Open | Android Create | Android Edit | Android Convert | Windows Open | Windows Create | Windows Edit | Windows Convert | Notes / limitations |
|---|---|---|---|---|---|---|---|---|---|
| EML | Not verified | Not verified | Not verified | Not verified | Not verified | Not verified | Not verified | Not verified | Email message preview/import only. No sending capability is in scope. Attachment handling and encoding variants separately Not verified. |
| MSG | Not verified | Not verified | Not verified | Not verified | Not verified | Not verified | Not verified | Not verified | Outlook binary (OLE2). Candidate family: POI scratchpad (HSMF) — documented as a scratchpad component, i.e. weaker support; preview/import only, separately Not verified. |
| VCF | Not verified | Not verified | Not verified | Not verified | Not verified | Not verified | Not verified | Not verified | Contact import/preview (text-based vCard). Multi-contact files, photo fields, and encoding variants separately Not verified. No contact-sync feature exists or is implied. |
| ICS | Not verified | Not verified | Not verified | Not verified | Not verified | Not verified | Not verified | Not verified | Calendar import/preview (text-based iCalendar). Recurrence rules and timezone handling separately Not verified. No calendar-sync feature exists or is implied. |

---

## What changes a cell (promotion rules — binding on implementation streams)

1. **Not verified → Partial / Supported:** only on executed-test evidence against real
   sample files, recorded with the test name, sample, platform, and result. A compile
   success is not evidence. A screenshot of a menu is not evidence.
2. **→ Not supported:** only on evidenced grounds (licence prohibition as with RAR
   creation, platform API absence, or a tested engine failure with no viable alternative).
   "We didn't try" stays Not verified.
3. **Downgrades are allowed:** a cell marked Partial that fails round-trip testing
   (e.g. DOCX re-save losing tracked changes) must be narrowed with a precise limitation
   note, not left as a broad claim.
4. **Convert cells** change only when the conversion is registered in the per-platform
   conversion registry (ARCHITECTURE.md §5.8) **and** tested end-to-end (source unchanged,
   output valid, loss warning shown where applicable).
5. Every promotion updates this file **and** the conversion registry **and**
   `IMPLEMENTATION_STATUS.md` together — a matrix edit alone is not a shipped capability.

## Deferred testing that this matrix explicitly depends on (Master §13)

Full functional testing of every module and file operation; round-trip fidelity testing
across real DOCX/XLSX/PPTX/PDF samples; OCR accuracy testing; archive security test
corpus (traversal, bombs, nesting); large-file and long-duration performance testing;
cross-version Android device testing; Windows version/hardware matrix. None of these
has been performed by this stream. See STATUS.md.
