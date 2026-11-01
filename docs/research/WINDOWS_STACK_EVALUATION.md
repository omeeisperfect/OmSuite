# Research Note — Windows Stack Evaluation (31 Oct 2026)

> **This note is an evaluation, NOT the Windows decision.** The final Windows decision
> is owned by stream 3 and must be recorded in `apps/windows/DECISION.md`.
> No Windows code, installer, or "Windows uses X" claim may cite this note as its
> authority. (DECISION_LOG.md D-02.)
>
> Requirement (Master Instructions §§5.2, 6): evaluate Tauri 2 + React/TypeScript/Rust
> and alternatives before committing. The Windows app must be a genuine desktop app
> (not a website opened in a browser), with native file dialogs, drag-and-drop,
> keyboard shortcuts, right-click menus, multi-selection, resizable windows,
> background work off the UI thread, and an installer with honest signing status.

## Candidates

### A. Tauri 2 + React + TypeScript + Rust — leading candidate

- **What it is:** Rust backend + system-WebView frontend (WebView2 on Windows).
  Tauri 2.0 stable since Oct 2024; 2.11.x line seen Jun 2026. Licence MIT OR Apache-2.0.
- **For OmSuite:** smallest installer (no bundled Chromium — sources cite 2–10 MB class
  for Tauri apps vs bundled-Chromium shells); Rust backend does real native file I/O
  through typed commands; plugin system for filesystem/dialog/shell capabilities;
  NSIS `.exe` / WiX `.msi` bundling built in.
- **Against / risks:** WebView2 Evergreen runtime becomes a prerequisite on the target
  PC (installer must embed the bootstrapper or document the requirement); the
  frontend/backend bridge must stay thin and typed or it becomes a second app to
  maintain; **the shell solves no document-engine problem** — DOCX/XLSX/PDF/OCR engines
  still need separate Rust/native/JVM choices behind the Rust backend, and those
  choices (not Tauri) determine format fidelity.
- **Offline check:** passes — a Tauri app runs locally; the WebView is a renderer, not
  a browser tab, and no runtime network is required. The "not a website" test is: does
  it work with networking disabled after install, with real local file I/O? That test
  must be run by stream 3, not assumed here.

### B. Electron + TypeScript — most battle-tested, heaviest

- **What it is:** bundled Chromium + Node runtime. Licence MIT. Powers VS Code, Discord,
  Slack, Figma-class apps. Electron 43-class releases seen mid-2026.
- **For:** largest ecosystem, most examples, mature auto-update/packaging.
- **Against:** largest installer and memory footprint (bundled Chromium per app);
  still needs native engines for documents/PDF/OCR — the shell alone solves nothing;
  Node-side file I/O must be kept out of the renderer for security (context isolation).
- **Verdict:** viable fallback if Tauri's WebView2 prerequisite or engine-bridging
  proves problematic; not the default on size grounds alone, since the Master
  Instructions do not set a size target — size is a tiebreaker, not the requirement.

### C. .NET WPF / WinUI 3 + C# — most native-feeling

- **What it is:** first-party Windows UI frameworks; best native dialogs, drag-and-drop,
  and accessibility integration by construction.
- **For:** no WebView question at all; document engines from the .NET ecosystem
  (PDFium wrappers, commercial or open .NET Office libraries) are a coherent story.
- **Against:** splits the engine ecosystem from Android's JVM choices (adapters must
  bridge more distance); WinUI 3 packaging/Store constraints and Windows-version
  support need verification; WPF is mature but not the current forward direction,
  WinUI 3 is current but has its own packaging learning curve.
- **Verdict:** strongest "feels like Windows" option; the evaluation cost is verifying
  packaging + engine availability, not UI capability.

### D. Flutter (desktop) — one Dart codebase in theory

- **What it is:** Dart + Skia renderer, BSD-licensed; desktop targets exist alongside
  mobile.
- **For:** a single language across Android + Windows is superficially attractive.
- **Against:** for this format-heavy suite, desktop maturity and document-engine
  availability on Windows are weaker than A–C; risks delivering the prohibited outcome
  (one UI stretched across platforms) unless the Windows UI is deliberately built
  desktop-grade; PDF/Office engine bindings for Dart are thinner than JVM/.NET/Rust.
- **Verdict:** not recommended as the Windows default for this product. The shared-code
  argument for Flutter is explicitly rejected by the architecture's shared-code boundary
  (DECISION_LOG.md D-03): sharing UI is not a goal.

### E. Pure Rust UI (egui / iced) — smallest binary, highest editor risk

- **What it is:** Rust-native immediate-mode/retained UI toolkits, no WebView.
- **For:** no WebView prerequisite, tiny binary, memory safety throughout.
- **Against:** editor-grade UI (rich-text editing, spreadsheet grid, PDF annotation
  canvas, slide canvas) would be largely hand-built; the ecosystem for these widgets
  is far behind React/.NET/Compose. Implementation risk dominates any size benefit.
- **Verdict:** not recommended for a 12-module suite in this phase.

## Comparison summary

| Criterion | Tauri 2 | Electron | .NET WPF/WinUI 3 | Flutter desktop | Pure Rust UI |
|---|---|---|---|---|---|
| Genuine desktop app (offline, local I/O) | Yes, if tested | Yes | Yes | Yes | Yes |
| Installer size class | Small (system WebView) | Large (bundled Chromium) | Medium (runtime-dependent) | Medium | Small |
| WebView2/runtime prerequisite | Yes (WebView2) | No (bundled) | .NET/WinUI runtime | Flutter engine bundled | None |
| Native dialogs / drag-drop / shortcuts | Via Rust backend + plugins | Via Electron APIs | Native (best) | Via plugins | Hand-built |
| Document-engine ecosystem | Rust/native/JVM-bridge (to choose) | Node/native (to choose) | .NET (coherent) | Dart (thinnest) | Rust crates (thinnest for editors) |
| Licence | MIT OR Apache-2.0 | MIT | MIT family (verify per component) | BSD | Varies (verify) |
| Editor-UI maturity | High (React) | High | High | Medium | Low |
| Risk for this product | Bridge thinness; engine choices still open | Size; same engine gap | Packaging verification; ecosystem split from Android | Engine availability; stretched-UI risk | Hand-building editors |

## Recommendation to stream 3 (not a decision)

Start the decision trial with **Tauri 2** (it best matches the Master Instructions'
own leading candidate and the size/offline profile), but make the decision on a
**trial, not on this table**: build the smallest end-to-end slice (File Manager list +
open a TXT file + save it + installer that runs offline with networking disabled) in
the candidate stack, and only then record the decision. If that slice exposes a
WebView2-deployment or engine-bridging problem that .NET avoids, the decision should
follow the evidence, and this note should be superseded by a new entry saying why.

## Questions stream 3 must answer in its DECISION.md

1. Which stack, and what did the trial slice prove (commands run, result)?
2. WebView2/runtime prerequisite handling in the installer (if applicable).
3. SQLite binding + PDF/document/OCR engine choices for Windows (or "to be decided in
   Phase 4" with dates).
4. Supported Windows versions + installer format + signing status (honest: unsigned
   must be stated as unsigned).
5. How the Windows UI stays desktop-grade (not a stretched Android layout).
