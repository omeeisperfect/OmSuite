# OmSuite — Architecture

> **Status of this document:** Stream 1 (architecture + research) deliverable, 31 Oct 2026.
> This is a design and research document. **No OmSuite application code exists yet in this
> stream, and no capability in this document is claimed as implemented or tested.**
> Where a module, engine, or format capability is described, its implementation status is
> **Not implemented / Not verified** unless another stream's `STATUS.md` (with executed-test
> evidence) says otherwise. The HTML prototypes in `prototypes/` are visual reference only
> (dead buttons, hardcoded sample data) and are **not** the architecture described here.
>
> **Product constraints (non-negotiable, from the Master Development Instructions, 31 Oct 2026):**
> Android + Windows only. No Web/PWA. No cloud storage, sync, backup, or collaboration.
> No mandatory account, login, or subscription. No telemetry or silent upload.
> Core functions work offline. Public GitHub visibility does **not** grant a reuse licence —
> the project licence is **NOT YET SELECTED** and no `LICENSE` file has been added by this stream.

## 1. System overview

```
┌─────────────────────────────────────────────────────────────────────────┐
│                        OmSuite — one product, two apps                  │
│  Shared identity: brand, terminology, capability labels, file-operation │
│  semantics, error/conflict/recovery behaviour (see §4, §7).             │
│  NOT shared by default: UI code, storage adapters, permission handling.  │
└──────────────┬───────────────────────────────┬──────────────────────────┘
               │                               │
┌──────────────▼──────────────┐   ┌────────────▼──────────────────────────┐
│  Android app                │   │  Windows app                          │
│  Kotlin + Jetpack Compose   │   │  Stack NOT YET DECIDED — see §3.3 and │
│  (direction, §3.1)           │   │  research/WINDOWS_STACK_EVALUATION.md  │
│                             │   │  (final decision: stream 3,           │
│  UI (Compose, touch-first)  │   │   apps/windows/DECISION.md)           │
│  ├─ File Manager            │   │                                       │
│  ├─ Editors (Writer/Sheets/ │   │  UI (desktop-grade: sidebar, tabs,    │
│  │   Slides/PDF/Media/      │   │   context menus, shortcuts, drag-drop)│
│  │   E-books/Code/Converter/│   │  ├─ Same 12 modules, desktop layout   │
│  │   Scan & OCR)            │   │  └─ Same engine-adapter interfaces    │
│  ├─ Storage adapter (SAF)   │   │  Storage adapter (native filesystem)  │
│  ├─ Local DB (Room/SQLite)  │   │  Local DB (SQLite via chosen stack)   │
│  └─ WorkManager (deferrable │   │  Background work (non-UI thread /     │
│      background work)       │   │   worker, never blocking the UI)      │
└──────────────┬──────────────┘   └────────────┬──────────────────────────┘
               │                               │
               ▼                               ▼
        ┌──────────────┐                ┌──────────────┐
        │ Device-local │                │ Device-local │
        │ user files   │                │ user files   │
        │ (SAF URIs)   │                │ (paths)      │
        └──────────────┘                └──────────────┘
        NO arrow between the two devices. There is NO cross-device sync in this phase.
        NO arrow to any cloud service. There is NO network dependency at runtime.
```

### 1.1 Module map (12 modules, both platforms)

| # | Module | Owns | Depends on |
|---|--------|------|------------|
| 1 | File Manager (central) | Browse, search, sort, favourites, recents, create folder, rename, copy, move, duplicate, delete, multi-select, properties, preview dispatch | File-core (§4), metadata store (§6) |
| 2 | Writer | Text document create/open/edit/save/Save As | Document engine adapter (§5.1) |
| 3 | Sheets | Grid, formula bar, sheets, formats, sort/filter, freeze panes | Spreadsheet engine adapter (§5.2) — real formula engine, not a fake demo |
| 4 | Slides | Slide list/canvas, layouts, text boxes, images, shapes, notes, presentation mode | Presentation engine adapter (§5.3) |
| 5 | PDF Studio | View, search, zoom, rotate, annotations, forms, page ops, merge/split | PDF engine adapter (§5.4) |
| 6 | Media | Image view/basic adjust, audio playback/queue, video playback/subtitles | Platform media APIs (§5.6) |
| 7 | E-books | EPUB reading, TOC, bookmarks, progress, search | EPUB parser/renderer (§5.7) |
| 8 | Archives | Browse before extract, extract all/selected, create ZIP, progress/conflicts | Archive engine adapter (§5.5) |
| 9 | Code / Text Editor | Plain-text editing, highlighting, find/replace, JSON validate/format, Markdown preview | Text-core (no binary engine needed) |
| 10 | Converter | Source → destination → options → Save As; history | Engine adapters + conversion registry (§5.8) |
| 11 | Scan & OCR | Capture/import, crop/rotate/reorder, on-device OCR, searchable PDF / text export | OCR engine adapter (§5.9), PDF adapter |
| 12 | Settings + Local Data & Recovery | Theme, defaults, cache/storage, autosave/recovery, recents management, privacy notice | Metadata store (§6), recovery store (§6) |

**Dependency rule:** modules depend on engine *adapters* (interfaces in §5), never directly on
a third-party engine class. A module must be replaceable-engine-safe: swapping PDFium for
another PDF renderer, or Tesseract for another on-device OCR engine, touches the adapter
only, not the module UI. This rule is a design requirement; it has not been verified in code
because no module code exists yet in this stream.

### 1.2 What is deliberately NOT in the architecture

- No server, API client, sync engine, account system, or analytics/telemetry pipeline.
- No WebView-as-the-product on Windows: if the Windows stack chosen by stream 3 uses a
  WebView shell (e.g. Tauri), the shell is a *container* for a desktop app with a Rust/native
  backend doing real file I/O — it must not be a website opened in a browser, and it must
  work fully offline after install. The final Windows decision record belongs to stream 3.
- No shared "one codebase runs everywhere" UI layer: Android and Windows keep separate UI
  code. Shared code is limited to what genuinely improves correctness (see §2).

## 2. Shared-code boundaries

Share only where sharing improves correctness and maintainability, per Master §5.3.
Do **not** force a single abstraction where the permission models differ.

| Share (candidate) | Rationale | Boundary / caution |
|---|---|---|
| File-operation *semantics*: conflict decisions, safe-write protocol (§4.3), archive safety rules (§7), error taxonomy | Same user-visible behaviour on both platforms; one spec to test against | Spec + tests in `shared/` + `tests/` are stream 4's work; this doc only defines the contract |
| Document model concepts (e.g. "a document has paragraphs/runs", "a sheet has cells/formulas") | Keeps Writer/Sheets behaviour consistent | Do NOT share a binary file-format implementation across platforms until an engine proves portable; prefer per-platform engine adapters behind the same interface shape |
| Format-capability labels (Supported / Partial / Not supported / Not verified) | One honest vocabulary (FORMAT_SUPPORT.md) | Labels are per-format **and per-platform**; a capability on Android says nothing about Windows |
| Conversion registry shape (source → allowed destinations, loss warnings) | Converter must show only genuinely implemented conversions on each platform | Registry entries are per-platform; a conversion listed for Windows is not implied for Android |

| Do NOT share / keep platform-specific | Why |
|---|---|
| Storage access (SAF URIs vs Windows paths) | Different identity, permission, lifetime, and revocation models (§3.4) |
| UI, navigation, gestures, shortcuts | Touch-first vs desktop-grade; stretching one layout across both is explicitly prohibited |
| Media playback, camera capture, PDF rendering | Platform APIs differ (Android PdfRenderer/Media3/CameraX vs Windows equivalents) |
| Background-work scheduling | WorkManager (Android) vs OS/threading primitives (Windows) |
| Installer / signing / packaging | APK vs Windows installer; separate pipelines, separate signing hygiene |

## 3. Platform architectures

### 3.1 Android — Kotlin + Jetpack Compose (direction)

This direction comes from the Master Instructions (§5.1: "preferred direction is Kotlin and
Jetpack Compose, subject to final compatibility research") and is recorded as a decision
in DECISION_LOG.md (D-01). It is a *direction*, not a claim that any Android code exists.

```
┌─────────────────────────────────────────────────────────────┐
│ Compose UI: NavHost → Home/Files/Editors/Settings             │
│   State: ViewModel + StateFlow; one screen = one ViewModel    │
│   No UI logic in Activities; no business logic in Composables │
├─────────────────────────────────────────────────────────────┤
│ Domain / use-cases: OpenFile, SaveFile, ConvertFile,          │
│   ExtractArchive, RunOcr, RecoverAutosave (pure, testable)    │
├─────────────────────────────────────────────────────────────┤
│ Storage adapter (SAF): DocumentFile / ContentResolver,        │
│   persistable URI permissions, openInputStream/OutputStream   │
│   NEVER assume a raw filesystem path exists for a SAF URI     │
├─────────────────────────────────────────────────────────────┤
│ Engine adapters: PdfAdapter, DocumentAdapter, SheetAdapter,   │
│   ArchiveAdapter, OcrAdapter (interfaces, §5)                 │
├─────────────────────────────────────────────────────────────┤
│ Local persistence: Room (SQLite) — metadata ONLY (§6)         │
│ Background: WorkManager for deferrable work (large copy/      │
│   conversion/OCR batch); foreground service only where the    │
│   platform genuinely requires it for user-visible long work   │
└─────────────────────────────────────────────────────────────┘
```

- **Target:** Android 10+ where technically practical (Master §5.1); exceptions and
  OS-specific limitations to be documented by the Android stream when encountered.
- **Scoped storage:** no assumption of unrestricted filesystem access. MediaStore for
  shared media where applicable; SAF document picker / folder access for user-chosen
  locations; app-private storage for cache, autosave snapshots, and OCR language data.
- **Lifecycle:** handle process death, permission revocation, low memory, and interrupted
  operations. Long operations report progress and support cancellation where safe (§4.3).
- **Back / share:** system back behaviour, share sheet (receive *and* send local files only),
  touch-friendly controls, bottom navigation / drawer per screen size — not a squeezed
  desktop toolbar.

### 3.2 Android storage: SAF vs native filesystem

| Question | Answer (design) |
|---|---|
| Default for user files | **SAF** (Storage Access Framework): document picker, `ACTION_OPEN_DOCUMENT`, `ACTION_OPEN_DOCUMENT_TREE` with persistable URI permission. Required where scoped storage applies. |
| Native filesystem (`java.io.File`) | Only inside app-private directories and for files the app itself created there. Never used to bypass scoped storage for shared storage. |
| Identity of a file | The **URI + persistable permission grant**, not a path string. Recents/favourites store the URI, display name, MIME type, and last-known size/modified time — and must tolerate the URI becoming invalid (permission revoked, file moved/deleted) with a clear "unavailable" state, not a crash. |
| What breaks if this is ignored | Storing a raw path from a SAF pick and re-opening it later will fail on modern Android; storing a URI without taking persistable permission loses access after restart. Both failure modes must be handled as normal, user-visible states. |
| Windows contrast | Windows uses real paths (§3.3); the two adapters must not leak into each other. The file-operation *interface* (§4) is shared in shape; the *identity type* is platform-specific. |

### 3.3 Windows — stack evaluation summary (final decision: stream 3)

The Master Instructions (§5.2, §6) require evaluating Tauri 2 + React/TypeScript/Rust and
alternatives **before committing**. This stream evaluated candidates and recorded the
comparison in `research/WINDOWS_STACK_EVALUATION.md`; it deliberately does **not** make
the final Windows decision. That record belongs to stream 3 in `apps/windows/DECISION.md`.

Candidates evaluated (summary; full comparison in the research note):

| Candidate | One-line assessment | Key risk |
|---|---|---|
| **Tauri 2 + React/TypeScript + Rust** | Leading candidate: small installer (system WebView2, no bundled Chromium), Rust backend for real native file I/O, MIT/Apache-2.0 | WebView2 runtime prerequisite on the target PC; frontend/backend bridge must be kept thin and typed; document engines still need separate Rust/JVM/native choices |
| Electron + TypeScript | Most battle-tested, largest installer (bundled Chromium), MIT | Size and memory; still needs native engines for DOCX/XLSX/PDF/OCR — the shell alone solves nothing |
| .NET (WPF / WinUI 3) + C# | Most native-feeling on Windows, best native file dialogs / drag-drop | Document engines are .NET-ecosystem choices (different from Android's JVM choices); WinUI 3 packaging/Store constraints need verification |
| Flutter (desktop) | One Dart codebase incl. Android in theory | Desktop maturity and document-engine availability on Windows are weaker than the other candidates for this format-heavy product; risks "one UI stretched everywhere" |
| Pure Rust (egui / iced) | No WebView, small binary | Editor-grade UI (rich text, spreadsheet grid, PDF annotation) would be largely hand-built; highest implementation risk |

**Non-negotiable for any Windows choice:** genuine desktop app (not a website opened in a
browser), native file dialogs, drag-and-drop, keyboard shortcuts, right-click menus,
multi-selection, resizable windows, background work off the UI thread, and an installer
with honest signing status (unsigned must be stated as unsigned).

### 3.4 Windows storage: native filesystem

- Real paths via native file dialogs; long-path, UNC, symlink/reparse-point, and read-only
  handling per §7. No SAF equivalent, no permission-grant lifetime to manage — but also no
  safety net: path validation, canonicalisation, and traversal checks are the app's job.
- App data (metadata DB, cache, autosave) lives in the per-user local app-data location,
  never beside user documents unless the user explicitly chooses that location.
- The same safe-write protocol (§4.3) applies: temp file + validate + atomic replace,
  never a direct in-place overwrite of the only copy.

## 4. File-operation lifecycle and data flow

### 4.1 The File Manager is the hub, not a picker

Every editor opens through the File Manager's dispatch: File Manager → capability lookup
(FORMAT_SUPPORT.md, per platform) → open in the owning module, or preview, or an honest
"unsupported for this operation" state. Editors never bypass the File Manager's conflict,
progress, and error handling by doing ad-hoc I/O.

### 4.2 Lifecycle of a single file operation

```
User action (open / save / copy / move / extract / convert)
  → 1. Resolve identity      Android: SAF URI + permission check
  │                            Windows: canonicalised path + existence check
  → 2. Capability check       Is this operation Supported/Partial for this
  │                            format on THIS platform? (FORMAT_SUPPORT.md)
  │                            If Not supported / Not verified → stop with a
  │                            clear message; do not attempt and silently fail.
  → 3. Pre-flight             Read-only? Locked? Enough free space? Destination
  │                            exists? (conflict decision — see §4.3)
  → 4. Acquire + snapshot     Open source stream; for edits, autosave snapshot
  │                            taken BEFORE the first destructive write.
  → 5. Process                Engine adapter works on a TEMP copy, never on
  │                            the original in place.
  → 6. Validate output        Engine reports success + output is checked
  │                            (non-empty where expected, parses back, size sane).
  │                            On validation failure → discard temp, original untouched.
  → 7. Commit                 Atomic replace where the platform supports it
  │                            (temp → destination rename); otherwise copy + verify.
  → 8. Record metadata        Recents, favourites, conversion history, recovery
  │                            record — in a DB transaction (§6).
  → 9. Clean up               Temp files removed on success AND on failure/crash
  │                            (startup sweep of orphaned temps).
  → 10. Report                Success / partial / failure with a specific,
                              actionable message (not "something went wrong").
```

Cancellation is offered where safe (copy, move, extract, convert, OCR batch). Cancelling
mid-write must leave either the old file intact or a complete new file — never a half-written
file presented as success. If a platform cannot guarantee that for a given operation, the
operation must not offer cancellation at that point, and the UI must say so.

### 4.3 Safe-write and conflict rules (binding on all modules)

1. **Temp + atomic replace** where supported; validate before replacing the destination.
2. **Never overwrite without a decision.** Existing destination → user chooses
   Replace / Keep both (auto-renamed) / Cancel. No silent overwrite, ever — including
   archives and conversions.
3. **Preserve the original by default** for conversion and risky operations; Save As /
   Duplicate are first-class actions, not afterthoughts.
4. **No in-place edit of the only copy** during recovery: recovery restores *from* a
   snapshot *to* a new or explicitly confirmed destination.
5. **Transactions for metadata:** a file operation that succeeds on disk but fails to
   record metadata (or vice versa) must be reconciled on next launch, not left silently
   inconsistent. Recents entries pointing at missing files degrade to "unavailable", never crash.
6. **Do not load entire large files into memory** when streaming/chunking is possible
   (archives, media, large text). Enforce size guards per §7.

### 4.4 Data flow: open → edit → save (editors)

```
File Manager ──► Capability check ──► Editor loads via adapter ──► In-memory model
     ▲                                                                    │
     │                              Autosave snapshot (interval + on     │
     │                              focus loss / lifecycle event) ──► Recovery store
     │                                                                    │
     └──────── Save / Save As ◄── Adapter serialises model ──◄── User edits
                    │  (safe-write protocol §4.3)
                    ▼
              Original preserved unless user confirms overwrite;
              recents + recovery record updated in one transaction.
```

Editors hold an in-memory model, not a live handle to the user's file. Two editors must
never write to the same file concurrently without a conflict check at save time
(last-modified / size comparison; on conflict, offer Save As instead of overwriting).

## 5. Processing-engine abstraction interfaces

These are **interface contracts for implementation streams**, written in language-neutral
pseudocode. No implementation exists yet; conformance is Not verified for every engine.

> Naming convention: `Result<T>` = success value or a typed error
> (`NotSupported`, `CorruptInput`, `InsufficientStorage`, `PermissionDenied`,
> `Cancelled`, `EngineError(detail)`). Errors must be user-actionable; engine stack
> traces are never shown to the user, and document contents are never logged.

### 5.1 Document engine — `DocumentAdapter`

```
open(source) -> Result<DocumentModel>        // parse; never execute macros/scripts
create(kind: DOCX|ODT|RTF|TXT) -> Result<DocumentModel>
save(model, destination, overwrite: Confirm) -> Result<Unit>   // via §4.3
convert(model, targetFormat) -> Result<Bytes>  // ONLY if registry allows (§5.8)
capabilities(format) -> {open, create, edit, convert}  // from FORMAT_SUPPORT.md
```

Constraints: opening ≠ faithful editing ≠ round-trip preservation. A DOCX opened and
re-saved may lose fidelity (styles, fields, tracked changes); the UI must warn before
re-save where the adapter reports fidelity risk. Legacy binary DOC (HWPF-class) editing is
explicitly weaker than OOXML — see FORMAT_SUPPORT.md. **No macro execution, ever.**

### 5.2 Spreadsheet engine — `SheetAdapter`

```
open(source) -> Result<WorkbookModel>         // sheets, cells, formulas, styles
create(kind: XLSX|ODS|CSV) -> Result<WorkbookModel>
evaluate(workbook) -> Result<CalculatedValues> // REAL engine: full recalculation,
                                                // formula errors surfaced per-cell
                                                // (#DIV/0!, #REF!, …), not blank cells
save(model, destination, overwrite: Confirm) -> Result<Unit>
capabilities(format) -> {open, create, edit, convert}
```

Constraints: formula, chart, pivot, and macro compatibility are **separately verified**
capabilities — a sheet that opens is not proof its formulas calculate or its charts render.
Macros are never executed. CSV has no formulas, styles, or multiple sheets; converting
XLSX → CSV must warn about data loss (extra sheets, formatting, formulas → values).

### 5.3 Presentation engine — `SlideAdapter`

```
open(source) -> Result<DeckModel>             // slides, shapes, text, images, notes
create(kind: PPTX|ODP) -> Result<DeckModel>
save(model, destination, overwrite: Confirm) -> Result<Unit>
present(deck) -> PresentationSession          // navigation, notes view
capabilities(format) -> {open, create, edit, convert}
```

Constraints: viewing/playing a deck ≠ authoring it. Legacy binary PPT editing is weaker
than PPTX; see FORMAT_SUPPORT.md.

### 5.4 PDF engine — `PdfAdapter`

```
open(source) -> Result<PdfDocument>           // render pages, extract text, search
renderPage(page, zoom) -> Result<Image>
annotate(page, annotation) -> Result<Unit>    // highlight/comment/drawing/signature
                                                // stored as annotation layer, NOT as
                                                // edited original text
fillForm(field, value) -> Result<Unit>        // where supported
pageOp(op: insert|delete|extract|reorder|rotate) -> Result<Unit>
merge(documents) / split(document, ranges) -> Result<PdfDocument>
capabilities(format) -> {open, create, edit, convert}  // "edit" here means annotation
                                                // + page ops, NOT rewriting PDF text
```

Constraints: annotation ≠ modifying existing PDF text content. Text editing of a PDF's
original content is a distinct capability and is Not verified for any engine in this plan.
Compression and PDF↔image conversion only where quality is verified.

### 5.5 Archive engine — `ArchiveAdapter`

```
list(source) -> Result<[Entry]>               // browse BEFORE extraction; never
                                                // extract blindly
extract(source, entries: All|Selected, destination, conflictPolicy) -> Result<Report>
create(entries, format: ZIP, destination) -> Result<Unit>  // ZIP only, by design;
                                                // RAR creation is Not supported (§7)
capabilities(format) -> {browse, extract, create}  // recorded separately
```

Constraints: path-traversal, absolute-path, and symlink entries are rejected or
neutralised before any write; extraction target is always contained in the chosen
destination (§7). Size guards against archive bombs (see §7).

### 5.6 Media — platform APIs (no single engine)

Image preview/rotate/crop/basic adjust, audio playback/queue, video playback/subtitles
use **platform media APIs** (Android: Coil/Media3 or platform equivalents; Windows:
platform media stack of the chosen shell). No advanced media editing is implied unless a
real editing tool is integrated and verified. Codec support is per-platform and must be
recorded per format in FORMAT_SUPPORT.md — a codec the OS cannot decode is Not supported
on that platform, regardless of the extension.

### 5.7 E-book engine — `EbookAdapter`

```
open(source) -> Result<BookModel>             // EPUB: spine, TOC, metadata
position(book) -> {chapter, offset}           // stored locally (§6)
bookmark / search(query) -> Result<…>
capabilities(format) -> {open, create, edit, convert}
```

Constraints: EPUB is the priority reader target. MOBI/AZW are evaluated separately and
are Not verified (see FORMAT_SUPPORT.md). **DRM is never bypassed.** A DRM-protected
file that cannot be opened legitimately reports "cannot open (protected)" — it is not
a bug to fix by circumvention.

### 5.8 Converter — `ConversionRegistry` (the honesty gate)

```
conversions(sourceFormat, platform) -> [Conversion]  // ONLY genuinely implemented
    // Conversion = { destination, engine, lossWarning: String?, batchAllowed: Bool }
convert(source, destination, options) -> Result<Report>  // source unchanged by default
history() -> [ConversionRecord]  // local only, clearable
```

**Rule (binding):** the Converter UI renders *exactly* the registry for the current
platform. A conversion with no implemented, verified engine behind it must not appear
as an option — not greyed out as "coming soon" (cloud-style placeholders are prohibited),
simply absent, with the matrix (FORMAT_SUPPORT.md) explaining why. Batch conversion only
when reliable; otherwise single-file only.

### 5.9 OCR engine — `OcrAdapter` (on-device only)

```
recognise(images: [Image], languages: [Lang]) -> Result<[OcrPage]>
    // OcrPage = { text, words with bounding boxes + confidence, language }
exportText(pages) / exportSearchablePdf(pages, images) -> Result<Bytes>
capabilities() -> {languages available locally, searchablePdf: Bool}
```

Constraints: **on-device only — no cloud OCR API, no image upload, ever.** Language data
is bundled or downloaded once at install/setup time by the user (a build-time dependency
download is not a runtime cloud dependency, but any language-pack download must be explicit
and user-initiated, and OCR must work offline for already-installed languages).
Low-confidence words are flagged for user review/correction before export; OCR output is
never presented as ground truth.

### 5.10 Text / code — no engine

Plain-text formats (TXT, MD, JSON, XML, YAML, HTML) are edited as text with syntax
highlighting, line numbers, find/replace, and JSON validation/formatting — all implementable
with platform text components. HTML/MHTML previews treat content as **untrusted**: no script
execution, no external resource loading. Encoding and line endings are preserved where
practical; destructive transformations warn first.

## 6. Database schema and migration plan

**Principle:** the database stores *metadata only* — never duplicate copies of large user
documents. User files live in the user's filesystem; the DB holds pointers, preferences,
and recovery bookkeeping.

### 6.1 Tables (v1)

```sql
-- One row per user preference / setting. Keys are namespaced: theme, editor.*, files.*
CREATE TABLE preferences (
  key         TEXT PRIMARY KEY,
  value       TEXT NOT NULL,          -- JSON scalar or small JSON object
  updated_at  INTEGER NOT NULL        -- epoch millis
);

-- Recents: a pointer, not a file. URI (Android) or path (Windows) in `location`.
-- `location_kind` distinguishes the two; adapters interpret it, UI never parses it.
CREATE TABLE recent_files (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  location        TEXT NOT NULL,
  location_kind   TEXT NOT NULL,      -- 'saf_uri' | 'path'
  display_name    TEXT NOT NULL,
  mime_type       TEXT,
  size_bytes      INTEGER,
  last_opened_at  INTEGER NOT NULL,
  last_modified_at INTEGER,
  available       INTEGER NOT NULL DEFAULT 1  -- 0 = moved/deleted/permission lost
);
CREATE INDEX idx_recent_opened ON recent_files(last_opened_at DESC);

CREATE TABLE favorites (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  location        TEXT NOT NULL,
  location_kind   TEXT NOT NULL,
  display_name    TEXT NOT NULL,
  kind            TEXT NOT NULL,      -- 'file' | 'folder'
  created_at      INTEGER NOT NULL
);

-- Reading position / bookmarks (E-books; extensible to PDF page position later).
CREATE TABLE reading_positions (
  location      TEXT NOT NULL,
  location_kind TEXT NOT NULL,
  chapter_id    TEXT,
  offset        INTEGER NOT NULL DEFAULT 0,
  updated_at    INTEGER NOT NULL,
  PRIMARY KEY (location, location_kind)
);
CREATE TABLE bookmarks (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  location      TEXT NOT NULL,
  location_kind TEXT NOT NULL,
  chapter_id    TEXT,
  offset        INTEGER NOT NULL DEFAULT 0,
  label         TEXT,
  created_at    INTEGER NOT NULL
);

-- Autosave / recovery: snapshots live as FILES in app-private storage;
-- this table is the index. Never the only copy of a document (§4.3).
CREATE TABLE recovery_records (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  original_location TEXT,
  original_kind   TEXT,
  snapshot_path   TEXT NOT NULL,      -- app-private temp file
  module          TEXT NOT NULL,      -- 'writer' | 'sheets' | ...
  created_at      INTEGER NOT NULL,
  recovered_at    INTEGER,            -- NULL until the user recovers/discards
  status          TEXT NOT NULL DEFAULT 'available'  -- available|recovered|discarded
);

-- Conversion history (local only, user-clearable).
CREATE TABLE conversion_history (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  source_name     TEXT NOT NULL,
  source_format   TEXT NOT NULL,
  dest_format     TEXT NOT NULL,
  dest_location   TEXT,
  dest_kind       TEXT,
  status          TEXT NOT NULL,      -- 'ok' | 'partial' | 'failed'
  loss_warning    TEXT,
  created_at      INTEGER NOT NULL
);

-- Preview / capability cache metadata (small; never user documents).
CREATE TABLE cache_meta (
  location      TEXT NOT NULL,
  location_kind TEXT NOT NULL,
  kind          TEXT NOT NULL,        -- 'thumbnail' | 'capability'
  cache_path    TEXT,
  created_at    INTEGER NOT NULL,
  PRIMARY KEY (location, location_kind, kind)
);
```

**Explicitly NOT stored:** file contents, document text, images, passwords, tokens, keys,
or any cloud account data (there is no account). Cache holds thumbnails/previews only,
bounded by policy (§6.3), and is always safe to delete.

### 6.2 Migrations

- **Versioning:** single integer `schema_version` (starting at 1). Every change ships a
  migration: `MIGRATION <from>→<to>` with up-steps only (no destructive down-migration
  that drops user data without export).
- **Android:** Room `Migration` objects + `autoMigrations` only where Room can prove them;
  destructive migration (`fallbackToDestructiveMigration`) is **prohibited** — losing
  recents/favourites/recovery records on upgrade is a data-loss bug, not a fallback.
- **Windows:** same version table in SQLite; migrations run in a transaction before the
  app opens any editor; on migration failure the app must not open editors against a
  half-migrated DB — it reports the failure and keeps the previous DB file intact.
- **Corruption:** on open failure, attempt SQLite recovery (integrity check); if
  unrecoverable, rename the corrupt DB aside (never delete), start a fresh empty DB, and
  tell the user exactly what was lost (metadata only — their files are untouched).

### 6.3 Cache and storage policy

- Cache is bounded (default cap to be set by implementation streams; this doc does not
  invent a number as a verified behaviour — the cap must be a user-visible setting).
- Cache cleanup **never deletes user-created documents**; it deletes only files under
  app-private cache/snapshot directories that the app itself created.
- Low-storage pre-flight (§4.2 step 3) runs before large conversions/extractions; on
  failure the operation stops before writing, with the space required vs available shown.
- Startup sweep removes orphaned temp files and expired snapshots; recovery snapshots
  are kept until the user recovers or discards them (or an explicit retention setting
  says otherwise).

## 7. Security, privacy, and data-integrity design

(Implementation detail belongs to stream 5's SECURITY.md; this section states the
architectural invariants that every module must satisfy.)

1. **Untrusted input by default.** Documents, images, archives, and downloaded files are
   untrusted even though processing is local. Validate magic bytes/structure where
   practical; never trust the extension alone.
2. **No active content execution.** No macros, no embedded scripts, no HTML script
   execution in previews. HTML/MHTML preview is sandboxed/sanitised, with external
   resources blocked.
3. **Archive safety (binding).** Before any extraction write: reject absolute paths,
   `..` traversal, and symlink/hardlink entries that escape the destination; cap total
   entries, total uncompressed size, per-file size, and nesting depth; refuse or warn on
   expansion ratios typical of archive bombs. Conflicts never silently overwrite (§4.3).
4. **Parser resource guards.** Size caps and timeouts on parsers/converters/OCR; streaming
   where possible; never load an unbounded file fully into memory.
5. **Path safety (Windows).** Canonicalise, reject traversal outside the chosen destination,
   handle symlinks/reparse points safely; never follow a link out of the destination.
6. **No exfiltration surface.** No network client in the product at runtime, no telemetry,
   no analytics SDK, no crash reporter that uploads. If a future crash-report feature is
   ever proposed, it must be opt-in, local-first, and a separate user decision — it is
   not in this architecture.
7. **Secrets hygiene.** No passwords, tokens, keys, or keystores in source, docs, logs, or
   the public repo — ever. Signing material lives outside the repo and outside source
   ZIPs (see MASTER_PLAN.md §6). Logs must never contain document contents or paths
   beyond what is needed for a local diagnostic the user explicitly shares.
8. **Recovery safety.** Autosave snapshots are app-private, never overwrite the only copy,
   and are listed on a recovery screen (file name, time, actions: Recover / Discard).
   Incomplete writes are detected and the recoverable temp data is preserved, not deleted.

## 8. Build and packaging strategy (summary)

- **Android:** Gradle project, Kotlin + Compose, Room, WorkManager; CI build is the only
  verified build route in this environment (local Gradle is platform-blocked in this VM —
  see MASTER_PLAN.md §6 and STATUS.md). Release APK via CI; debug APK, if produced, is
  labelled debug and never silently substituted for release. Signing: release keystore
  outside the repo; no key material in docs or source.
- **Windows:** per the stack decision (stream 3); installer (EXE/MSI or justified
  equivalent) + uninstall instructions; runtime prerequisites (e.g. WebView2 if Tauri)
  documented; signing status stated honestly (unsigned = stated as unsigned).
- **Shared:** `shared/` holds only genuinely shared contracts/tests (stream 4); no
  artificial module folders. Final repo layout follows Appendix A of the Master
  Instructions, adapted to the real build boundaries — see MASTER_PLAN.md §2.
- **No binaries in ordinary source commits** unless clearly justified; release artifacts
  go to GitHub Releases (or the agreed delivery mechanism), with checksums.

## 9. Diagrams — reading note

The diagrams in this document are ASCII by design (they render identically in any viewer
and survive copy/paste into the public repo). If implementation streams produce rendered
diagrams, they must depict **this** architecture — same module boundaries, same
platform split, same no-cloud invariant — not a redesigned one. Any deviation must be
recorded in DECISION_LOG.md with rationale.

## 10. Open architecture questions (for implementation streams)

1. Windows stack — final decision (stream 3, `apps/windows/DECISION.md`). This doc's
   candidate summary must not be quoted as the decision.
2. Exact engine versions — pinned only when an implementation stream integrates an engine
   and records the resolved version + licence check in DEPENDENCIES_AND_LICENSES.md.
   Versions in `research/ENGINE_RESEARCH.md` are research snapshots (31 Oct 2026), not pins.
3. LibreOffice embedding — explicitly **not assumed feasible** (Master §6). If any stream
   proposes it, it must evidence binary size, platform support (Android especially),
   licensing (MPL-2.0/LGPL), and maintenance cost before adoption.
4. PDF annotation/form scope — which annotation types and form features the chosen PDF
   adapter actually supports is Not verified until an engine is integrated and tested.
5. OCR languages — which languages ship, their model sizes, and their licences must be
   recorded before Scan & OCR is claimed for any language beyond the default.
6. Windows SQLite choice — Room is Android-only; the Windows DB layer (e.g. rusqlite,
   SQLCipher-free plain SQLite, or the stack's own binding) is decided with the stack.

---

*Sources: Master Development Instructions (31 Oct 2026) §§1–10, 12, App. A/B;
UI/UX Design Brief (31 Oct 2026) §§1–18; prototype inspection
(`research/PROTOTYPE_INSPECTION.md`); engine research (`research/ENGINE_RESEARCH.md`).
No test was executed by this stream; see STATUS.md.*
