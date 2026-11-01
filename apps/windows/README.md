# OmSuite for Windows

**Everything. One Workspace.** — a personal, local-first productivity suite for
Windows. No account, no login, no cloud storage, no sync, no subscription,
no telemetry. The app makes no network requests while running. Core works
fully offline.

This folder is the Windows application only (Stream 3). See `DECISION.md` for
the stack decision and `STATUS.md` for build/test evidence and limitations.

## What is actually implemented (this build: 0.1.0, core only)

| Module | Status | What works |
|---|---|---|
| File Manager | Complete (for the listed scope) | Real local filesystem: browse, list/grid/details views, sort (name/size/date/type), filter/search in folder, create folder, rename, copy, move (incl. cross-volume), duplicate, delete (permanent, with confirmation), multi-select (Ctrl/Shift-click, Ctrl+A), breadcrumbs, back/forward/up, favourites (persisted), recents (persisted), properties (size/count for folders), drag files in from the OS to copy, drag a row onto a folder to move, right-click menus, keyboard shortcuts (Ctrl+C/X/V, Delete, F2, Ctrl+F) |
| Text Writer + Code/Text Editor | Complete (for the listed scope) | Create/open/edit/save/Save As for TXT, MD, JSON, XML, YAML, HTML; find (next/prev, match case), replace, replace all; undo/redo; dirty (unsaved) indicator with discard confirmation; JSON validation + JSON pretty-format; Markdown preview (headings, bold/italic, code, lists, links, quotes — safe subset, HTML escaped, `javascript:` links blocked) |
| Settings | Complete | Light / dark / system theme, default save location (browse/clear), recent-history on/off + clear, cache clear, privacy statement, about (version, data folder) |
| Sheets, Slides, PDF Studio, Media, E-books, Archives, Converter, Scan & OCR | **Not implemented** | These do NOT appear in the app as working features. They are not menu items, not buttons, not placeholders. See STATUS.md. |

Every visible control in the app has a real action. There are no dead buttons
and no hardcoded sample files presented as real files: an empty folder shows
an empty state, and Recents/Favourites start empty.

## Stack

Electron 45.2.1 + plain local HTML/CSS/JavaScript (no bundler, no React, no
CDN). Pure Node.js cores under `src/main/` are unit-testable without Electron.
Full rationale, including why Tauri 2 and PySide6 were not chosen for this
build, is in `DECISION.md`.

## Run from source (Windows)

Prerequisites (build/run-from-source only): Node.js 20 or newer + npm.
No other runtime prerequisites: the packaged app bundles its own Chromium +
Node and needs no .NET, no WebView2 install, no Python, no admin rights.

```powershell
cd apps/windows
npm install
npm start
```

Run the unit tests (no Electron needed):

```powershell
npm test
```

## Build the Windows installer (Windows machine or Windows CI runner only)

```powershell
cd apps/windows
powershell -ExecutionPolicy Bypass -File scripts/build-windows.ps1
```

This runs `npm install` and then `electron-builder@26.18.0 --win nsis --x64`
(see `electron-builder.yml`). Output: `dist\OmSuite-Setup-0.1.0.exe` — an NSIS
installer, per-user (no admin required), with Desktop + Start Menu shortcuts,
install directory changeable during setup.

**This installer cannot be built on the Linux VM used for this stream:**
electron-builder's NSIS step requires Wine on Linux, and Wine is absent there
(exact error in STATUS.md). A partial `OmSuite-Setup-0.1.0.exe` produced
during that failed attempt was deleted, not shipped. Build on Windows.

## Install / uninstall (for the person receiving the installer)

Install: run `OmSuite-Setup-0.1.0.exe`, follow the prompts, launch OmSuite
from the Start Menu or Desktop shortcut. Supported: **Windows 10 version 1809
or newer, and Windows 11, x64**. Windows 7/8/8.1 are NOT supported
(Electron 45 requires Windows 10+). No internet connection is needed to
install or run the app (the installer itself is fully self-contained).

Uninstall: Windows Settings → Apps → OmSuite → Uninstall (this also removes
the Start Menu/Desktop shortcuts). To also erase OmSuite's local data
(settings, favourites, recents list, preview cache — paths only, never file
contents), delete `%APPDATA%\OmSuite` after uninstalling.

## Code-signing status — read this before sharing the installer

**UNSIGNED.** No code-signing certificate was available to this build, and
no signing was performed or claimed. Consequences, stated plainly:

- Windows SmartScreen will likely warn on first run ("Windows protected your
  PC"). The recipient must click "More info" → "Run anyway" to proceed.
  That warning is expected for an unsigned build; it is not evidence the
  file is malicious, and it is not a substitute for checking where the file
  came from.
- Some antivirus tools may flag any new unsigned installer at first. If that
  happens, the file's origin (who built it, on which machine) is the thing to
  verify — this stream cannot vouch for a build it did not produce on Windows.
- To ship a signed installer, a real code-signing certificate must be
  obtained (outside this codebase — never stored in this repo) and configured
  in electron-builder on the Windows build machine. Until then, every build
  from these scripts is unsigned by design, and the app's About dialog says so.

## Where your data lives (Windows)

- App data (settings, favourites, recents): `%APPDATA%\OmSuite\omsuite-settings.json`
- Preview cache: `%APPDATA%\OmSuite\cache\` (cleared from Settings → Cache)
- Your files stay where they are. OmSuite never copies your files to a
  server, never renames them without your action, and never overwrites on
  copy/move — a name clash gets a ` - Copy` name instead.

## Safety notes (honest limits)

- Delete is **permanent** in this build (no Recycle Bin / Trash step yet).
  The app asks for confirmation and states the count, but there is no undo
  for delete. A Trash-backed delete is a future improvement, not a current
  feature.
- The app runs with the signed-in user's own privileges, like Windows
  Explorer. It will not execute file contents, macros, or scripts found in
  files; double-clicking a non-text file opens it in its OS default app,
  exactly as Explorer would.
- The Editor refuses binary files (NUL byte check) and files over 10 MB
  instead of showing garbage or exhausting memory.
- Folder size counting stops at 200,000 entries and reports that it stopped.
- Markdown preview escapes all HTML: a Markdown file cannot inject scripts
  into the preview.

## Licence

No licence has been selected for OmSuite yet, so **no LICENSE file is
shipped and no reuse permission is claimed**. Third-party notices for
Electron (MIT) and Node.js (MIT) ship inside the packaged app
(`LICENSE.electron.txt`, `LICENSES.chromium.html` in the install folder).
Do not add a licence file on your own authority — that choice belongs to nimu.

## Known limitations (this build)

- Windows-native behaviour (native dialogs, drive letters, `%APPDATA%`
  paths, SmartScreen text) has NOT been run on a real Windows machine yet —
  marked Not Tested in STATUS.md. The app was smoke-launched on Linux under
  Xvfb only, which proves the shell + renderer start, not Windows behaviour.
- No custom app icon yet: the packaged build uses Electron's default icon.
- No system-tray, no auto-start, no global hotkeys, no multi-window support.
- Editor is plain-text editing (no syntax highlighting, no spell check).
  Markdown preview is a documented subset, not a full Markdown engine.
- Sheets/Slides/PDF/Media/E-books/Archives/Converter/Scan & OCR are not
  implemented (see table above).
