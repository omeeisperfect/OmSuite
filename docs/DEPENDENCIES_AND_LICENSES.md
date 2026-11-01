# OmSuite — Dependencies and Licences (Draft Inventory)

> **Status:** Stream 1 (architecture + research) draft, 31 Oct 2026.
> This is a **proposed/candidate inventory**, not a record of integrated dependencies.
> No dependency below has been integrated into an OmSuite build by this stream, and no
> version below is a pinned build version — versions are research snapshots checked
> 31 Oct 2026 and must be re-confirmed at integration time, when the resolved version
> replaces the snapshot in this table.
>
> ## ⚠️ PROJECT LICENCE: NOT YET SELECTED
>
> **OmSuite itself has no licence yet. No `LICENSE` file exists, and none has been added
> by this stream. Public GitHub visibility does NOT grant anyone permission to reuse
> OmSuite's source.** The user (nimu) must choose the project licence explicitly
> (Master Instructions §§7, 11; DECISION_LOG.md D-10). Until then, no doc, README,
> release note, or package metadata may claim OmSuite is MIT/Apache/GPL licensed or
> that reuse is permitted.
>
> **Third-party licences still apply in full regardless.** Every component below keeps
> its own licence and obligations; a future OmSuite licence choice does not override
> them, and copyleft components (if any are later adopted) must be re-examined against
> that choice before bundling.
>
> **Rules for implementation streams updating this file:**
> 1. Replace a "candidate" row with the exact resolved version + source (Maven/Gradle/
>    crates.io/NuGet coordinate + lockfile reference) at integration time.
> 2. Record the full licence text / notice file location for every bundled component in
>    the release (a `THIRD_PARTY_NOTICES` file is required at packaging time).
> 3. Never bundle proprietary fonts, icons, sample documents, codecs, or assets unless
>    redistribution is permitted and recorded here.
> 4. Never record a token, password, keystore, or secret in this file or anywhere else.
> 5. A component whose licence cannot be confirmed stays "to verify" — it is not bundled
>    on an assumption.

## How to read the table

- **Status:** `Candidate` = proposed by research, not integrated. `To verify` = a specific
  fact (version, licence, platform support) still needs confirmation before integration.
  `Not selected` = considered and not chosen as a default (reason given).
- **Obligations** are summaries, not legal advice. The full licence text governs.
- **Platform:** A = Android, W = Windows, S = shared contract (no binary).

---

## 1. Platform frameworks and UI

| Component | Version (snapshot) | Purpose | Licence | Platform | Obligations / notes |
|---|---|---|---|---|---|
| Kotlin (language) | To verify at integration (Android stream pins) | Android app language | Apache-2.0 | A | Permissive; include Apache-2.0 notice in third-party notices. |
| Jetpack Compose + Material 3 (AndroidX) | To verify (BOM pinned by Android stream) | Android declarative UI | Apache-2.0 | A | Permissive; notice only. |
| AndroidX Navigation, Lifecycle, ViewModel | To verify | Navigation, lifecycle, state | Apache-2.0 | A | Permissive; notice only. |
| Room (AndroidX) | 2.6.x–2.7.x family seen in third-party notices 31 Oct 2026; exact version to verify at integration | SQLite persistence layer (metadata only) | Apache-2.0 | A | Permissive; notice only. SQLite itself is public domain. |
| WorkManager (AndroidX) | To verify | Deferrable background work | Apache-2.0 | A | Permissive; notice only. |
| CameraX (AndroidX) | To verify | Camera capture for Scan | Apache-2.0 | A | Permissive; notice only. Raises min-SDK considerations for the whole app — Android stream to record. |
| Media3 / ExoPlayer (AndroidX) | To verify | Audio/video playback | Apache-2.0 | A | Permissive; notice only. Codec support is device-dependent (see FORMAT_SUPPORT.md). |
| Coil (image loading) | To verify | Image loading/caching (Android) | Apache-2.0 | A | Permissive; candidate, not selected. |
| Tauri 2 + React + TypeScript + Rust (Windows candidate) | Tauri 2.x (2.11.x line seen Jun 2026); exact version to verify at decision | Windows desktop shell + Rust backend (candidate, NOT decided — stream 3) | MIT OR Apache-2.0 (dual) | W | Permissive dual licence; elect and record one. WebView2 runtime is a Microsoft runtime with its own terms on the target PC — installer must handle/document it. |
| Electron (Windows alternative) | To verify | Windows shell alternative (not default) | MIT | W | Permissive; bundled Chromium increases size; not selected as default. |
| .NET WPF / WinUI 3 (Windows alternative) | To verify | Windows native alternative | .NET runtime/libraries: MIT (varies by component) | W | Verify per-component; WinUI 3 packaging constraints to verify. Not selected as default. |

## 2. Document, spreadsheet, and presentation engines

| Component | Version (snapshot) | Purpose | Licence | Platform | Obligations / notes |
|---|---|---|---|---|---|
| Apache POI (poi-ooxml + poi + poi-scratchpad) | 5.5.1 (stable release 30 Nov 2025, per public records checked 31 Oct 2026); 6.0 announced, not released at that check | DOCX (XWPF), XLSX (XSSF + formula evaluation), PPTX (XSLF); legacy DOC/XLS/PPT via scratchpad (HWPF/HSSF/HSLF) | Apache-2.0 | A (JVM); W only if the Windows stack is JVM/.NET-interop — otherwise a Windows-side equivalent is needed | Permissive; notice only. POI is a file-model library, not a layout/rendering engine. Scratchpad components are explicitly weaker — see FORMAT_SUPPORT.md. No macro execution. |
| docx4j (alternative for Writer) | To verify | Schema-complete OOXML model; DOCX→PDF via XSL-FO/FOP | Apache-2.0 | A (JVM) | Permissive; candidate alternative, not default. FOP-based PDF export quality separately Not verified. |
| ODF Toolkit / ODFDOM (candidate for ODT/ODS/ODP) | To verify | OpenDocument formats | Apache-2.0 | A (JVM) | Permissive; candidate only — no engine selected for ODF yet. |
| Apache FOP (only if docx4j PDF route is chosen) | To verify | XSL-FO → PDF | Apache-2.0 | A (JVM) | Permissive; candidate only. |
| LibreOffice technology | — | — | MPL-2.0 / LGPL (varies by component) | — | **Not selected. Not assumed feasible** (Master §6). Any proposal must evidence binary size, Android feasibility, licensing, and maintenance before adoption. Do not bundle on assumption. |
| Aspose / other commercial Office SDKs | — | — | Commercial | — | **Not selected.** Requires a user-approved purchase/licence decision. Not bundled. |
| SnakeYAML (candidate, validation only) | To verify | YAML parsing/validation helper for Code Editor | Apache-2.0 | A (JVM) | Permissive; candidate for validation only, not a YAML editor engine. |

## 3. PDF engines

| Component | Version (snapshot) | Purpose | Licence | Platform | Obligations / notes |
|---|---|---|---|---|---|
| PDFium | Current Chromium-bundled line; exact binary version to verify at integration | PDF rendering + parsing (Chrome's engine) | BSD-3-Clause | A (via PdfiumAndroid-class bindings), W (via wrapper) | Permissive; **reproduce the BSD-3-Clause copyright notice + disclaimer in binary distributions** (required by the licence). Rendering/parsing only — not an authoring engine. |
| Android `PdfRenderer` (platform API) | Platform API (no dependency) | PDF viewing fallback on Android | Android SDK terms (Apache-2.0 family for platform code) | A | Viewing only; no annotation/page/form support. No extra licence burden beyond the SDK. |
| Apache PDFBox | To verify | PDF manipulation/creation candidate (JVM) | Apache-2.0 | A (JVM); W per stack | Permissive; notice only. Rendering quality + Android size to verify. |
| iText | — | — | AGPL / commercial | — | **Not selected as default.** AGPL obligations and/or commercial licensing would complicate a public repo whose own licence is not yet selected. Revisit only with an explicit licence decision. |
| IronPDF / commercial PDF SDKs | — | — | Commercial | — | **Not selected.** Requires a user-approved purchase/licence decision. |

## 4. Archive engines

| Component | Version (snapshot) | Purpose | Licence | Platform | Obligations / notes |
|---|---|---|---|---|---|
| Apache Commons Compress | To verify (1.x line; 7Z needs XZ for Java) | ZIP/TAR/7Z read/write (subset), archive abstraction | Apache-2.0 | A (JVM); W per stack | Permissive; notice only. Known limits recorded in FORMAT_SUPPORT.md (7Z subset, no multi-volume write, no encryption on write). |
| XZ for Java | To verify | XZ/LZMA support required by Commons Compress for 7Z | Public domain (per project) — **to verify at integration** | A (JVM) | Confirm licence + version at integration; do not bundle on the snapshot claim alone. |
| junrar / unrar-based extraction | To verify | RAR extraction only | **UnRAR licence (freeware, NOT an open-source licence)** | A (JVM); W alternative: libarchive | **Extraction only.** The UnRAR licence prohibits using the code to develop a RAR-compatible archiver or re-create the RAR compression algorithm. Hence RAR creation is Not supported (FORMAT_SUPPORT.md). Any distribution of modified UnRAR sources must carry the required licence paragraph. Review against the not-yet-selected project licence before bundling. |
| 7-Zip native (Windows alternative) | To verify | Archive engine alternative on Windows | GNU LGPL + unRAR restriction (for 7z.dll) | W | Copyleft (LGPL) + unRAR restriction combined: both must be satisfied. Re-examine against the project licence choice before bundling. Not selected as default. |
| libarchive (Windows 11 native RAR extraction path) | OS-provided (Windows 11 23H2+) | RAR extraction via OS | BSD-family (project licence) — to verify per OS version | W | OS capability, not a bundled dependency; availability varies by Windows version — record per-version behaviour, do not assume. |

## 5. E-book, OCR, and media

| Component | Version (snapshot) | Purpose | Licence | Platform | Obligations / notes |
|---|---|---|---|---|---|
| epublib (EPUB candidate) | To verify | EPUB parsing | **To verify — do not assume** | A (JVM) | Licence + maintenance status must be confirmed at integration before any use. Recorded here as a candidate name only. |
| Tesseract (OCR engine) | 5.x line (Tesseract4Android 4.8.0 wrapping Tesseract 5.5.0 seen 31 Oct 2026) | On-device OCR | Apache-2.0 | A (via Tesseract4Android wrapper, Apache-2.0); W via native Tesseract build | Permissive; notice only. Language-data (`tessdata`) files carry their own licences — check per language before bundling. Older tess-two wrapper is unmaintained — do not select it. |
| Tesseract4Android (wrapper) | 4.8.0 seen 31 Oct 2026 | Android JNI wrapper for Tesseract | Apache-2.0 | A | Permissive; notice only. Native dependencies + language models have separate licences (see above). |
| Google ML Kit Text Recognition | — | — | Proprietary (Google terms) | — | **Not selected as default.** On-device recognition, but published terms describe usage/performance metrics sent to Google — in tension with the no-telemetry constraint. Reconsider only after terms re-verification + explicit user decision. |
| Windows.Media.Ocr (platform API, candidate) | Platform API | OCR on Windows | Windows SDK terms | W | Candidate for stream 3 to verify (language availability, offline behaviour). |
| Platform media codecs (Android + Windows) | OS-provided | Image/audio/video decoding | OS terms | A, W | Not bundled dependencies; codec availability varies by device/OS version (notably HEIC on Windows). Record per-platform, per-version behaviour. |

## 6. Text, data, and utilities

| Component | Version (snapshot) | Purpose | Licence | Platform | Obligations / notes |
|---|---|---|---|---|---|
| SQLite | 3.x (embedded) | Local database engine | Public domain | A (via Room), W (via stack binding) | No licence burden; still record the version in the release notes. |
| Gson / Moshi / kotlinx.serialization (candidate) | To verify | JSON handling | Apache-2.0 | A | Permissive; Android stream selects one, not all. |
| Markdown renderer (platform-specific) | To verify | Markdown preview | To verify per selected renderer | A, W | Licence + rendering fidelity to verify at selection; no renderer selected yet. |

## 7. Build and CI tooling (not shipped in the apps)

| Component | Version (snapshot) | Purpose | Licence | Platform | Obligations / notes |
|---|---|---|---|---|---|
| Gradle + Android Gradle Plugin | To verify (CI pins) | Android build | Apache-2.0 | Build only | Build-time only; not shipped. Local Gradle is platform-blocked in this VM — CI is the build route (MASTER_PLAN.md §6). |
| GitHub Actions runners | — | CI build/test | GitHub terms | Build only | Build-time only. No secrets in workflows; signing via CI secrets only, never in repo files. |
| Rust toolchain / Cargo (if Tauri) | To verify | Windows backend build | MIT OR Apache-2.0 (toolchain) | Build only | Build-time only. |

## 8. Components explicitly NOT bundled (and why)

| Component | Reason |
|---|---|
| Any cloud SDK (Drive/Dropbox/OneDrive/iCloud, analytics, crash-upload) | Prohibited by product constraints (no cloud, no telemetry). |
| Commercial PDF/Office SDKs | No user-approved purchase/licence; not selected. |
| LibreOffice desktop binaries | Feasibility unevidenced (size, Android, licensing, maintenance). |
| RAR creation code | UnRAR licence prohibition (see §4). |
| Proprietary fonts/icons/sample documents/codecs | No redistribution evidence; do not bundle unless permitted + recorded. |
| Any keystore, signing key, password, or token | Never in repo, docs, ZIPs, or chat. Ever. |

## 9. Outstanding licence verifications (before any bundling)

1. epublib licence + maintenance status.
2. XZ for Java licence + version.
3. Exact Tauri 2 / React / TypeScript / Rust crate versions + their licence elections (if
   stream 3 selects Tauri) — record the Cargo lockfile + `cargo deny`-style check if used.
4. Markdown renderer licence (per platform selection).
5. Windows SQLite binding licence (per stack selection).
6. Every `tessdata` language model licence for each language shipped with OCR.
7. WebView2 runtime terms statement for the Windows installer (if Tauri).
8. **Project licence itself (user decision — B-1 in MASTER_PLAN.md).** Until chosen, this
   file's header warning stays in place and no `LICENSE` file is created.
