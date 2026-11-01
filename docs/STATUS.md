# Stream 1 — Architecture + Research: Status (31 Oct 2026)

> Stream 1 owns `docs/` (architecture/research docs) only. This stream did **not** edit
> `apps/`, `shared/`, `scripts/`, or `.github/`, and did not spawn subagents.
> This status file is this stream's evidence summary. It is not the project's
> `FINAL_STATUS.md` (that belongs to stream 5 at handover) and it is not
> `IMPLEMENTATION_STATUS.md` (also stream 5's).

## Files created (all under `~/workspace/omsuite/docs/`)

| File | Contents |
|---|---|
| `docs/ARCHITECTURE.md` | System + per-platform architecture, 12-module boundaries, file-operation lifecycle/data-flow (§4), database schema + migration plan (§6), processing-engine abstraction interfaces (§5.1–§5.10), security invariants (§7), build/packaging summary (§8) |
| `docs/DECISION_LOG.md` | 14 decisions (D-01–D-14) with date, context, alternatives, rationale, consequences; plus an explicit "not decided here" table (Windows stack → stream 3, exact versions → integration streams, project licence → user, repo/push → stream 5, signing → user) |
| `docs/FORMAT_SUPPORT.md` | Per-format, per-platform Open/Create/Edit/Convert matrix for 37 formats (296 cells) with evidence/limitation notes and promotion rules |
| `docs/MASTER_PLAN.md` | Scope (12 modules, out-of-scope list, realistic-scope rule), repo layout + stream boundaries, Phases 0–8 with status, phase/stream dependencies, quality gates, §17 handover contents, blockers B-1–B-4, Phase 0 source record, deferred testing list |
| `docs/DEPENDENCIES_AND_LICENSES.md` | Draft candidate inventory (platform, document, PDF, archive, e-book/OCR/media, text, build tooling) with version snapshots, licence, platform, obligations; prominent "PROJECT LICENCE: NOT YET SELECTED" warning; 9 outstanding licence verifications |
| `docs/research/ENGINE_RESEARCH.md` | Engine research: PDFium, Apache POI, Commons Compress + UnRAR, Tesseract/Tesseract4Android vs ML Kit, EPUB/MOBI/AZW; honest gaps section |
| `docs/research/WINDOWS_STACK_EVALUATION.md` | Windows candidate comparison (Tauri 2, Electron, .NET WPF/WinUI 3, Flutter desktop, pure Rust UI) + trial-based recommendation to stream 3 + 5 questions stream 3 must answer. Evaluation only — NOT the decision |
| `docs/research/PROTOTYPE_INSPECTION.md` | Phase 0 inspection record for both HTML prototypes + the prototypes ZIP: what is real (visual direction) vs what is not (dead buttons, hardcoded sample data, CDN dependency) |

No other files were created or modified by this stream. In particular:

- **No `LICENSE` file was created.** Project licence status remains NOT YET SELECTED.
- **No token, password, keystore, or secret** was asked for, stored, or recorded anywhere.
- **No application code** was written; `apps/`, `shared/`, `scripts/`, `.github/` untouched.

## Key decisions (summary — full text in DECISION_LOG.md)

1. **Android: Kotlin + Jetpack Compose direction** (D-01) — from the Master Instructions'
   preferred direction, confirmed by research.
2. **Windows stack: evaluation done, decision left to stream 3** (D-02) — Tauri 2 is the
   leading candidate on the evidence, but stream 3 must decide on a trial slice and
   record it in `apps/windows/DECISION.md`.
3. **Shared-code boundary** (D-03): share semantics/interfaces/contracts, not storage
   adapters or UI. Engine replacement touches the adapter only.
4. **Local storage** (D-04/D-05): Room/SQLite on Android (metadata only, no destructive
   migration); SAF for user files on Android (persistable URI permissions), native
   filesystem on Windows.
5. **PDF direction** (D-06): PDFium (BSD-3-Clause) for rendering/parsing + a separate
   manipulation layer to be verified; PDF text editing of original content is distinct
   and Not verified.
6. **Office engines direction** (D-07): Apache POI (Apache-2.0) family first on Android;
   LibreOffice embedding explicitly not assumed feasible; Windows engines follow its stack.
7. **Archives** (D-08): Commons Compress for ZIP/7Z/TAR; RAR extract-only, creation
   Not supported by licence design.
8. **OCR direction** (D-09): on-device Tesseract (Apache-2.0) via Tesseract4Android;
   ML Kit not the default (proprietary terms + metrics question vs no-telemetry rule);
   tess-two rejected (unmaintained); cloud OCR prohibited.
9. **Project licence NOT YET SELECTED** (D-10) — binding; awaiting the user's choice.
10. **E-books** (D-11): EPUB first; MOBI/AZW separate, Not verified; no DRM bypass.
11. **Converter honesty gate** (D-12): per-platform registry; unimplemented conversions
    do not appear in the UI at all (no greyed-out placeholders).
12. **No cloud / no account / no telemetry** (D-13) as an architecture-level exclusion.
13. **Prototypes are visual reference only** (D-14): never shipped, never cited as modules.

## Format-matrix coverage counts (FORMAT_SUPPORT.md)

| Measure | Count |
|---|---|
| Formats evaluated | 37 |
| Cells (37 formats × 8: Android Open/Create/Edit/Convert + Windows Open/Create/Edit/Convert) | 296 |
| Supported | 0 |
| Partial | 0 |
| Not supported | 2 — RAR Create (Android) and RAR Create (Windows), on UnRAR licence grounds |
| Not verified | 294 |

Every other cell is Not verified by design: this stream ran no format tests and wrote
no app code, and the task forbids advertising a capability from extension recognition
alone. Cells move to Partial/Supported only on executed-test evidence, per the
promotion rules in FORMAT_SUPPORT.md.

## Commands run and evidence

| Action | Result |
|---|---|
| Read Master Development Instructions PDF | Full text extracted and used as the authority for scope, phases, gates, §17, Appendices A–C |
| Read UI/UX Design Brief PDF | Full text extracted; platform UX + information architecture + §18 matrix requirement used |
| Read coordinator plan (`COORDINATOR_PLAN.md`) | Stream boundaries, scope rule, known blockers (local Gradle blocked, prior GitHub 403) adopted |
| Inspected both HTML prototypes + ZIP listing | Confirmed: Windows 5-item sidebar + 3 cards + dark/light/green themes; Android 2 hardcoded recent rows + Home/Files/Settings nav; dead buttons; CDN dependency. Recorded in `research/PROTOTYPE_INSPECTION.md` |
| Web research 31 Oct 2026 (7 searches) | Confirmed: PDFium BSD-3-Clause + renderer-not-authoring role; POI Apache-2.0 + 5.5.1 + component split + file-model-not-renderer limit; Commons Compress Apache-2.0 + 7Z/TAR limits; UnRAR freeware licence + RAR-create prohibition + 7-Zip LGPL+unRAR restriction; Tesseract Apache-2.0 + Tesseract4Android maintained vs tess-two unmaintained + ML Kit metrics note; Tauri MIT/Apache-2.0 + WebView2; AndroidX Room/Compose Apache-2.0 |
| Wrote 9 files under `docs/` | Listed above; see file listing in the verification step below |

## Tests executed

**None.** This stream is architecture + research: it wrote documents, not code. There is
nothing to unit-test, and no test is claimed. Specifically Not Tested:

- No Android or Windows build (no app code exists in this stream).
- No format open/create/edit/convert test for any of the 37 formats.
- No engine integration test (POI, PDFium, Commons Compress, Tesseract, or any other).
- No SAF, Room migration, archive-safety, OCR-accuracy, or performance test.
- No device or Windows-version testing.

Any future claim that a capability "works" must cite the stream and test that actually
ran it. A compile success, a menu screenshot, or this architecture document is not such
evidence (Master §13, §16).

## What remains Not verified (for implementation streams)

1. **Everything in the format matrix except RAR creation** (294/296 cells) — pending
   engine integration + real-sample tests (Phase 4/5/7).
2. **Windows stack** — pending stream 3's trial + decision record.
3. **Exact dependency versions** — research snapshots only; pins happen at integration
   with lockfile + licence re-check.
4. **Engine capabilities beyond existence** — e.g. POI fidelity for tracked changes /
   charts / pivots / macros; PDFium + manipulation-layer annotation/form coverage;
   Commons Compress 7Z method coverage; Tesseract language coverage + model licences;
   EPUB parser licence (epublib) + maintenance status.
5. **Platform behaviours** — SAF revoke/restart flows, Room migration on upgrade,
   Windows path/symlink handling, archive-bomb guards, low-storage pre-flights, OCR
   accuracy, large-file streaming — all specified in ARCHITECTURE.md, none tested.
6. **Deferred comprehensive testing** (MASTER_PLAN.md §8) — the full Master §13 list,
   explicitly for the post-handover testing phase.
7. **User decisions outstanding** — project licence (B-1), GitHub write permission if
   the 403 recurs (B-2), release signing key handling (B-3). See MASTER_PLAN.md §6.

## Limitations of this stream's work

- Architecture and interfaces are **design contracts**, not verified implementations.
  An implementation stream may find a contract unworkable (e.g. a chosen engine cannot
  meet an interface); in that case it must record a superseding decision entry, not
  silently diverge.
- Web research relied partly on secondary summaries for some facts; where the primary
  source was not directly confirmed, the dependency inventory says "to verify" rather
  than asserting. The RAR-create prohibition and the core engine licences (PDFium,
  POI, Commons Compress, Tesseract, Tauri) were corroborated across multiple sources.
- ASCII diagrams were used deliberately (they render anywhere); rendered diagrams, if
  later produced, must depict this same architecture or record a deviation decision.
- This stream did not check whether an OmSuite GitHub repo already exists (stream 5's
  job, via the secure connector) and did not attempt any push.
