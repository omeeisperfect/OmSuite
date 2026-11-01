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
| File Manager | Partially complete (code complete, **Not verified** on device) | Complete for the listed scope (unit-tested; Windows behaviour **Not Tested**) | Tested reference (part of 36 tests: 35 pass, 1 skipped) |
| Writer / Text Editor | Partially complete (code complete, **Not verified** on device) | Complete for the listed scope (unit-tested; Windows behaviour **Not Tested**) | Tested reference (TXT/MD/JSON/XML/YAML-subset) |
| Code / Text Editor (syntax, JSON/MD tools) | Partial (text editing + JSON validate/format + MD preview subset + syntax highlighting for Kotlin/Python/JavaScript, highlight view read-only; **Not verified** on device) | Partial (same scope + syntax highlighting for JavaScript/Python/Kotlin via highlight-core; Windows behaviour **Not Tested**) | Tested reference (JSON/XML validate+format, YAML subset) |
| Settings + recovery | Partially complete (theme, save location, clear recents/cache, privacy note; **Not verified** on device) | Complete for the listed scope (theme, save location, recents/cache, privacy note) | Settings store tested on Windows side (31/31 suite) |
| Sheets | Partially complete (grid, formulas + - * / parens, A1 refs, SUM/AVERAGE, CSV load/save; XLSX not in app; **Not verified** on device) | Partially complete (same scope, sheet-core unit-tested; Windows behaviour **Not Tested**) | Tested reference (sheet_core: formulas, cycles, CSV round-trip, single-sheet/no-style XLSX; 69-test suite) |
| Slides | Partially complete (deck add/delete/reorder, title/body, image per slide, present mode, HTML export without embedded images; **Not verified** on device) | Partially complete (same scope, HTML export embeds images as data URLs; Windows behaviour **Not Tested**) | Tested reference (slide_core: deck model + HTML export, escaping tested) |
| PDF Studio | Partially complete (PdfRenderer view + best-effort text extract; merge/split **Not implemented**, disabled with reason; **Not verified** on device) | Partially complete (embed view + best-effort text extract via pdf-core, tested on synthetic PDFs; merge/split **Not implemented**, disabled; Windows behaviour **Not Tested**) | Tested reference (pdf_core: FlateDecode, Tj/TJ, best-effort only, no layout/font decoding) |
| Media | Partially complete (image view, audio MediaPlayer, video VideoView; **Not verified** on device, no playback test) | Partially complete (image view, HTML audio/video playback; Windows behaviour **Not Tested**, no playback test) | Not implemented (no shared media engine; platform viewers only) |
| E-books | Partially complete (EPUB plain-text chapters via java.util.zip, TXT fallback; no images/styles/DRM; **Not verified** on device) | Partially complete (EPUB plain-text chapters via epub-core, tested on synthetic EPUB; no images/styles/DRM; Windows behaviour **Not Tested**) | Tested reference (epub_core: container/OPF/spine, paragraph text) |
| Archives | Partially complete (ZIP create/list/extract, traversal guard; RAR/7Z **Not implemented**) | Partially complete (ZIP create/list/extract via zip-core, tested round-trip; encrypted entries refused; RAR/7Z **Not implemented**; Windows behaviour **Not Tested**) | Tested reference: ZIP only (browse/extract/create + traversal, symlink, bomb guards; empty-dir fix in this pass). RAR/7Z: Not implemented |
| Converter | Partially complete (CSV↔JSON, TXT→MD heuristic labelled, JSON pretty-print; other pairs show Not supported; **Not verified** on device) | Partially complete (same pairs via convert-core, unit-tested; Windows behaviour **Not Tested**) | Tested reference: TXT↔MD, JSON pretty/minify, CSV↔JSON, CSV↔MD table — now integrated into both apps for the pairs above |
| Scan & OCR | Partially complete (camera/gallery capture + ML Kit on-device Latin OCR, editable result, save TXT; **Not verified** on device) | Partially complete (image pick + view only; OCR **Not implemented**, disabled with reason "no OCR engine bundled"; Windows behaviour **Not Tested**) | Not implemented (no shared OCR engine) |

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

## Overall product verdict

**Not complete.** The delivered core is File Manager + text Writer/Editor +
Settings on two platforms, with the Windows side unit-tested and
Linux-smoke-verified, the Android side written but never compiled or run,
and the shared engines tested as a reference only. Nine of the twelve
Master-Instructions modules are Not implemented. No APK, no installer, no
public repository, and no release exist yet. The deferred comprehensive
testing list is in `FINAL_STATUS.md`.
