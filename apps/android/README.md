# OmSuite for Android

Real, local-first Android app (Kotlin + Jetpack Compose). No account, no cloud
sync, no telemetry. Core works offline.

## What is actually implemented (v0.1.0-debug)

- **File Manager** — browse folders the user grants via the Storage Access
  Framework (document picker / folder picker). List + grid views, sort by
  name/type/size/modified (ascending/descending), search within the current
  folder, breadcrumbs, create folder, create file, rename, copy, move,
  duplicate, delete (with confirmation), multi-select, file properties,
  favourites, recents. Recents/favourites/granted folders persist locally in
  Room (`omsuite.db`). Empty states explain how to open a first file — no
  sample files are ever presented as real.
- **Text / Code Editor** — create/open/edit/save/Save As for TXT, MD, JSON,
  XML, YAML, HTML and similar text files. Find + replace-all, undo/redo,
  dirty (unsaved) indicator, overwrite confirmation, autosave draft to Room
  with a restore/discard recovery prompt, JSON validation + pretty-formatting
  (pure-Kotlin parser, no Android stub dependency), Markdown preview for a
  documented subset (headings, bold, italic, inline code, lists, quotes,
  code blocks; anything else renders as plain text).
- **Settings** — theme (Light / Dark / System), default save location,
  clear recents, clear app cache, privacy statement (no cloud account/sync),
  about + honest module list.

## What is NOT implemented

Sheets, Slides, PDF Studio, Media, E-books, Archives, Converter, Scan & OCR.
They do **not** appear as working features in the app UI. See `STATUS.md`.

## Build

### CI route (primary — this is how the APK is produced)

This VM cannot run Gradle locally (no Java installed; Java loopback is
platform-blocked — see `STATUS.md`). The CI workflow owned by stream 5
(`.github/workflows/`, repo root) builds this project. A clean clone needs:

- Android SDK with `compileSdk 34`, `minSdk 26`, `targetSdk 34`
- JDK 17
- Network access on first run (Gradle 8.7 + Android Gradle Plugin 8.5.2 +
  dependencies are downloaded; nothing is vendored and no local-only path
  is referenced)

```sh
cd apps/android
./gradlew :app:assembleDebug      # debug APK only, honestly labelled
./gradlew :app:testDebugUnitTest  # JVM unit tests (FileUtils, JSON, Markdown)
```

### Local route (if you have a working JDK/Android SDK)

Same commands as above. `./gradlew` here is a small bootstrap script (the
stock `gradle-wrapper.jar` is not vendored because this VM cannot run Java
to generate it): it downloads Gradle 8.7 once into
`~/.gradle/wrapper/omsuite-gradle-8.7/` and execs it. `gradlew.bat` does the
equivalent on Windows via PowerShell. CI may instead use
`gradle/gradle-build-action` with Gradle 8.7 directly.

## Signing

**Debug signing only.** No release keystore is committed, and no release
signing is claimed. The APK is version `0.1.0-debug` and must be labelled
"debug build" wherever it is shared.

## Licence

**Not yet selected.** No `LICENSE` file is shipped and no licence is
claimed. Third-party components are listed in the repo-level
`DEPENDENCIES_AND_LICENSES.md` (stream 1).

## Safety notes

- Files are treated as untrusted input: nothing is executed, no macro or
  script runs, no network call is made at runtime.
- Archive path-traversal guard (`FileUtils.isSafeArchiveEntry`) is implemented
  for any future archive feature; no archive extraction ships in v0.1.
- SAF copy/move: move is copy-then-delete-source, only after a successful
  copy. Delete of a folder removes everything inside it (confirmed first).

## Project layout

```
settings.gradle.kts / build.gradle.kts / gradle.properties
gradle/wrapper/gradle-wrapper.properties   (Gradle 8.7)
app/build.gradle.kts                       (AGP 8.5.2, Kotlin 1.9.24, Compose BOM 2024.06.00, Room 2.6.1)
app/src/main/AndroidManifest.xml           (package com.omsuite.android)
app/src/main/java/com/omsuite/android/
  MainActivity.kt  OmSuiteApp.kt
  data/    AppDatabase.kt  FileRepository.kt  SettingsStore.kt
  ui/theme/Theme.kt
  ui/screens/  Navigation.kt  HomeScreen.kt  FilesScreen.kt  EditorScreen.kt  SettingsScreen.kt
  util/    FileUtils.kt  TextUtils.kt
app/src/test/java/com/omsuite/android/   FileUtilsTest.kt  TextUtilsTest.kt
```
