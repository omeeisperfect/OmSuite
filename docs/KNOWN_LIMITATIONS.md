# OmSuite — Known Limitations

Date: 31 Oct 2026, with a PDF-spec correction-pass addendum dated 1 Nov 2026
below. This file collects every limitation stated by the implementation
streams plus the packaging/CI limits. If a limitation is not listed here,
it is not "known" — it is unexamined, and belongs in the deferred-testing
list in `FINAL_STATUS.md`, not assumed away.

## PDF-spec correction pass — 1 Nov 2026 (supersedes the "nine modules Not implemented" claim)

All 12 modules are now reachable in both apps, but every module remains
**Partially complete** — see `docs/PDF_SPEC_CHECKLIST.md` for the exact
per-module, per-platform list. Headline limits that survive this pass:

- **PDF:** merge/split/page insert-delete-extract-reorder/rotate-in-file,
  annotations, form filling, and PDF text editing are Not implemented on
  both platforms (no PDF library vendored; controls disabled with reason).
  Text extraction is best-effort only; scanned/encrypted/layout-accurate
  PDFs are Not supported.
- **Sheets:** formulas are `+ - * /`, parens, A1 refs, SUM/AVERAGE/MIN/MAX/
  COUNT only; no charts, no copy/paste/fill; XLSX is not offered in the
  apps (shared engine: single-sheet, no styles/dates/charts).
- **Slides:** no themes/layouts/shapes, no PPTX import/export, no
  animations; Android deck file save/load is Not implemented (session
  only, HTML export is the persistence path, stated in UI).
- **Media:** view/playback only; no crop/adjust/metadata editing, no
  transcoding; Android background audio and subtitles Not implemented.
- **E-books:** EPUB plain-text chapters only; no images/styles/DRM;
  MOBI/AZW Not implemented (DRM never bypassed).
- **Archives:** ZIP only; RAR/7Z/TAR Not implemented; encrypted ZIP
  entries refused (no password support).
- **Converter:** only CSV↔JSON, JSON pretty/minify, TXT→MD (heuristic),
  CSV→MD-table (shared only); every other pair raises Not supported and
  is not offered. No batch conversion.
- **Scan & OCR:** Windows OCR Not implemented (no OCR engine bundled,
  disabled with reason); Android OCR is ML Kit Latin only, no confidence
  display, and its PDF export has no searchable text layer.
- **Writer/Code:** tables, images, hyperlinks, page layout, headers/
  footers, page numbers, print, and spell-check are Not implemented.
  Windows mixed line endings save as LF (labelled in UI).
- **File Manager:** cancellation of long operations and Trash/restore
  are Not implemented; delete is permanent with confirmation.
- **Settings/recovery:** no central recovery screen; recovery exists as
  per-editor draft prompts only.
- **Testing:** Android device UI and Windows runtime behaviour remain
  **Not Tested** (deferred per Master §13). Signing remains debug
  (Android) / unsigned (Windows). Project licence remains NOT SELECTED;
  no LICENSE file exists.
- **Windows build size:** the old 357 MB unpacked observation is stale;
  the current installer size is whatever the latest release asset reports
  (see release notes) — do not cite 357 MB for the current build.

## Product scope limits

- **Nine of twelve modules are Not implemented** (Sheets, Slides, PDF
  Studio, Media, E-books, Archives, Converter, Scan & OCR, plus full
  office-format editing). They do not appear as working features in either
  app. The delivered core is File Manager + text Writer/Editor + Settings.
- **No sync between Android and Windows.** Each installation manages its
  own local data. There is no cloud, no account, and no cross-device
  transfer in this phase — by design, not by omission.
- **No release builds exist.** The Android build is debug-only; the
  Windows installer would be unsigned. Neither may be presented as a
  finished release.
- **No custom app icon for Windows.** Packaged Windows builds use
  Electron's default icon. The user has not picked an OmSuite Windows
  icon; none was invented from the prototypes (which contain no icon
  asset). The Android icon is a simple vector mark, not a final brand asset.

## Android limits (from `apps/android/STATUS.md`)

- Compile **not proven**: first CI build may surface Compose/Material3 API
  mismatches (`DropdownMenuItem` signatures, `ActivityResultContracts`
  usage). Fix in CI; do not hand-edit blindly.
- Editor launch handoff (`EditorLaunch`) is session-only in-memory: it
  does **not** survive process death (worst case the editor opens blank;
  the file itself is never at risk).
- Undo/redo enabled-state refreshes on text-change recomposition only.
- Markdown preview is a subset: bullets/numbered items render plain text;
  tables, images, links, and nested lists are out of scope.
- File Manager copy/move destination is limited to granted folders (SAF).
- Item ⋮ menu is a root-level DropdownMenu; positioning may sit oddly on
  some screens — needs a device check.
- Settings' stored default folder is only a suggested location; the
  Save-As picker still asks each time (Android requires a user-driven
  picker).
- `gradlew` is a bootstrap script, not the stock wrapper jar.

## Windows limits (from `apps/windows/STATUS.md`)

- **Delete is permanent with confirmation, not Trash-backed.**
- Editor refuses files over 10 MB and binary files (by design).
- Folder size counting caps at 200,000 entries and reports truncation.
- Copy/move never overwrite: a clash gets a ` - Copy` name (deliberate
  data-loss guard; differs from Explorer's overwrite prompt).
- Markdown preview is a subset: tables, footnotes, and embedded HTML are
  not rendered (HTML is escaped, never passed through).
- Renderer find/replace duplicates the tested `text-core` algorithm in
  browser JS (the renderer cannot `require` Node modules). The core
  functions carry the unit tests; the renderer copy is smoke-verified
  only by the launch check, not by a UI test. A UI-level test on Windows
  is still owed.
- Settings file location on Windows (`%APPDATA%\OmSuite`, via Electron's
  `app.getPath('userData')`) is **Not Tested on Windows itself**.
- The prototype's "green" theme was NOT carried over: only light/dark/
  system ship. The prototype's Tailwind CDN is NOT shipped.
- Unpacked Windows build size observed: 357 MB (Electron 45 runtime +
  app). Installed size and installer size are **Not Tested** — the NSIS
  installer was never completed, so no installer size is claimed.

## Shared reference engine limits (from `shared/STATUS.md`, L1–L7)

- Atomicity is temp-file + fsync + replace — not crash-proof against
  OS/power failure. A power cut between fsync and replace can still leave
  the temp file; apps must clean `.<name>.*` temp files on startup.
  Crash-during-write was NOT simulated.
- A mid-extraction archive conflict (policy `error`) can leave earlier
  entries extracted, and the caller gets the exception without a partial
  list. Apps must surface "partially extracted" honestly.
- YAML is a subset: anchors, multi-doc, block scalars, and duplicate keys
  are refused, not edited.
- XML pretty-print drops comments, processing instructions, and DOCTYPE
  (ElementTree limitation) — warned, never lossless.
- MD→TXT is lossy by design; CSV→JSON keeps everything as strings (no
  type inference).
- Content search is UTF-8 text only; binary and latin-1 files are skipped
  for content search (they still match by name).
- Copy size default cap 2 GiB; text read cap 50 MiB. Callers must raise
  them explicitly for larger files; apps must explain a refusal.

## Format limits (summary — full matrix: `FORMAT_SUPPORT.md`, stream 1)

- Supported for real editing today (both apps, within the text scope):
  TXT, MD, JSON, XML, YAML, HTML (text editing; HTML is never executed).
- ZIP: browse/extract/create exist only in the shared reference engine,
  **not** in either app's UI. RAR/7Z: Not implemented anywhere.
- DOCX/XLSX/PPTX/PDF/EPUB: no engine, no tests, no UI — reading, editing,
  and conversion are all Not implemented. Opening a file by extension is
  never a claim of editing support.
- MOBI/AZW: separate evaluation, Not verified; DRM is never bypassed.
- PSD/AI: preview/limited import only unless genuine editing is proven —
  currently nothing is proven.

## Security limits (see also `SECURITY.md`)

- No security review, no dependency vulnerability audit, and no
  malicious-file test corpus has been run. Archive guards exist in code
  and are unit-tested (reference + Windows cores), but hostile-file
  behaviour on a device is Not Tested.
- Signing: no release signing on either platform; the Windows installer
  is unsigned and the Android APK is debug-signed only.
- The secret scan covers credential-shaped patterns and signing files in
  the source tree; it cannot prove that no secret exists in a form the
  patterns do not match (e.g. a pasted token split across lines).

## Packaging / CI limits

- CI workflows have never run (no repository yet). Their success is
  assumed by no one; first runs are expected to possibly fail, especially
  the unproven Android compile.
- CI artifacts are retained 30 days only; they are not releases. Real
  distribution is via GitHub Releases with checksums, once a repository
  exists and a build has actually succeeded.
- `node_modules/`, `dist/`, `build/`, and `__pycache__/` are never part
  of source ZIPs (see `scripts/package-source.sh` exclusions).
