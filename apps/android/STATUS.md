# OmSuite Android — Stream 2 STATUS (31 Oct 2026)

Scope kept strictly to `~/workspace/omsuite/apps/android/`. No files outside
that directory were created or edited by this stream (docs/, shared/,
apps/windows/, scripts/, .github/ untouched).

## Files created (32, verified by `find … | wc -l`)

Gradle shell:

- `settings.gradle.kts` — project `OmSuite`, `include(":app")`, google() + mavenCentral()
- `build.gradle.kts` — AGP 8.5.2, Kotlin 1.9.24, KSP 1.9.24-1.0.20 (apply false)
- `gradle.properties` — AndroidX, JVM args, non-transitive R class
- `gradle/wrapper/gradle-wrapper.properties` — Gradle 8.7 distribution URL
- `gradlew` (executable) + `gradlew.bat` — bootstrap scripts; see README note
  (stock `gradle-wrapper.jar` NOT vendored: this VM cannot run Java to
  generate it, so the scripts download + unpack Gradle 8.7 once instead)
- `app/build.gradle.kts` — namespace/applicationId `com.omsuite.android`,
  compileSdk 34, minSdk 26, targetSdk 34, versionCode 1,
  versionName `0.1.0-debug`; Compose BOM 2024.06.00, Navigation 2.7.7,
  Room 2.6.1 (KSP), DataStore Preferences 1.1.1, DocumentFile 1.0.1
- `app/proguard-rules.pro` (empty placeholder), `.gitignore` (excludes
  `*.keystore`, `*.jks`, `keystore.properties`, build outputs)

App source (13 Kotlin files, ~1,750 lines main + 85 lines tests):

- `app/src/main/AndroidManifest.xml`
- `app/src/main/java/com/omsuite/android/MainActivity.kt`, `OmSuiteApp.kt`
- `app/src/main/java/com/omsuite/android/data/AppDatabase.kt`
  (Room: recent_files, favourites, editor_drafts, granted_folders)
- `app/src/main/java/com/omsuite/android/data/FileRepository.kt`
  (SAF DocumentFile: list, create folder/file, rename, copy, move
  [copy-then-delete], delete, read/write text, persistable permissions)
- `app/src/main/java/com/omsuite/android/data/SettingsStore.kt`
  (DataStore: theme, default folder URI/name)
- `app/src/main/java/com/omsuite/android/ui/theme/Theme.kt`
  (emerald accent #10B981, light/dark/system)
- `app/src/main/java/com/omsuite/android/ui/screens/Navigation.kt`
  (bottom bar: Home / Files / New note / Settings only)
- `app/src/main/java/com/omsuite/android/ui/screens/HomeScreen.kt`
- `app/src/main/java/com/omsuite/android/ui/screens/FilesScreen.kt`
- `app/src/main/java/com/omsuite/android/ui/screens/EditorScreen.kt`
- `app/src/main/java/com/omsuite/android/ui/screens/SettingsScreen.kt`
- `app/src/main/java/com/omsuite/android/util/FileUtils.kt`
  (formatSize, extension, editable types, archive traversal guard, sorting)
- `app/src/main/java/com/omsuite/android/util/TextUtils.kt`
  (pure-Kotlin JSON validate/format; Markdown subset parser)

Resources: `res/values/strings.xml`, `res/values/themes.xml`,
`res/drawable/ic_launcher_foreground.xml` (emerald eye-ish mark),
`res/mipmap-anydpi-v26/ic_launcher.xml`, `ic_launcher_round.xml`.

Tests: `app/src/test/java/com/omsuite/android/FileUtilsTest.kt` (9 tests),
`app/src/test/java/com/omsuite/android/TextUtilsTest.kt` (5 tests).

Docs: `README.md` (this directory), this `STATUS.md`.

## Commands run, with exact output

1. `which java kotlin gradle` → (no output — none installed)
   `ls /usr/lib/jvm` → `ls: cannot access '/usr/lib/jvm': No such file or directory`
   `ls ~/workspace/omsuite/apps/android/` → empty directory (confirmed before writing).
   A full JDK download/install under `~/workspace/` was NOT attempted:
   the coordinator plan already records local Gradle as platform-blocked
   (Java loopback timeout, cacerts missing), and CI is the designated build
   route. No local build is claimed.
2. Static brace/paren scan (custom Python tokenizer stripping comments,
   strings, raw strings, char literals) over all 15 Kotlin files:
   every file balanced (0,0,0) except `util/TextUtils.kt`, which reported
   parens +1. Manual inspection: the file's code is visually balanced; the
   +1 is attributable to quote/escape-heavy literals in that file
   (e.g. `'"'`, `'\\'`, `"Bad escape '\\$e'"`, regex literals). This scan
   is NOT a compile check — see "Not Tested" below.
3. Secrets scan: `grep -rn -i -E "password|api[_-]?key|token|keystore|secret"`
   over Gradle + main sources returned only the word "token" inside JSON
   parser code (JSON literal tokens `true`/`false`/`null`) — no credential,
   keystore, or secret value exists in any file. No `LICENSE` file exists
   in this directory (verified: `ls LICENSE*` → `No such file or directory`).

## Tests / builds executed

- **Local Gradle build: Not Tested** — no Java/Gradle in this VM (see blocker).
- **Unit tests (14 total: 9 FileUtils + 5 TextUtils): Not Tested** — not
  executed locally for the same reason. They are pure-JVM tests with no
  Android-framework dependency (JSON uses the pure-Kotlin parser in
  `TextUtils.kt` precisely so they can run under `./gradlew
  :app:testDebugUnitTest` in CI).
- **Device / emulator run: Not Tested** — no device or emulator available
  to this stream. All UI behaviour (SAF pickers, Room flows, editor
  save/recovery, theme switching) is therefore **Not verified** on a device,
  even though the code paths are implemented.
- **CI build: pending stream 5** — this project is written to be
  CI-buildable (valid Gradle files, no local-only paths, no secrets, no
  committed keystore, debug signing only).

## Module status (honest)

| Module | Status | Notes |
|---|---|---|
| File Manager | Partial (code complete, Not verified) | Real SAF files only; empty states explain granting a folder; no sample data. Copy/move destination is limited to granted folders. The item ⋮ menu is a root-level DropdownMenu (positioning may sit oddly on some screens — needs device check). |
| Text Writer + Code/Text Editor | Partial (code complete, Not verified) | TXT/MD/JSON/XML/YAML/HTML text editing; JSON format/validate; Markdown preview subset only; find/replace-all; undo/redo (per-keystroke snapshots, cap 100); autosave draft + recovery prompt; overwrite confirmation. No syntax highlighting, no binary formats. |
| Settings | Partial (code complete, Not verified) | Theme, default save location, clear recents, clear cache, privacy statement. Default folder is stored but the editor's Save-As picker still asks each time (picker must be user-driven on Android) — stored value is shown in Settings as the suggested location. |
| Sheets | Not implemented | Not in UI. |
| Slides | Not implemented | Not in UI. |
| PDF Studio | Not implemented | Not in UI. |
| Media | Not implemented | Not in UI. |
| E-books | Not implemented | Not in UI. |
| Archives | Not implemented | Traversal guard exists in `FileUtils`; no extraction UI ships. |
| Converter | Not implemented | Not in UI. |
| Scan & OCR | Not implemented | Not in UI. |

## Limitations (known, to verify in CI / on device)

1. Compile not proven here — first CI build may surface Compose/Material3
   API mismatches (notably `DropdownMenuItem` signatures and
   `ActivityResultContracts` usage); fix in CI, do not hand-edit blindly.
2. Editor launch handoff uses a session-only in-memory holder
   (`EditorLaunch`) to avoid corrupting `content://` tree URIs through
   route encoding; it does not survive process death (acceptable for v0.1,
   the file itself is never at risk — worst case the editor opens blank).
3. Undo/redo enabled-state refreshes on text-change recomposition only.
4. Markdown preview: bullets/numbered items render their plain text
   (inline bold/italic/code styling applies to paragraphs, headings and
   quotes); tables, images, links and nested lists are out of scope.
5. `gradlew` is a bootstrap script, not the stock wrapper jar — documented
   in README; stream 5 may replace it with a generated wrapper + jar.
6. App icon is a simple vector mark, not a final brand asset.

## Blocker (exact)

- Local build impossible in this VM: `java` is not installed
  (`which java` → empty) and `/usr/lib/jvm` does not exist. Per the
  coordinator plan this is a known platform block, not a project defect.
  Build route = GitHub Actions CI (stream 5). No error text beyond the
  `ls` output quoted above, because no build was attempted.
- No other blocker. No token, password, keystore or licence was created,
  requested, or stored.
