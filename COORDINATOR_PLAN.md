# OmSuite — Coordinator Plan (31 Oct 2026)

User authorization: full autonomous work, ASAP, multiple agents, contact nimu ONLY when complete or terminally blocked. No interim progress messages from main chat.

## Workspace
- All work under `~/workspace/omsuite/` (source, docs, build logs).
- Prototypes (visual reference ONLY, dead buttons, hardcoded sample data — never ship as the app): `~/workspace/omsuite/prototypes/index.html` (Windows), `~/workspace/omsuite/prototypes/android_app.html` (Android).
- Source docs: `~/workspace/user/files/OmSuite_Master_Development_Instructions.pdf`, `~/workspace/user/files/OmSuite_Complete_UI_UX_Design_Brief_Android_Windows.pdf`.

## Product constraints (non-negotiable)
- OmSuite, "Everything. One Workspace.", personal local-first suite, Android + Windows ONLY. No Web/PWA, no cloud storage/sync/backup/collaboration, no mandatory account/login/subscription, no telemetry/silent upload. Core works offline.
- 12 modules in scope: File Manager (real local files only, never hardcoded sample data as a real filesystem), Writer, Sheets (real formula engine), Slides, PDF Studio, Media, E-books, Archives, Code/Text Editor, Converter (only genuinely implemented conversions), Scan & OCR (on-device only), Settings + recovery.
- Honesty: menu/button/mockup ≠ implemented module. Every module labelled Complete / Partially complete / Not implemented / Not verified. Never claim a test passed unless actually executed; anything not run = "Not Tested". Compile ≠ proof of editing/conversion fidelity.
- License: NEVER invent a project license, NEVER add a LICENSE file claiming reuse permission. Status stays "not yet selected" until nimu chooses. Third-party notices still required.
- Secrets: NEVER ask for, paste, store, or record any token/password/keystore in chat, files, or memory. GitHub only via the secure connector route (`/opt/hatch/bin/github`). NEVER commit a keystore, signing key, secret, or personal data to any repo or ZIP. Debug APK, if produced, must be labelled debug — never silently substitute a debug key for release.
- GitHub: check whether an OmSuite repo already exists BEFORE creating one; no duplicates. Repo name OmSuite, public, if created.

## Known environment blockers (do not re-prove from scratch)
- Local Gradle is platform-blocked in this VM (Java loopback times out, /etc/ssl/certs/java/cacerts missing; `java` is currently not even installed). GitHub Actions CI is the only Android build/test route.
- Prior GitHub App pushes for a different repo (omnexa-launcher) failed 403 "Resource not accessible by integration" on git/trees POST despite reads working — Contents WRITE may be missing. If an OmSuite push hits the same 403: STOP pushing, record exact error + the one GitHub-side permission to check, continue all local work, report as blocked. Do NOT ask the user for a token in chat.

## Streams (parallel, no cross-editing of another stream's directories)
1. architecture+research → `~/workspace/omsuite/docs/` (ARCHITECTURE.md, DECISION_LOG.md, FORMAT_SUPPORT.md draft, MASTER_PLAN.md, DEPENDENCIES_AND_LICENSES.md draft, research notes)
2. android-foundation → `~/workspace/omsuite/apps/android/` (Kotlin + Jetpack Compose, SAF, Room/SQLite, real file operations; smallest end-to-end core first: File Manager + text Writer/Code Editor + Settings, then expand only if genuinely working)
3. windows-foundation → `~/workspace/omsuite/apps/windows/` (evaluate Tauri 2 + React/TS/Rust vs alternatives, record decision in apps/windows/DECISION.md; native filesystem; installer packaging + honest signing status)
4. shared-engines → `~/workspace/omsuite/shared/` + `~/workspace/omsuite/tests/` (file-core contracts, text/archive/conversion engines that are genuinely testable, executed test evidence)
5. docs-ci-packaging → `~/workspace/omsuite/docs/` APPENDIX-B docs owned here are: README.md, BUILD_STATUS.md, KNOWN_LIMITATIONS.md, FINAL_STATUS.md, SECURITY.md, IMPLEMENTATION_STATUS.md, BLOCKERS.md; plus `~/workspace/omsuite/.github/workflows/` (CI), packaging scripts in `~/workspace/omsuite/scripts/`, repo-existence check + push attempt via connector only.

## Realistic scope rule
If the full 12-module scope cannot genuinely be completed, deliver the largest honestly-working subset. Unimplemented modules must NOT appear as working features in the apps; they go in KNOWN_LIMITATIONS / IMPLEMENTATION_STATUS as Not implemented. Do NOT pad with fake features.

## Each stream must finish with
- Its own `STATUS.md` in its root directory: files created, commands run with exact output, tests executed with pass/fail counts, what is Not Tested, limitations, and any blocker with exact error text.
- No claims without evidence. No secrets anywhere.
