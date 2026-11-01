# OmSuite for Windows — Stack Decision

Date: 31 Oct 2026. Stream: windows-foundation (Stream 3).
Scope of this file: the Windows application only. Other streams own their own stacks.
Rule followed: do NOT pick a stack solely because it is easy. Fidelity, maintenance,
licensing, offline operation, and packaging are weighed below, and what can actually
be built and verified on this Linux VM is stated separately from what needs a
Windows machine.

## Evidence gathered in this environment (exact commands in STATUS.md)

- `node --version` → v24.22.1; `npm --version` → 10.9.4. npm registry reachable.
- `npm view electron version` → 45.2.1; `npm view electron-builder version` → 26.18.0.
- `which rustc cargo` → nothing; `~/.cargo` and `~/.rustup` do not exist. Rust is absent.
- `which java javac dotnet wine` → nothing. Java, .NET SDK, and Wine are absent.
- Python 3.12.3 present; `tkinter` 8.6 present; `import PySide6` → ModuleNotFoundError.
- No display server (`DISPLAY` empty); `Xvfb` / `xvfb-run` are present, so a GUI can
  be smoke-launched headlessly on Linux for a launch check only.
- A full Rust toolchain install was NOT performed. Reason, recorded honestly: it
  would not unlock the thing that matters here — a verifiable Windows build.
  Tauri's Windows target needs a Windows machine (or Windows CI runner) with
  MSVC + WebView2 runtime tooling; a Linux-built Tauri binary would still prove
  nothing about the Windows installer, menus, or dialogs. Downloading ~hundreds of
  MB of toolchain to reach the same "Not verified on Windows" conclusion would
  have been theatre, not evidence. The availability check above is the exact
  install result: Rust not installed, not attempted beyond that check.

## Decision: Electron (pinned) + plain local HTML/CSS/JavaScript, no bundler, no React

- Shell: Electron 45.x (see `package.json` for the exact pinned version installed
  during this build; STATUS.md records what actually installed).
- Renderer: plain HTML/CSS/JS files shipped inside the app. No CDN, no Tailwind CDN
  (the prototype used a Tailwind CDN link — that is explicitly NOT shipped),
  no network fetch at runtime.
- Core logic: pure Node.js modules under `src/main/` with NO Electron import, so
  they are unit-testable with plain `node` on any machine. `src/main.js` is the
  thin Electron wiring layer (window, IPC, native dialogs, native menus,
  shell.openPath) on top of those cores.
- No TypeScript, no React, no bundler for this core. Deliberate: every extra build
  step is a failure mode on a machine that cannot yet verify a Windows build.
  React/TypeScript can be adopted later for Sheets/Slides if nimu wants them;
  they buy nothing for File Manager + text Editor + Settings today.
- Provisional app identity (not user-approved, changeable in one place):
  appId `com.nimu.omsuite`, product name `OmSuite`, version `0.1.0`.
  This follows nimu's existing naming pattern for his own apps; it is not a
  claim that nimu chose this identifier.

## Why this satisfies "genuine desktop app, not a website in a browser"

- It runs as its own desktop window with its own icon, taskbar entry, and menu
  bar; closing the window quits the app. There is no browser tab, no URL bar,
  no hosted page, and no server.
- Filesystem access is real Node `fs` through the main process, not browser
  File System Access prompts: browse any local folder, native Open/Save dialogs,
  drag files in from the OS, open a file in its OS default app.
- Native behaviours implemented in this build: application/menu keyboard
  shortcuts, right-click context menus (Electron Menu), multi-select
  (Ctrl/Shift-click, Ctrl+A), resizable sidebar (drag splitter, width persisted),
  resizable window (Electron BrowserWindow, min size enforced).

## Alternatives considered — honestly

### Tauri 2 + React/TypeScript/Rust — REJECTED for this build, kept as migration candidate
- For: smallest installer (roughly an order of magnitude smaller than Electron),
  Rust core, WebView2 on Windows (no bundled Chromium), strong security model,
  MIT/Apache-2.0 licensing, offline, NSIS/WiX installers.
- Against, in THIS environment: Rust absent (see above); Linux system WebKit deps
  needed for a Linux build; Windows target needs MSVC + WebView2 + a Windows
  machine/CI runner — none available here, so a Tauri choice would have shipped
  an unverified skeleton and a packaging story that cannot be demonstrated.
  Tauri also adds a second language (Rust) and a bundler (React) to maintain.
- Verdict: the right long-term candidate IF nimu later prioritises installer size
  and has a Windows + Rust build machine. It is not the right choice for a core
  that must be demonstrably working now. Revisit only with a Windows build
  machine in hand; do not migrate on size speculation.

### Python + PySide6/Qt — REJECTED for this build, credible alternative
- For: true native widgets, excellent dialogs/menus/shortcuts, PyInstaller single
  exe, offline. Note: nimu's own Windows PC already has PySide6 (per project
  memory), so this path would be comfortable for him personally.
- Against, in THIS environment: PySide6 absent from the VM, so GUI work here
  would also be unverified; Qt's LGPL terms need care in distribution
  (dynamic linking, licence notices); rich Markdown/Sheets/Slides editors are
  harder in Qt Widgets than in web tech, which matters for OmSuite's later
  modules; and a second, Python-only codebase shares nothing with the Android
  (Kotlin) or shared-engine work.
- Verdict: revisit if Electron's size/memory becomes a blocker for nimu.

### Python + tkinter (stdlib) — REJECTED
- For: present (8.6), zero installs, offline, real filesystem access.
- Against: dated widgets, weak rich-text editing, poor premium-UI prospects,
  no credible path to Sheets/Slides/PDF/Media. Fidelity fails the brief.

### Flutter (Windows desktop) / .NET WPF / WinUI — REJECTED
- For (in principle): native-feeling Windows apps, good packaging.
- Against: Dart/Flutter SDK, .NET SDK, and Java are all absent here and cannot
  be verified in this VM (Java is separately known to be platform-blocked in
  this VM). Choosing any of them would mean shipping code that was never run.

### Neutralinojs / plain WebView2 wrapper — REJECTED
- For: tiny, like Tauri without Rust.
- Against: weaker filesystem/dialog/menu APIs than Electron, smaller ecosystem,
  and still Windows-only verification problems. No advantage over Electron
  for this core that outweighs the API gap.

## Fidelity, maintenance, licensing, offline, packaging

- Fidelity: Electron matches every behaviour in the brief for this core
  (native dialogs, menus, shortcuts, drag-and-drop, multi-select, resizable
  panels). What it does NOT match is installer size and idle memory — Electron
  bundles Chromium + Node, so expect a large installer (tens to low-hundreds of
  MB). Exact Windows installer size is NOT claimed here: no Windows installer
  was produced on this VM (see STATUS.md), so any size number would be invented.
- Maintenance: one language (JavaScript) across shell, core, and renderer;
  zero runtime npm dependencies besides Electron itself; no build step for the
  app itself (`npm start` runs the source directly). Electron major upgrades
  are the main ongoing cost (Chromium security updates ride along).
- Licensing: Electron is MIT; Node.js is MIT. The OmSuite application code
  itself has NO licence file in this tree — deliberately, per the project rule:
  no licence is invented and no LICENSE file is added until nimu selects one.
  Third-party notices for Electron/Node belong in the packaged app's notices
  (see README.md). Nothing in this build phones home, so there is no telemetry
  licence/privacy conflict to disclose beyond the in-app privacy statement.
- Offline operation: the built app makes zero network requests. The only
  network use in the whole workflow is at BUILD time on the developer machine
  (`npm install` downloads Electron once). Runtime: fully offline.
- Packaging: electron-builder NSIS installer, built on a Windows machine or a
  Windows CI runner (see `scripts/build-windows.ps1` and `electron-builder.yml`).
  This Linux VM CANNOT produce the Windows installer: Wine is absent and NSIS
  packaging for Windows from Linux requires it (plus Windows code-signing
  tooling for a signed build). The scripts, config, and instructions are
  provided and the limitation is stated in STATUS.md and README.md rather
  than faked. A Linux smoke launch (Xvfb) verifies the app starts; it does
  NOT verify the Windows installer, Windows dialogs, or Windows paths — those
  are marked Not Tested / Not verified.

## What this decision does NOT claim

- No claim that the Windows installer exists, is signed, or has a measured size.
- No claim that Windows-specific behaviour (native dialogs on Windows, drive
  letters, `%APPDATA%` paths, SmartScreen behaviour) has been verified — all
  marked Not Tested until run on a real Windows machine.
- No claim that Tauri/PySide6 are "worse" in general — only that, given what
  can be verified here today, Electron is the stack whose core can actually
  be executed and tested in this environment.
