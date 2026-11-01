# OmSuite — Everything. One Workspace.

OmSuite is a personal, local-first productivity suite for **Android and Windows
only**. There is no web version, no cloud storage, sync, backup, or
collaboration, no mandatory account, login, or subscription, and no telemetry
or silent upload. Core features work offline. Each platform manages its own
local data; there is no sync between the Android and Windows installations.

> **Status — read this first.** This is version **0.1.0 core**, not the full
> 12-module suite. What actually works today is the File Manager, a text
> Writer / Code-Text Editor, and Settings — on both platforms, within the
> scopes listed in `IMPLEMENTATION_STATUS.md`. The other nine modules
> (Sheets, Slides, PDF Studio, Media, E-books, Archives, Converter, Scan &
> OCR, plus full-format editing) are **Not implemented** and do not appear
> as working features in either app. No Android APK and no Windows installer
> has been produced yet (see `BUILD_STATUS.md`). Anything not executed is
> labelled **Not Tested** in this documentation set.

> **Licence: NOT YET SELECTED.** There is no `LICENSE` file in this project,
> and public visibility (when the repository is created) does **not** grant
> anyone permission to reuse OmSuite's source. The project licence is chosen
> by the user (nimu) only. Third-party licences still apply in full — see
> `DEPENDENCIES_AND_LICENSES.md` (stream 1).

## Platforms

| Platform | Stack | App identity | Version |
|---|---|---|---|
| Android | Kotlin + Jetpack Compose, Room, DataStore, SAF | `com.omsuite.android` | `0.1.0-debug` (debug build only) |
| Windows | Electron 45.x + plain HTML/CSS/JS, Node.js cores | `com.nimu.omsuite` (provisional — not user-approved, changeable in one place) | `0.1.0` |

Android requires Android 10+ in practice (minSdk 26, targetSdk 34).
Windows requires Windows 10 (1809+) / 11 x64 and Node.js 20+ to build from
source; the installer itself is built with electron-builder NSIS x64.

## Repository layout

```
OmSuite/
  apps/
    android/          Android app (Gradle, Kotlin/Compose)
    windows/          Windows app (Electron; src/main.js + src/main/* cores)
  shared/             Python reference engines + contracts (NOT shipped app
                      code — see shared/README.md; Android/Windows have
                      their own ports of the same contracts)
  tests/              Python unit tests for the shared reference engines
  docs/               This documentation set (see below)
  scripts/            Packaging, checksum, and secret-scan scripts
  prototypes/         HTML mockups — VISUAL REFERENCE ONLY. Dead buttons,
                      hardcoded sample data. Never shipped as the app.
  .github/workflows/  CI: android.yml (debug APK), windows.yml (installer)
```

## Documentation map (this folder)

| File | Owner | Contents |
|---|---|---|
| `README.md` (this file) | Stream 5 | Overview, layout, build/run instructions |
| `MASTER_PLAN.md` | Stream 1 | Scope, phases, quality gates |
| `ARCHITECTURE.md` | Stream 1 | System + platform architecture |
| `DECISION_LOG.md` | Stream 1 | Decisions D-01–D-14 |
| `FORMAT_SUPPORT.md` | Stream 1 | Per-format, per-platform capability matrix |
| `DEPENDENCIES_AND_LICENSES.md` | Stream 1 | Third-party inventory + obligations |
| `IMPLEMENTATION_STATUS.md` | Stream 5 | Module-by-module status, evidence-based |
| `BUILD_STATUS.md` | Stream 5 | Build commands, environment, artifacts |
| `KNOWN_LIMITATIONS.md` | Stream 5 | Limitations, unsupported formats, known issues |
| `SECURITY.md` | Stream 5 | Threat model, untrusted-file handling, gaps |
| `BLOCKERS.md` | Stream 5 | Blockers, alternatives, required user actions |
| `FINAL_STATUS.md` | Stream 5 | Delivery inventory, test results, deferred tests |

## Prerequisites

- **Android build:** JDK 17, Android SDK (compileSdk 34), network access on
  first run (Gradle 8.7 + AGP 8.5.2 + dependencies are downloaded; nothing
  is vendored). Local builds do **not** work on the development VM (no Java;
  see `BLOCKERS.md` B-1) — use CI.
- **Windows build:** Windows 10/11 x64 machine, Node.js 20+. Linux builds of
  the NSIS installer do **not** work (Wine is absent on the dev VM; see
  `BLOCKERS.md` B-2) — use CI (`windows.yml`, which runs on windows-latest)
  or a Windows machine.
- **Shared reference tests:** Python 3.12+, standard library only.

## Build and run from a clean clone

### Android (CI route — primary)

```sh
cd apps/android
./gradlew :app:assembleDebug      # debug APK only, honestly labelled
./gradlew :app:testDebugUnitTest  # JVM unit tests
# APK: app/build/outputs/apk/debug/*.apk  (debug signing only)
```

`./gradlew` is a bootstrap script, not the stock wrapper jar: it downloads
Gradle 8.7 once into `~/.gradle/wrapper/omsuite-gradle-8.7/` and runs it.
**Debug signing only.** No release keystore is committed, and no release
signing is claimed. Do not share the debug APK as a release build.

### Android (what CI does)

Push to `main` (or open a PR touching `apps/android/**`) and the
`.github/workflows/android.yml` workflow builds the debug APK, runs the
unit tests, and uploads both as artifacts (30-day retention). CI has not
run yet — the repository does not exist yet (see `BLOCKERS.md` B-3).

### Windows (on a Windows machine)

```powershell
cd apps/windows
npm install
npm start                        # run the app
npm test                         # unit tests (expect 17/17 pass)
powershell -ExecutionPolicy Bypass -File scripts/build-windows.ps1
# installer: dist\OmSuite-Setup-0.1.0.exe  (UNSIGNED — SmartScreen will warn)
```

### Windows (CI route)

Push to `main` (or open a PR touching `apps/windows/**`) and
`.github/workflows/windows.yml` runs the tests and builds the unsigned
NSIS installer on a `windows-latest` runner, uploading it as an artifact.
CI has not run yet — the repository does not exist yet (see `BLOCKERS.md` B-3).

### Shared reference engines (not shipped app code)

```sh
python3 -m unittest discover -s tests
# Expected: 36 tests run, 35 passed, 1 skipped (see IMPLEMENTATION_STATUS.md)
```

## Security and privacy rules (summary)

- No account, no cloud, no telemetry, no silent upload — by architecture.
- Files opened by the user are treated as **untrusted input**: archives are
  checked for path traversal and decompression bombs, HTML is escaped
  (never executed) in previews, macros/scripts are never auto-executed.
- Never commit a keystore, signing key, password, token, or personal data.
  Run `./scripts/secret-scan.sh` before every push and before packaging.
- Full detail: `SECURITY.md`. Known gaps: `KNOWN_LIMITATIONS.md`.

## Contributing / handover notes

This is a personal project in active development. The honest status of
every module, every build, and every test is in `IMPLEMENTATION_STATUS.md`,
`BUILD_STATUS.md`, and `FINAL_STATUS.md`. A menu label is not an
implemented module, a successful compile is not proof of correct editing,
and a debug build is not a release installer.
