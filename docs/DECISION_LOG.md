# OmSuite — Decision Log

> Every significant decision, with date, context, alternatives considered, rationale,
> and consequences. A decision recorded here is a **design decision**, not a claim that
> the thing decided has been implemented or tested. Implementation status lives in
> `IMPLEMENTATION_STATUS.md` (docs-ci-packaging stream) and in each stream's `STATUS.md`.
>
> **Project licence: NOT YET SELECTED.** No `LICENSE` file exists and none is added by
> this stream. See D-10. No token, password, keystore, or secret is recorded anywhere
> in this log (or anywhere in this repo).

## How to read this log

- **Status:** `Decided` = binding for implementation streams unless superseded by a later
  entry. `Direction` = preferred, but a later evidence-based entry may change it.
  `Open` = explicitly not decided here; the owning stream decides and records it.
- **Superseded** entries are never deleted; a new entry records what changed and why.
- Dates are in IST (user timezone) unless stated.

---

## D-01 — Android: Kotlin + Jetpack Compose (direction)

- **Date:** 31 Oct 2026
- **Status:** Direction (from Master Instructions §5.1, confirmed by this stream's research)
- **Context:** Android must be a genuine native app, not an HTML wrapper. The Master
  Instructions name Kotlin + Jetpack Compose as the "preferred direction, subject to
  final compatibility research".
- **Alternatives considered:**
  - *Flutter/Dart for Android:* one codebase with desktop in theory, but the Master
    Instructions scope Android as native, and Compose keeps the Android app in the
    platform's own UI idiom (Material 3, system back, share sheet, SAF). Rejected as
    the Android direction, not as a technology in general.
  - *XML Views (legacy Android UI):* mature, but Compose is the current Android UI
    direction and the Master brief's adaptive-layout requirements map naturally to it.
  - *Tauri-mobile / WebView shell for Android:* rejected — it would risk delivering
    exactly the HTML-wrapper outcome the Master Instructions prohibit.
- **Rationale:** Native, current, best SAF/CameraX/Media3/Room integration; matches the
  "preferred direction" the user already approved in the Master Instructions.
- **Consequences:** Android stream builds in Kotlin/Compose; min SDK, Compose BOM, and
  Room versions are pinned by that stream at integration time, not here. If the Android
  stream finds a compatibility blocker (e.g. a required engine with no JVM/Android
  binding), it records a superseding entry here — it does not silently switch stacks.
- **Evidence:** Master Instructions §§5.1, 6; no code exists yet, so this is Not verified
  as an implementation.

## D-02 — Windows stack: evaluation done here, decision left to stream 3 (open)

- **Date:** 31 Oct 2026
- **Status:** **Open — owned by stream 3** (`apps/windows/DECISION.md`)
- **Context:** Master Instructions §5.2/§6 require evaluating Tauri 2 + React/TypeScript/
  Rust and alternatives before committing. This stream performed the evaluation so
  stream 3 does not start from zero, but the task boundary forbids this stream from
  deciding for another stream's directory.
- **Candidates evaluated:** Tauri 2 + React/TS/Rust (leading candidate), Electron + TS,
  .NET WPF/WinUI 3 + C#, Flutter desktop, pure Rust (egui/iced). Full comparison:
  `research/WINDOWS_STACK_EVALUATION.md`.
- **Summary of the evaluation (not a decision):**
  - Tauri 2 leads on installer size (system WebView2, no bundled Chromium), Rust backend
    for real native file I/O, and MIT/Apache-2.0 licensing — but it still needs separate
    document-engine choices, and WebView2 becomes a runtime prerequisite.
  - Electron is the most battle-tested but the largest/heaviest; the shell alone solves
    no document-engine problem.
  - .NET is the most native-feeling on Windows but splits the engine ecosystem from
    Android's JVM choices; WinUI 3 packaging needs verification.
  - Flutter desktop and pure-Rust UI carry the highest editor-implementation risk for a
    format-heavy suite.
- **Consequences:** No Windows code, installer, or "Windows uses X" claim may cite this
  log as its authority until stream 3 records the decision. Any doc that names a Windows
  stack before then must label it "candidate under evaluation".

## D-03 — Shared-code boundary: share semantics and interfaces, not storage or UI

- **Date:** 31 Oct 2026
- **Status:** Decided
- **Context:** Master Instructions §5.3: share processing logic only where it genuinely
  improves correctness; use platform-specific storage adapters and UI; do not force a
  single abstraction where permission models differ.
- **Alternatives considered:**
  - *Maximal sharing (one cross-platform core incl. storage):* rejected — SAF URIs and
    Windows paths have different identity, lifetime, and revocation; a shared storage
    layer would leak one platform's assumptions into the other.
  - *Zero sharing (two fully independent apps):* rejected — file-operation semantics,
    conflict handling, safe-write protocol, and capability labels would drift apart,
    and the Converter's honesty gate would be implemented twice with different bugs.
- **Rationale:** The chosen middle path — shared *contracts* (interfaces, operation
  lifecycle, error taxonomy, capability vocabulary) with platform-specific *adapters* —
  is exactly what lets an engine be replaced without rewriting a module (ARCHITECTURE.md §1.1).
- **Consequences:** `shared/` contains contracts and tests (stream 4), not UI code and
  not a storage implementation. A PR that puts SAF or Win32 path logic in `shared/` is
  out of bounds and must be moved to the platform adapter.

## D-04 — Local storage: Room/SQLite on Android; SQLite on Windows (via its stack)

- **Date:** 31 Oct 2026
- **Status:** Decided (Android side); Windows binding Open (follows D-02)
- **Context:** Master Instructions §§5.1, 8 require a justified local persistence layer
  holding metadata only — never duplicate copies of large user documents.
- **Alternatives considered:**
  - *DataStore / plain files only:* insufficient for recents/favourites/recovery/
    conversion-history queries with transactions and migration.
  - *NoSQL / object store on device:* unjustified complexity; the data is relational
    (files, positions, history) and small.
  - *Storing document copies in the DB "for safety":* rejected — bloats the DB, doubles
    storage, and contradicts Master §8.
- **Rationale:** Room is the standard Jetpack SQLite layer (Apache-2.0), with typed
  migrations; SQLite itself is public domain. The schema in ARCHITECTURE.md §6 stores
  pointers + metadata, with a corruption path that never deletes user files.
- **Consequences:** Destructive migration is prohibited (ARCHITECTURE.md §6.2). Windows
  uses SQLite through whatever binding its chosen stack provides; the *schema* (tables,
  columns, migration versions) should mirror Android's so behaviour matches, even though
  the binding code differs.

## D-05 — SAF vs native filesystem on Android: SAF for user files

- **Date:** 31 Oct 2026
- **Status:** Decided
- **Context:** Android 10+ scoped storage. The Master Instructions (§5.1) require SAF /
  document picker where required, correct URI-permission management, and no assumption
  of unrestricted filesystem access.
- **Alternatives considered:**
  - *Requesting broad "All files access" (`MANAGE_EXTERNAL_STORAGE`):* rejected as the
    default — it is a restricted permission, hostile to review, and unnecessary when
    SAF covers user-chosen files/folders. (If a future, evidenced use case genuinely
    needs it, that is a new decision with its own justification — not a quiet default.)
  - *Raw `java.io.File` paths everywhere:* rejected — paths from SAF picks are not
    stable identities and re-opening them later fails.
  - *MediaStore-only access:* insufficient — it covers media, not documents/archives.
- **Rationale:** SAF + persistable URI permissions is the platform-blessed path for a
  file manager on modern Android, and it matches the brief's "explain storage permissions
  clearly" requirement.
- **Consequences:** Recents/favourites store URIs; every re-open handles revocation /
  moved / deleted files as a normal "unavailable" state. The Android stream must test
  (when it reaches testing) the revoke-permission and restart flows explicitly.

## D-06 — PDF engine direction: PDFium (rendering/parsing) + a separate manipulation layer

- **Date:** 31 Oct 2026
- **Status:** Direction (engine candidate, not integrated)
- **Context:** PDF Studio needs viewing, search, zoom, rotation, annotations, forms, and
  page operations. The Master Instructions (§6) list "PDFium or suitable alternative".
- **Alternatives considered:**
  - *Android `PdfRenderer` (platform API) for Android viewing:* viable for viewing only;
    it does not provide annotation, page manipulation, or form filling, so it cannot be
    the whole PDF story. Kept as a possible viewing-only fallback on Android.
  - *Apache PDFBox (Java):* strong for manipulation/creation, Apache-2.0, JVM-native
    (good for Android); rendering quality and Android size need verification. Candidate
    for the manipulation layer alongside PDFium, or as the Android-side engine.
  - *iText (AGPL/commercial):* rejected as the default — AGPL obligations and/or
    commercial licensing would complicate a public repo whose own licence is not yet
    selected (D-10). Revisit only with an explicit licence decision.
  - *Bundling a commercial PDF SDK:* rejected without a user-approved purchase/licence.
- **Rationale:** PDFium (BSD-3-Clause, Google-maintained, powers Chrome's viewer) is the
  strongest rendering/parsing core; it is a renderer/parser, not an authoring engine, so
  annotation/page/form capabilities must be verified separately and must not be implied
  from "uses PDFium". See FORMAT_SUPPORT.md PDF row and research/ENGINE_RESEARCH.md.
- **Consequences:** No PDF capability (annotation, forms, merge/split, compression) is
  marked Supported until an integration test proves it. PDF text *editing* of original
  content is a separate capability and remains Not verified for every candidate.

## D-07 — Document / spreadsheet / presentation engines: JVM libraries first on Android; Windows engines follow its stack

- **Date:** 31 Oct 2026
- **Status:** Direction (engine candidates, not integrated)
- **Context:** Writer/Sheets/Slides need real read/write engines with a real formula
  engine for Sheets — not a fake demo (Master §§3.2–3.4).
- **Alternatives considered:**
  - *Apache POI (Java, Apache-2.0):* XWPF (DOCX), XSSF (XLSX, incl. formula evaluation),
    XSLF (PPTX); HSSF/HWPF/HSLF for legacy binary formats with known weaker fidelity.
    Leading Android candidate. Caveat, verified in research: POI is a file-model library,
    not a layout/rendering engine — it does not paginate a Word document or render a
    slide. UI rendering is the app's job.
  - *docx4j (Java, Apache-2.0):* schema-complete OOXML model, DOCX→PDF via XSL-FO/FOP;
    credible alternative for Writer, weaker than POI for heavy spreadsheet work.
  - *LibreOffice embedding:* **not assumed feasible** (Master §6 explicitly warns).
    Binary size, Android feasibility, and maintenance cost are unevidenced. Any stream
    proposing it must evidence all three before adoption — see ARCHITECTURE.md §10 Q3.
  - *ODF Toolkit / ODFDOM (Apache-2.0):* candidate for ODT/ODS/ODP if POI's ODF support
    proves insufficient; not the default.
  - *Commercial suites (Aspose etc.):* rejected as defaults — commercial licensing,
    unevidenced in this phase.
- **Rationale:** POI gives one Apache-2.0 JVM family covering DOCX/XLSX/PPTX plus legacy
  formats, with a real formula evaluator for Sheets. That matches Android's Kotlin/JVM
  stack directly; Windows engines are chosen with its stack (D-02) and may differ, behind
  the same adapter interfaces (D-03).
- **Consequences:** Legacy DOC/XLS/PPT editing is expected to be Partial at best, and
  XLS macros, DOCX tracked-changes fidelity, and PPTX animation fidelity are separate
  verification items — none is implied by "POI is integrated". All remain Not verified
  until tested (FORMAT_SUPPORT.md).

## D-08 — Archive engines: Apache Commons Compress (+ XZ for Java) for ZIP/7Z/TAR; RAR extract-only, never create

- **Date:** 31 Oct 2026
- **Status:** Direction (engine candidates, not integrated); RAR-create prohibition: Decided
- **Context:** Archives module must browse before extracting, extract all/selected, and
  create ZIP (Master §3.8). RAR/7Z/TAR support must be validated against library licences.
- **Alternatives considered:**
  - *`java.util.zip` alone:* insufficient (no 7Z/TAR, weak Zip64/encoding control).
  - *Apache Commons Compress (Apache-2.0):* ZIP, TAR, 7Z (read + write subset), with
    known limits: 7Z needs XZ for Java, is file/seekable-channel based (not streaming),
    has a subset of 7Z methods, and cannot write multi-volume archives.
  - *junrar / unrar-based extraction:* extraction only. The UnRAR licence (freeware, not
    an open-source licence) permits handling RAR archives but **prohibits using the code
    to develop a RAR-compatible archiver or re-create the RAR compression algorithm**.
    Hence RAR **creation is Not supported by design** — see FORMAT_SUPPORT.md.
  - *7-Zip native (LGPL + unRAR restriction):* possible Windows-side engine, but its
    LGPL + unRAR-restriction combination must be reviewed against the (not yet selected)
    project licence before bundling; Commons Compress avoids that question on Android.
- **Rationale:** Commons Compress covers the required ZIP creation plus 7Z/TAR within a
  single permissive licence; RAR is honestly extract-only.
- **Consequences:** The Converter/Archives UI must never offer "Create RAR". Encrypted
  7Z writing is not supported by Commons Compress; encrypted 7Z reading is a subset.
  All archive capabilities remain Not verified until integration tests run.

## D-09 — OCR: on-device Tesseract (Apache-2.0) as the OCR direction; ML Kit explicitly not the default

- **Date:** 31 Oct 2026
- **Status:** Direction (engine candidate, not integrated)
- **Context:** Scan & OCR must be on-device only — no cloud OCR APIs (Master §§3.11, 2).
- **Alternatives considered:**
  - *Tesseract via Tesseract4Android (Apache-2.0 wrapper around Tesseract, Apache-2.0):*
    fully on-device, inspectable, language data bundled per language. Leading candidate.
    Note: the older tess-two wrapper is unmaintained; Tesseract4Android is the maintained
    fork direction. Language-model licences must be checked per language.
  - *Google ML Kit on-device text recognition:* processes images on-device, but it is a
    proprietary SDK under Google's terms, and published terms describe usage/performance
    metrics being sent to Google — that sits uncomfortably with the "no telemetry /
    silent upload" constraint. Rejected as the default; reconsider only if its terms are
    re-verified and the no-telemetry constraint is explicitly re-examined by the user.
  - *Cloud OCR APIs:* prohibited by the product constraints. Not considered.
  - *Windows OCR:* Windows.Media.Ocr (platform API) is a candidate for the Windows side;
    its language availability and offline behaviour need verification by stream 3.
- **Rationale:** Tesseract is the only candidate that is simultaneously on-device,
  open-source (Apache-2.0), and free of a vendor telemetry question.
- **Consequences:** OCR accuracy, language coverage, and model size are all Not verified
  until tested. No OCR language is advertised until its model is bundled and its licence
  recorded. Searchable-PDF export from OCR depends on the PDF adapter (D-06) and is
  separately Not verified.

## D-10 — Project licence: NOT YET SELECTED (no LICENSE file, no reuse claim)

- **Date:** 31 Oct 2026
- **Status:** Decided (binding) — awaiting a genuine user decision
- **Context:** Master Instructions §§7, 11: "Obtain an explicit user decision before
  applying an overall license to OmSuite. Public GitHub visibility does not automatically
  assign an open-source license."
- **Alternatives considered:** MIT, Apache-2.0, GPL-family — all *considered and none
  chosen*. Choosing any of them here would violate the Master Instructions.
- **Rationale:** The licence determines what others may do with the public source,
  including how copyleft engines (if any are later adopted) interact with it. It is a
  user-authority decision, not an engineering default.
- **Consequences:** No `LICENSE` file is added by this stream; no doc, README, or
  release note may claim the project is MIT/Apache/GPL licensed or that reuse is
  permitted. Third-party notices and dependency licence obligations still apply in full
  regardless (DEPENDENCIES_AND_LICENSES.md). The user decision is recorded in
  BLOCKERS.md (docs-ci-packaging stream) as the awaiting item, and this entry is
  superseded only by an entry recording the user's actual choice.

## D-11 — E-book direction: EPUB first; MOBI/AZW separate and Not verified; no DRM circumvention

- **Date:** 31 Oct 2026
- **Status:** Decided (scope); Direction (EPUB parser candidate)
- **Context:** Master §§3.7, 4: EPUB reader with TOC/bookmarks/progress/search; MOBI/AZW
  evaluated separately; do not bypass DRM.
- **Alternatives considered:**
  - *epublib (Java):* EPUB parsing candidate (licence to be confirmed at integration;
    recorded as "to verify" in DEPENDENCIES_AND_LICENSES.md, not assumed).
  - *Claiming MOBI/AZW from extension recognition:* rejected — format families differ
    (MOBI is a PalmDB-derived container; AZW is Amazon's variant, often DRM-wrapped).
- **Rationale:** EPUB is an open ZIP+XML standard with a real parser path; MOBI/AZW
  need their own parser evidence and DRM handling.
- **Consequences:** MOBI/AZW are Not verified across the board in FORMAT_SUPPORT.md.
  A DRM-protected file reports "cannot open (protected)"; circumvention is never an
  implementation task.

## D-12 — Converter honesty gate: registry-driven, platform-specific, no placeholders

- **Date:** 31 Oct 2026
- **Status:** Decided
- **Context:** Master §§3.10, 4, 10: show only genuinely implemented conversions; no
  cloud-style disabled "coming soon" controls; every visible control must have a defined
  action or not be presented.
- **Alternatives considered:**
  - *Showing all plausible conversions greyed out:* rejected — prohibited by the
    Master Instructions (no cloud-related disabled controls / coming-soon placeholders
    as a pattern, and no decorative functional-looking buttons).
  - *One global conversion list for both platforms:* rejected — engines differ per
    platform (D-03, D-07), so a conversion available on Windows may not exist on Android.
- **Rationale:** A per-platform registry (ARCHITECTURE.md §5.8) makes honesty mechanical:
  the UI cannot display what the registry does not contain.
- **Consequences:** Until an implementation stream registers a conversion with a tested
  engine behind it, FORMAT_SUPPORT.md marks that Convert cell Not verified and the
  Converter shows nothing for it. Conversion loss warnings (e.g. XLSX→CSV dropping
  sheets/formatting) are part of the registry entry, not an afterthought.

## D-13 — No cloud, no account, no telemetry — architecture-level exclusion

- **Date:** 31 Oct 2026
- **Status:** Decided (restates the Master Instructions as an architecture invariant)
- **Context:** The product constraints (§2 of the Master Instructions) prohibit cloud
  storage/sync/backup/collaboration, mandatory accounts, and silent uploads.
- **Alternatives considered:** None entertained — these are user-set non-negotiables,
  not engineering trade-offs. (GitHub is source hosting for development, not a runtime
  feature; the installed apps must not connect to GitHub to operate.)
- **Consequences:** No network client, analytics SDK, or crash-upload path exists in this
  architecture. Any future proposal that adds one is a new user decision, recorded as a
  superseding entry — it cannot be smuggled in as an "implementation detail" of another
  feature. Dependency downloads at build time are not runtime cloud features, but any
  user-visible download (e.g. OCR language packs) must be explicit and user-initiated.

## D-14 — Prototypes are visual reference only; never shipped, never cited as implementation

- **Date:** 31 Oct 2026
- **Status:** Decided
- **Context:** The supplied prototypes (`prototypes/index.html`, `prototypes/android_app.html`)
  were inspected 31 Oct 2026 (see `research/PROTOTYPE_INSPECTION.md`): Windows prototype
  has a 5-item sidebar and 3 cards; Android prototype has 2 hardcoded recent-file rows and
  Home/Files/Settings navigation; buttons are dead; sample data is hardcoded.
- **Alternatives considered:**
  - *Wrapping the prototypes as the app:* rejected — the Master Instructions explicitly
    prohibit delivering an HTML mockup as the app.
  - *Ignoring the prototypes:* rejected — they carry the approved visual direction
    (dark/light/green themes, emerald accent) that the design brief's identity builds on.
- **Rationale:** Use them for visual direction (theme tokens, layout shape, navigation
  shape) and for nothing else. Their sample files (`Project_Brief.docx`,
  `Financial_Q3.xlsx`) are not real files, not test fixtures, and must never appear as
  recents in the real app.
- **Consequences:** Any status doc, screenshot, or demo that presents prototype screens
  as the app is misrepresenting the product. Demo fixtures in the real app, if any, must
  be visibly labelled as sample data (Master §3.1).

---

## Decisions explicitly NOT made by this stream

| Topic | Owner | Why not here |
|---|---|---|
| Final Windows stack | Stream 3 (`apps/windows/DECISION.md`) | Task boundary; see D-02 |
| Exact dependency versions (pins) | Implementation streams at integration | Versions must reflect what was actually resolved and licence-checked, not a research snapshot |
| Project licence | nimu (user) | D-10; user-authority decision |
| GitHub repo creation / push | Stream 5 (docs-ci-packaging), via secure connector only | Task boundary; no token in chat, ever |
| Module implementation status | Implementation streams + `IMPLEMENTATION_STATUS.md` | This stream wrote no app code |
| Release signing / keystore | nimu (user) via secure handling | Never in repo, docs, or chat |

---

*Sources: Master Development Instructions (31 Oct 2026); UI/UX Design Brief (31 Oct 2026);
research notes in `research/` (engine research, Windows stack evaluation, prototype
inspection — all dated 31 Oct 2026). Research was web-checked 31 Oct 2026 for the engine
licences cited; where a licence or version could not be confirmed, the dependency table
records it as "to verify" rather than asserting it.*
