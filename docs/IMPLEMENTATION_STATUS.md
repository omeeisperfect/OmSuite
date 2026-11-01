# OmSuite — Implementation Status (evidence-based)

Date: 31 Oct 2026. Owner: stream 5 (docs/CI/packaging).
Rule: a status is upgraded **only** on evidence in another stream's
`STATUS.md` (executed commands/tests) or in this stream's own executed
checks. Everything else stays **Not verified** / **Not implemented**.
Prototypes (`prototypes/`) are visual reference only and are never cited
as implementation evidence.

## Status labels (Master Instructions §15)

- **Complete** — implemented to the documented scope; testing status stated
  separately (a "Complete" module may still be Not verified on a device).
- **Partially complete** — some operations work; the remainder is listed.
- **Not implemented** — no real implementation exists.
- **Not verified** — code may exist, but executed verification is missing.

## Module status

| Module | Android | Windows | Shared reference |
|---|---|---|---|
| File Manager | Partially complete (multi-select, sort/search, properties, favourites/recents, breadcrumbs, conflicts; cancellation Not implemented; **Not verified** on device) | Partially complete (same + copy progress; cancellation Not implemented; Windows behaviour **Not Tested**) | Tested reference (copy/move many, properties, conflicts, atomic write; 118-test suite) |
| Writer / Text Editor | Partially complete (formatting toolbar, find/replace, undo/redo, save/Save As, draft recovery; tables/images/page layout/print Not implemented; **Not verified** on device) | Partially complete (same + Markdown toolbar, draft recovery; tables/images/page layout/print Not implemented; Windows behaviour **Not Tested**) | Tested reference (TXT/MD/JSON/XML/YAML-subset, Markdown subset, JSON tools) |
| Code / Text Editor (syntax, JSON/MD tools) | Partially complete (highlight toggle, line numbers, find/replace, JSON validate/format, MD preview subset; **Not verified** on device) | Partially complete (highlight toggle, line numbers gutter, find/replace, indent/outdent, CRLF/BOM preserved; mixed endings save as LF, labelled; Windows behaviour **Not Tested**) | Tested reference (JSON/XML validate+format, YAML subset, tokenizer) |
| Settings + recovery | Partially complete (theme applied, save location, clear recents/cache/favourites, privacy note; no central recovery screen; **Not verified** on device) | Partially complete (theme, save location, recents limit, cache, privacy note; no central recovery screen; Windows behaviour **Not Tested**) | Settings store tested on Windows side (41-test suite) |
| Sheets | Partially complete (multi-sheet, formulas + - * / parens, A1 refs, SUM/AVERAGE/MIN/MAX/COUNT, per-cell errors, sort/filter, freeze header, CSV; charts/styles/copy-paste/fill/XLSX-in-app Not implemented; **Not verified** on device) | Partially complete (same + formula bar, formats, freeze row+column, column resize, workbook JSON save/open; charts/copy-paste/fill/XLSX Not implemented; Windows behaviour **Not Tested**) | Tested reference (sheet_core: formulas, cycles, multi-sheet Workbook, sort/filter, CSV round-trip, single-sheet/no-style XLSX; 118-test suite) |
| Slides | Partially complete (add/duplicate/delete/reorder, title/body/image, notes, present mode, HTML export with embedded images; deck file save Not implemented — session only, export is persistence; **Not verified** on device) | Partially complete (same + deck JSON save/open; themes/layouts/shapes/PPTX Not implemented; Windows behaviour **Not Tested**) | Tested reference (slide_core: deck model + HTML export, notes, escaping tested) |
| PDF Studio | Partially complete (view, thumbnails, search, zoom, view rotation, page PNG export; merge/split/page-ops/text-edit/annotations **Not implemented**, disabled with reason; **Not verified** on device) | Partially complete (embed view, extracted-text search, view zoom/rotate; merge/split/page-ops/text-edit/annotations **Not implemented**, disabled with reason; Windows behaviour **Not Tested**) | Tested reference (pdf_core: FlateDecode, Tj/TJ, best-effort only, no layout/font decoding; merge/split are stubs raising UNSUPPORTED_FORMAT) |
| Media | Partially complete (image zoom/rotate, audio queue/seek/speed, video seek/fullscreen; subtitles/background audio Not implemented; **Not verified** on device) | Partially complete (image zoom/rotate, audio/video queue/seek/speed; crop/adjust/metadata/transcoding Not implemented; Windows behaviour **Not Tested**) | Not implemented (no shared media engine; platform viewers only) |
| E-books | Partially complete (EPUB TOC, bookmarks, progress, text size, themes, search; plain-text only, no images/styles/DRM; MOBI/AZW Not implemented; **Not verified** on device) | Partially complete (same + NCX/nav TOC, progress resume; plain-text only, no images/styles/DRM; Windows behaviour **Not Tested**) | Tested reference (epub_core: container/OPF/spine, TOC, bookmarks, progress, search) |
| Archives | Partially complete (browse before extract, extract all/selected, ZIP create, progress, conflicts, traversal guard; encrypted refused; RAR/7Z/TAR Not implemented) | Partially complete (same + per-entry checkboxes, extract selected, never silently overwrites; encrypted refused; RAR/7Z/TAR Not implemented; Windows behaviour **Not Tested**) | Tested reference: ZIP only (browse/extract/create + traversal, symlink, bomb guards, partial-path reporting). RAR/7Z/TAR: Not implemented |
| Converter | Partially complete (CSV↔JSON, JSON→CSV, TXT→MD heuristic labelled, JSON pretty-print; history + clear; other pairs not offered; batch Not implemented; **Not verified** on device) | Partially complete (same pairs + history (20) + clear; other pairs not offered; batch Not implemented; Windows behaviour **Not Tested**) | Tested reference: TXT↔MD, JSON pretty/minify, CSV↔JSON, CSV↔MD table, closed dispatcher (every other pair raises UNSUPPORTED_FORMAT) |
| Scan & OCR | Partially complete (multi-page capture, rotate/crop/reorder, ML Kit on-device Latin OCR, editable result, TXT export, image-only PDF export labelled as no text layer; **Not verified** on device) | Partially complete (image pick + view + zoom/rotate only; OCR **Not implemented**, disabled with reason "no OCR engine bundled"; Windows behaviour **Not Tested**) | Not implemented (no shared OCR engine) |

## Completion pass — 1 Nov 2026 (evidence)

- Windows: `npm test` in `apps/windows` → **31 pass, 0 fail** (was 17; +14 new).
- Shared: `python3 -m unittest discover -s tests` → **69 run, 68 pass, 1 skipped** (pre-existing root skip; was 36 run, 35 pass, 1 skipped).
- Android: compile and unit tests **Not Tested locally** (local Gradle platform-blocked); verified by CI only (see CI section in the final report). Android UI behaviour on a device is **Not Tested**.
- Project licence: still **NOT YET SELECTED**; no `LICENSE` file was added.
- Local-first holds: no web, no cloud, no account, no sync, no telemetry in the new code (verified by grep for network/analytics calls; the only `http://` strings are OOXML XML namespace identifiers in sheet_core.py).

## Evidence behind each row

### Android (source: `apps/android/STATUS.md`, stream 2, 31 Oct 2026)

- 32 files; 13 Kotlin source files (~1,750 lines main) + 2 test files
  (14 tests: 9 FileUtils + 5 TextUtils).
- File Manager: real SAF files only (DocumentFile: list, create folder/file,
  rename, copy, move as copy-then-delete, delete, read/write text,
  persistable permissions). No sample data. Copy/move destination limited
  to granted folders. Item ⋮ menu is a root-level DropdownMenu — positioning
  may sit oddly on some screens; needs a device check.
- Editor: TXT/MD/JSON/XML/YAML/HTML text editing; JSON format/validate;
  Markdown preview subset; find/replace-all; undo/redo (per-keystroke
  snapshots, cap 100); autosave draft + recovery prompt; overwrite
  confirmation. No syntax highlighting, no binary formats.
- Editor launch handoff uses a session-only in-memory holder
  (`EditorLaunch`): it does **not** survive process death (file itself is
  never at risk — worst case the editor opens blank).
- Settings: theme (light/dark/system), default save location, clear
  recents, clear cache, privacy statement. The stored default folder is
  shown as the suggested location; the Save-As picker still asks each time
  (Android requires a user-driven picker).
- **Tests/builds executed: none.** Local Gradle build: Not Tested (no Java
  in the VM). The 14 unit tests: Not Tested (not executed locally).
  Device/emulator run: Not Tested. All Android UI behaviour is therefore
  **Not verified**, including SAF pickers, Room flows, editor save/recovery,
  and theme switching. Compile is not proven — the first CI build may
  surface Compose/Material3 API mismatches (stream 2 flags `DropdownMenuItem`
  signatures and `ActivityResultContracts` usage).

### Windows (source: `apps/windows/STATUS.md`, stream 3, 31 Oct 2026)

- Electron 45.2.1 + plain HTML/CSS/JS (no bundler, no React, no CDN at
  runtime); pure-Node cores under `src/main/` (unit-testable without
  Electron); `src/main.js` is the thin Electron wiring layer.
- File Manager (complete for the listed scope): real local filesystem —
  browse, list/grid/details views, sort, filter/search in folder, create
  folder, rename, copy, move (incl. cross-volume), duplicate, delete
  (**permanent with confirmation, not Trash-backed**), multi-select,
  breadcrumbs, back/forward/up, persisted favourites + recents, properties,
  drag-in from OS, drag-row-onto-folder to move, right-click menus,
  keyboard shortcuts.
- Editor (complete for the listed scope): create/open/edit/save/Save As
  for TXT/MD/JSON/XML/YAML/HTML; find/replace; undo/redo; dirty indicator
  with discard confirmation; JSON validation + pretty-format; Markdown
  preview safe subset (HTML escaped, `javascript:` links blocked).
- Settings (complete): theme light/dark/system, default save location,
  recent-history toggle + clear, cache clear, privacy statement.
- **Executed evidence:** `node --check` 7/7 JS files PASS; unit tests
  17/17 PASS (`npm test`, incl. 2 failures found and fixed during the run —
  one test bug, one real copy-uniquify production bug); Electron smoke
  launch on Linux + Xvfb PASS (`SMOKE_OK window loaded` +
  `OMSUITE_RENDERER_READY`, no startup errors). This proves the shell +
  renderer start on Linux only.
- **Not Tested:** Windows run itself (dialogs, drive letters, %APPDATA%,
  SmartScreen), manual UI walkthrough on Windows, accessibility, and
  large-folder (10k+ files) performance. The Windows installer was never
  completed (see `BLOCKERS.md` B-2); the partial 190,333-byte exe was
  deleted, and the 357 MB unpacked directory was deleted with it.
- Code signing: Not implemented — builds are unsigned; never described
  as signed anywhere in the tree.

### Shared reference engines (source: `shared/STATUS.md`, stream 4, 31 Oct 2026)

- Python 3.12.3, standard library only. `shared/` = file_core (384 lines),
  archive_core (241), text_core (387), convert_core (242), errors (76),
  plus `CONTRACTS.md` (language-neutral spec for Android/Windows ports).
- **Executed evidence:** `python3 -m unittest discover -s tests` →
  **Ran 36 tests, 35 passed, 0 failed, 1 skipped** (0.031s). The skipped
  test (`test_permission_denied_on_readonly_dir`) is skipped because this
  VM runs as root (uid 0), which bypasses permission checks — it is
  **not** counted as passed.
- **Explicitly not shipped code:** stream 4 states this Python code is the
  reference, not the shipped app code. SAF adaptation and the Kotlin/Node
  ports of these contracts are owned by streams 2/3. Do not cite shared
  test results as proof that either app implements the same behaviour —
  each app's own tests are the evidence for that app (Windows: 17/17;
  Android: 14 tests, Not Tested).
- Known reference limits (L1–L7 in `shared/STATUS.md`): atomicity is
  temp-file + fsync + replace (not crash-proof against OS/power failure);
  a mid-extraction conflict can leave earlier entries extracted without a
  partial list on the exception; YAML is a subset (anchors/multi-doc/block
  scalars refused); XML pretty-print drops comments/DOCTYPE; MD→TXT is
  lossy by design; CSV→JSON keeps everything as strings; content search
  is UTF-8 text only; copy cap 2 GiB, text read cap 50 MiB by default.

## PDF-spec correction pass — 1 Nov 2026 (evidence)

This pass was ordered after the user rejected the 12-module breadth build
as useless/showcase ("mujhe app use leni hai, dikhawe ke liye nahi hai")
and clarified the scope as the two PDFs, perfectly, for real use. Full
per-module, per-platform checklist: `docs/PDF_SPEC_CHECKLIST.md`.

- Windows: `npm test` in `apps/windows` → **41 pass, 0 fail** (was 31; +10 new
  in `tests/depth.test.js`). No existing test modified.
- Shared: `python3 -m unittest discover -s tests` → **118 run, 117 pass,
  1 skipped** (pre-existing root skip; was 69 run, 68 pass, 1 skipped).
  No existing test modified.
- Android: new unit tests added (FormulaDetail, SheetUtils, SearchScanUtils,
  DepthUtils) but **Not Tested locally** (local Gradle platform-blocked);
  verified by CI only. Android UI behaviour on a device is **Not Tested**.
- Secret scan: `scripts/secret-scan.sh` → CLEAN. No `LICENSE` file added
  (project licence still NOT YET SELECTED, user decision pending).
- Local-first holds: no web, no cloud, no account, no sync, no telemetry.
  Windows shell remains Electron (Tauri evaluated and rejected for lack of
  Rust/MSVC in this VM — see `apps/windows/DECISION.md`).
- Every offered operation now works end-to-end for real, or is disabled
  with a visible reason (PDF merge/split/page-ops, Windows OCR). No
  decorative button is presented as a working feature.

## Overall product verdict

**Partially complete.** All 12 modules are reachable in both apps and their
offered operations work end-to-end for real, with the Partial items in the
table above (and in `docs/PDF_SPEC_CHECKLIST.md`) disabled or absent with
reasons. The product must not be labelled "fully complete" while any major
module remains Partial, while device/Windows-runtime testing is deferred
(Master §13), while signing is debug/unsigned only, and while the project
licence is not selected. The deferred comprehensive testing list is in
`FINAL_STATUS.md` and in `docs/PDF_SPEC_CHECKLIST.md`.
