# OmSuite — Master Plan

> **Status:** Stream 1 (architecture + research) deliverable, 31 Oct 2026.
> Scope, milestones, dependencies, and completion criteria for the whole OmSuite build.
> Phase status below reflects **this stream's work only** plus the coordinator's standing
> plan; implementation streams own their phase evidence in their own `STATUS.md` files.
>
> **Product:** OmSuite — "Everything. One Workspace." Personal, local-first productivity
> suite. **Android + Windows only.** No Web/PWA, no cloud storage/sync/backup/
> collaboration, no mandatory account/login/subscription, no telemetry/silent upload.
> Core works offline.
>
> **Project licence: NOT YET SELECTED.** No `LICENSE` file exists. See §6.

## 1. Scope

### 1.1 In scope (12 modules)

| # | Module | Headline requirement (one line; full spec in Master Instructions §3) |
|---|--------|-----------------------------------------------------------------------|
| 1 | File Manager (central) | Real local files only — browse, search, sort, favourites, recents, create/rename/copy/move/duplicate/delete, multi-select, properties, preview, progress/cancel/conflicts. Never hardcoded sample data as a filesystem. |
| 2 | Writer | Create/open/edit/save/Save As documents; formatting, styles, lists, tables, images, links; find/replace, undo/redo, outline, autosave/recovery. |
| 3 | Sheets | Grid, formula bar, multiple sheets, formats, sort/filter, freeze panes; **real formula engine**, not a fake demo. |
| 4 | Slides | Slide list/canvas, layouts, themes, text boxes, images, shapes, notes, presentation mode. |
| 5 | PDF Studio | View/search/zoom/rotate; annotations, forms; page ops; merge/split. Annotation ≠ editing original PDF text. |
| 6 | Media | Image preview/basic adjust; audio playback/queue; video playback/subtitles. No advanced editing unless real tools exist. |
| 7 | E-books | EPUB reader (TOC, bookmarks, progress, search, themes); MOBI/AZW only with a reliable parser. No DRM bypass. |
| 8 | Archives | Browse before extract; extract all/selected; create ZIP; progress/conflicts. RAR create is Not supported (licence). |
| 9 | Code / Text Editor | TXT/MD/JSON/XML/YAML/HTML editing; highlighting, find/replace, JSON validate/format, Markdown preview; encoding/line-ending care. |
| 10 | Converter | Only genuinely implemented, verified conversions shown; loss warnings; source unchanged by default; local history, clearable. |
| 11 | Scan & OCR | Camera capture/import, crop/rotate/reorder, **on-device OCR only**, review/correct, searchable PDF / text export. |
| 12 | Settings + Local Data & Recovery | Light/dark/system theme; defaults; cache/storage; autosave/recovery; recents management; clear privacy notice (no cloud, no account). |

### 1.2 Out of scope (this phase — not "later, quietly")

- Web application, PWA, browser edition, or any website-as-the-app delivery.
- Cloud storage, sync, backup, collaboration, or any runtime network dependency.
- Mandatory account, login, online authentication, subscription, or paywall.
- Telemetry, analytics, usage upload, or crash upload (any future proposal is a new
  user decision, not an implementation detail).
- Cross-device sync between the Android and Windows installations.
- Fingerprint/DRM circumvention, macro/script execution in documents, or executing
  embedded active content in previews.
- Commercial engine licences or purchases (e.g. commercial PDF/Office SDKs) without a
  separate user-approved decision.

### 1.3 Realistic scope rule (coordinator plan, binding)

If the full 12-module scope cannot genuinely be completed, deliver the **largest
honestly-working subset**. Unimplemented modules must **not** appear as working features
in the apps; they go in `KNOWN_LIMITATIONS.md` / `IMPLEMENTATION_STATUS.md` as
Not implemented. Do not pad with fake features. A menu label is not a module.

## 2. Repository layout (target — adapts to real build boundaries)

Per Master Instructions Appendix A, adapted by the rule "do not create artificial module
folders if the architecture does not support them":

```
OmSuite/
  apps/
    android/          # Stream 2 — Kotlin + Jetpack Compose, SAF, Room
    windows/          # Stream 3 — stack per apps/windows/DECISION.md
  shared/             # Stream 4 — contracts + genuinely shared, tested logic only
    file-core/ document-core/ pdf-core/ archive-core/ media-core/  (only as built)
  modules/            # Only where a module is genuinely shared code, not a placeholder
  docs/               # This stream (App. B architecture/research docs) + stream 5 docs
  scripts/            # Stream 5 — packaging / CI helpers
  tests/              # Stream 4 — executed-test evidence
  .github/workflows/  # Stream 5 — CI (the Android build route in this environment)
  README.md  MASTER_PLAN.md  ARCHITECTURE.md  DECISION_LOG.md
  ... (Appendix B docs; see §5)
```

Stream boundaries (no cross-editing another stream's directories):

| Stream | Owns |
|---|---|
| 1 — architecture + research (this stream) | `docs/` (ARCHITECTURE, DECISION_LOG, FORMAT_SUPPORT, MASTER_PLAN, DEPENDENCIES_AND_LICENSES, STATUS + `docs/research/`) |
| 2 — android-foundation | `apps/android/` |
| 3 — windows-foundation | `apps/windows/` (+ its own `DECISION.md`) |
| 4 — shared-engines | `shared/` + `tests/` |
| 5 — docs-ci-packaging | `docs/` Appendix-B docs it owns (README, BUILD_STATUS, KNOWN_LIMITATIONS, FINAL_STATUS, SECURITY, IMPLEMENTATION_STATUS, BLOCKERS), `.github/workflows/`, `scripts/` |

## 3. Milestones and phases (Master §12)

| Phase | Name | Exit criterion (evidence, not assertion) | Status at 31 Oct 2026 |
|---|---|---|---|
| 0 | Inspect and preserve | Source PDFs + prototypes inspected; paths recorded; visual assets separated from real source | **Done (this stream)** — see `docs/research/PROTOTYPE_INSPECTION.md`; source paths in §7 |
| 1 | Architecture and research | Architecture, module boundaries, DB schema, engine interfaces, format matrix, decision log exist | **Done (this stream, as documents)** — this file set. Engine *integration* is Phase 4, not Phase 1 |
| 2 | Repository and foundations | Public repo verified/created (no duplicates); branches, README, .gitignore, secret protection; Android + Windows shells; reproducible build commands | **Not started** (stream 5; repo-existence check via secure connector only) |
| 3 | File manager + local infrastructure | Real local file ops on both platforms; progress/cancel/conflicts/permissions; recents/favourites/recovery foundations | **Not started** (streams 2/3/4) |
| 4 | Processing engines | Document/spreadsheet/presentation/PDF/image/archive/EPUB/OCR engines integrated behind adapters; smoke examples compiled | **Not started** |
| 5 | Product modules | All 12 modules connected to real processing + persistence; save/Save As/export/recovery/error states; unsupported ops marked honestly | **Not started** |
| 6 | Platform integration + design | Approved designs integrated per platform; native behaviours + accessibility states; dead/placeholder controls removed | **Not started** |
| 7 | Internal build verification | Compilation, dependency resolution, static analysis, type checks; both release configs built; basic launch verified where the environment allows; unperformed tests listed | **Not started** |
| 8 | Release packaging + handover | Release APK + Windows installer; source archives + docs; public GitHub publish + tags; checksums + release notes; final delivery ZIP + honest completion report | **Not started** |

**Phase status vocabulary** (Master §15): Complete / Partially complete / Not implemented /
Not verified / Blocked. A phase is Complete only when its evidence exists; a document
existing is evidence for Phase 1, not for Phases 3–8.

## 4. Dependencies between phases and streams

```
Phase 0/1 (this stream, done as docs)
   ├─► Phase 2 (repo + shells) ──► Phase 3 (file manager) ──► Phase 5 (modules)
   │        │                          ▲                            ▲
   │        └─► Phase 4 (engines) ─────┘ (adapters land before modules use them)
   │                                              │
   └─► Windows stack decision (stream 3) ─────────┘ (blocks Windows Phase 3/4 engine
                                                       choices, not Android work)
Phase 5 ──► Phase 6 (design integration) ──► Phase 7 (build verification)
   ──► Phase 8 (packaging + handover, incl. §17 final report)
```

- Independent workstreams proceed in parallel when safe (Master §12); a blocked feature
  must not stall unrelated modules.
- The Windows stack decision (D-02) blocks Windows engine selection, not Android work
  and not shared-contract work.
- The project-licence decision (§6) blocks only the `LICENSE` file and any licence
  claim — it does **not** block engineering, and it does **not** block recording
  third-party licences.
- GitHub push permission (see §6) blocks only the push step; all local work continues.

## 5. Completion criteria and quality gates (Master §§16–17, App. C)

A quality gate passes only when its evidence exists. The gates:

| Gate | Required evidence |
|---|---|
| Architecture | Architecture diagrams, decisions, platform boundaries, module contracts exist → **met by this stream's docs** (diagrams are ASCII in ARCHITECTURE.md) |
| Repository | Public repo exists; clean-clone instructions; no secrets or personal data |
| Android foundation | Native Android project builds; storage permission model documented |
| Windows foundation | Desktop project builds; native file access + packaging strategy documented |
| File manager | Real local file operations; no hardcoded fake filesystem |
| Editors | Actual engine integration + save/export paths; limitations recorded |
| Offline / privacy | No runtime cloud dependency, account requirement, or hidden transmission |
| Data safety | Conflict handling, safe writes, recovery, archive safeguards designed/implemented |
| Builds | Release APK + Windows installer/package generated |
| Handover | Source, docs, dependencies, limitations, unperformed tests delivered |

**Final handover report (§17) must contain:** repo URL + branch + commit + tag; APK
(filename, size, version, package ID, min Android version, build status); Windows
installer (filename, size, version, architecture, supported Windows versions); source
locations + ZIPs; clean-environment build instructions; module-by-module status;
format matrix + limitations; dependencies + licence obligations; signing status +
key-handling instructions; security precautions + checks not performed; tests actually
executed + results; deferred comprehensive tests; known bugs/limitations/blockers +
required user actions. **If a module is unfinished, the report says so. If a format is
preview-only, the report says so. If a test was not run, the report says so.**

## 6. Blockers and decisions awaiting the user (31 Oct 2026)

| # | Item | Needed from | Blocks | Workaround meanwhile |
|---|---|---|---|---|
| B-1 | **Project licence choice** (MIT / Apache-2.0 / GPL-family / other) | nimu | Only the `LICENSE` file + any reuse claim | All engineering + third-party notices continue; status stays "not yet selected" |
| B-2 | **GitHub write permission** (if the push attempt hits the same 403 seen for another repo — "Resource not accessible by integration") | GitHub-side permission check (Contents write) by nimu | Only the push step | All local work continues; record exact error; never ask for a token in chat |
| B-3 | **Release signing key** creation/safekeeping (if a release APK is produced) | nimu, via secure handling | Release signing only | Debug builds labelled debug; never silently substitute a debug key for release |
| B-4 | **Final Windows stack** | Stream 3 (engineering decision, not user) | Windows Phase 3/4 engine choices | Android + shared work proceed; evaluation in `docs/research/` |

**Environment blocker (known, do not re-prove from scratch):** local Gradle is
platform-blocked in this VM (Java loopback times out, `/etc/ssl/certs/java/cacerts`
missing; `java` is currently not even installed). GitHub Actions CI is the only
Android build/test route. This affects streams 2/4/5, not this stream's documents.

**Secrets rule (binding, all streams):** never ask for, paste, store, or record any
token, password, keystore, or secret in chat, files, or memory. GitHub only via the
secure connector route. Never commit a keystore, signing key, secret, or personal data
to any repo or ZIP.

## 7. Source material inspected (Phase 0 record)

| Source | Path / identity | What was taken from it |
|---|---|---|
| Master Development Instructions (31 Oct 2026) | `~/workspace/user/files/OmSuite_Master_Development_Instructions.pdf` | Phases 0–8, quality gates, §17 handover, Appendices A–C; product constraints; module specs §§3.1–3.12; format list §4 |
| Complete UI/UX Design Brief (31 Oct 2026) | `~/workspace/user/files/OmSuite_Complete_UI_UX_Design_Brief_Android_Windows.pdf` | Platform UX, information architecture (12 modules), design system direction, format matrix requirement §18 |
| Windows prototype (visual reference only) | `~/workspace/omsuite/prototypes/index.html` | 5-item sidebar, 3 cards, dark/light/green themes, emerald accent — visual direction only; dead buttons; see prototype inspection note |
| Android prototype (visual reference only) | `~/workspace/omsuite/prototypes/android_app.html` | 2 hardcoded recent-file rows, Home/Files/Settings nav — visual direction only; dead buttons; sample data never to be shipped as real files |
| Coordinator plan (31 Oct 2026) | `~/workspace/omsuite/COORDINATOR_PLAN.md` | Stream boundaries, realistic-scope rule, known environment blockers, secrets/licence rules |

No other source material was relied on. Engine licence/version statements in
`DEPENDENCIES_AND_LICENSES.md` and `research/ENGINE_RESEARCH.md` were web-checked
31 Oct 2026; where confirmation was unavailable the entry says "to verify".

## 8. Deferred comprehensive testing (Master §13 — explicitly not done yet)

Full functional testing of every module and file operation; large-file/long-duration
performance testing; cross-version Android device testing; Windows version/hardware
matrix; round-trip fidelity across real DOCX/XLSX/PPTX/PDF samples; OCR accuracy across
languages/image quality; archive security + malicious-file corpus; crash recovery,
power interruption, low-storage scenarios; accessibility + usability acceptance;
security review + dependency vulnerability audit. **None of these has been executed by
this stream.** Basic engineering verification (compile, dependency resolution, static
analysis, smoke launch) is mandatory during Phases 4/7 for implementation streams and
must be recorded with actual results when it happens.
