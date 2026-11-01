# Research Note — Processing Engine Candidates (31 Oct 2026)

> Stream 1 research snapshot. Web-checked 31 Oct 2026. These are **candidates and
> licence facts**, not integrations. Nothing here is implemented or tested in OmSuite.
> Versions are snapshots to re-confirm at integration; the binding inventory is
> `../DEPENDENCIES_AND_LICENSES.md`.

## 1. PDF — PDFium (BSD-3-Clause)

- PDFium is Google's BSD-3-Clause C++ PDF rendering/parsing engine, the engine behind
  Chrome's built-in viewer, based on Foxit technology. Multiple independent sources
  agree on BSD-3-Clause. Binary redistribution must reproduce the copyright notice,
  conditions, and disclaimer.
- Key limit, confirmed across sources: PDFium is a **rendering/parsing engine, not an
  authoring engine** — it has no HTML parser and no document-authoring layer. Wrappers
  (e.g. `PdfiumViewer`, archived 2019; maintained forks; `PDFiumCore` P/Invoke bindings)
  differ in API but share that limit. Conclusion for OmSuite: PDFium covers viewing/
  search/rendering; annotation, page ops, and forms need a verified additional layer
  (PDFBox candidate on JVM, or a platform API) — none of which is proven yet.
- Android note: `AndroidPdfViewer`-family libraries build on PdfiumAndroid. Android's
  own `PdfRenderer` platform API is viewing-only.
- Security note: PDFium has a CVE history (memory-corruption classes, e.g. 2017 TIFF
  decoder issues) — as with any parser of untrusted files, the version shipped must be
  current and the parser must run under the resource guards in ARCHITECTURE.md §7.
  This is a maintenance obligation, not a reason to reject the engine.

## 2. Office formats — Apache POI (Apache-2.0)

- Pure Java, Apache Software Foundation, Apache License 2.0. No Office installation,
  no native code, no COM bridge required. Stable release 5.5.1 (30 Nov 2025) per public
  records checked 31 Oct 2026; a 6.0 line was announced but not released at that check.
- Components: HSSF (`.xls`), XSSF (`.xlsx`), HWPF (`.doc`), XWPF (`.docx`), HSLF (`.ppt`),
  XSLF (`.pptx`); `poi-ooxml` covers the OOXML family; `poi-scratchpad` is needed for
  the legacy binary family. POI's own history describes HWPF as early-stage — legacy
  editing must be treated as weaker until tested.
- Key limit: POI is a **file-model library, not a rendering/layout engine** — it never
  lays out pages or renders a document. OmSuite's Writer/Slides UI must do its own
  rendering on top of the POI model; "POI integrated" must never be presented as
  "Word rendering works".
- Sheets: XSSF is mature and SXSSF streams huge workbooks; POI includes formula
  evaluation, which is the basis for the "real formula engine" requirement — but formula
  coverage, chart support, pivot support, and macro behaviour each need separate tests.
- Comparison noted: docx4j (Apache-2.0) offers a schema-complete OOXML model and
  DOCX→PDF via XSL-FO/FOP; POI is the pragmatic choice for heavy spreadsheet work,
  docx4j a credible alternative for Writer. Neither was integrated or tested here.

## 3. Archives — Apache Commons Compress (Apache-2.0) + 7Z/RAR licence notes

- Commons Compress is Apache-2.0, with a unified `ArchiveInputStream/OutputStream`
  API. Archivers: 7z, ar, arj, cpio, dump, tar, zip; compressors: gzip, bzip2, XZ, LZMA,
  Pack200, DEFLATE, Brotli, DEFLATE64, ZStandard, Z. Read-only: arj, dump, Brotli,
  DEFLATE64, Z.
- 7Z limits (from the project's own limitations page): requires XZ for Java; file /
  `SeekableByteChannel` based, not streamable; encryption, solid compression, and header
  compression supported only when reading; writing supports uncompressed, LZMA, LZMA2,
  BZIP2, Deflate (reading additionally AES-256/SHA-256, DEFLATE64); no multi-volume
  writing; only a subset of 7Z methods/filters.
- TAR limits: subset of GNU/POSIX extensions; sparse files cannot be written.
- RAR (decisive): the UnRAR licence is a freeware licence, not an open-source licence.
  Its clause 2 permits using UnRAR source in software handling RAR archives, but
  **prohibits using it to develop a RAR-compatible archiver or re-create the proprietary
  RAR compression algorithm**. 7-Zip carries the same restriction as "LGPL + unRAR
  restriction". Consequence: OmSuite RAR creation is Not supported by design; extraction
  is a separate candidate capability (junrar/unrar-based, or libarchive on Windows 11
  23H2+, which natively supports RAR extraction). RAR5 coverage varies by extractor and
  is Not verified.
- Security note: Commons Compress has faced decompression-bomb / zip-slip reports in
  its history — OmSuite's archive safety rules (ARCHITECTURE.md §7) are therefore
  mandatory, not optional, for any adapter built on it.

## 4. OCR — Tesseract (Apache-2.0), Tesseract4Android wrapper, ML Kit rejected as default

- Tesseract itself is Apache-2.0 (HP origins, Google-sponsored since 2006). The
  maintained Android direction is **Tesseract4Android** (Apache-2.0 wrapper; 4.8.0
  wrapping Tesseract 5.5.0 seen 31 Oct 2026). The older tess-two wrapper is
  **no longer maintained** (its own project page says so) and must not be selected.
- Language data (`tessdata`) files have their own licences (the English 4.0.0 model
  is Apache-2.0); every additional language must be licence-checked before bundling.
- ML Kit: on-device text recognition exists, but it is a proprietary Google SDK, and
  published terms describe usage/performance metrics being sent to Google. That is in
  tension with OmSuite's no-telemetry constraint, so ML Kit is **not** the default
  (DECISION_LOG.md D-09). Reconsideration requires terms re-verification + a user
  decision, not an engineering shortcut.
- Windows OCR candidate (unverified): `Windows.Media.Ocr` platform API — language
  availability and offline behaviour to be verified by stream 3.

## 5. E-books — EPUB first, MOBI/AZW separate

- EPUB is a ZIP + XML open standard with a real parser path (epublib is the usual JVM
  candidate, but its licence/maintenance status could **not** be confirmed from the
  sources checked 31 Oct 2026 — recorded as "to verify" in the dependency inventory,
  not assumed).
- MOBI is a PalmDB-derived container; AZW is Amazon's variant, often DRM-wrapped.
  Neither inherits EPUB support. No parser candidate is selected for either, and DRM
  circumvention is excluded outright.

## 6. What was NOT researched to a conclusion (honest gaps)

- Exact ODF engine choice (ODF Toolkit vs alternatives) — needs an integration trial.
- Windows-side document/PDF/OCR engines — depend on the Windows stack decision (D-02).
- Media codec matrices per Android device / Windows version — must be tested on real
  targets, not derived from documentation.
- Markdown renderer selection per platform.
- HEIC codec availability on Windows target PCs (depends on the HEIF extension install
  state — a deployment question, not just a library question).
- LibreOffice embedding feasibility — explicitly unevidenced; see DECISION_LOG.md D-07.
  No conclusion is drawn here beyond "do not assume it".

## Sources checked 31 Oct 2026 (web search)

PDFium licence/rendering role; Apache POI licence/components/version; Commons Compress
limitations/user guide; UnRAR licence text and 7-Zip LGPL+unRAR restriction; Tesseract /
Tesseract4Android / tess-two maintenance status; Tauri 2 licensing (see Windows stack
note); AndroidX Room/Compose Apache-2.0 licensing. Full URLs were returned by the search
tool; the key licence facts above are the ones relied on. Where a source was a secondary
summary (not the project's own page), the dependency inventory marks the fact
"to verify" at integration rather than treating the summary as conclusive.
