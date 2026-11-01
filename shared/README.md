# OmSuite Shared Engines — README

Reference implementation of the genuinely testable OmSuite processing core.
**Language: Python 3.12, standard library only** (no third-party packages).
Chosen because it runs in this VM (Node v24 was also available; Python's
`zipfile` / `xml` / `csv` / `json` stdlib modules cover exactly the formats
we honestly support, with zero install risk).

## Files

| File | What it does |
|---|---|
| `errors.py` | Stable error codes (`NOT_FOUND`, `CONFLICT`, `UNSAFE_PATH`, …). |
| `file_core.py` | list/sort/search, copy/move/rename/delete/duplicate, conflict resolution, atomic write, capped reads. |
| `archive_core.py` | ZIP browse / extract-all / extract-selected / create; traversal, symlink and archive-bomb guards; progress + conflicts. |
| `text_core.py` | TXT/MD/JSON/XML/YAML-subset read/write; encoding + line-ending preservation; JSON validation/formatting; safe previews. |
| `convert_core.py` | Only the conversions actually implemented and tested (see below). |
| `CONTRACTS.md` | Language-neutral spec the Android/Windows apps must mirror. |
| `STATUS.md` | Files, exact commands + output, test numbers, limitations, Not Tested items, blockers. |

## Run the tests

```sh
cd ~/workspace/omsuite
python3 -m unittest discover -s tests -v
```

No installation step: the test files insert `shared/` on `sys.path`.
Python 3.12.3 was used here; any Python ≥ 3.10 should work (the code uses
`Path.unlink(missing_ok=True)` and `ET.indent`, both 3.9+).

## Conversions actually implemented (with fidelity limits)

- TXT ↔ MD (MD→TXT is lossy; every loss is returned as a warning)
- JSON pretty-print / minify (duplicate keys warned, last wins)
- CSV ↔ JSON (values stay strings; ragged rows and duplicate headers warned)
- CSV ↔ Markdown table (`|` escaped; separator row required)

NOT implemented and NOT claimed: DOCX / XLSX / PPTX / PDF / EPUB editing
or conversion, RAR / 7Z archives, OCR. They appear in `STATUS.md` as
Not implemented / Not verified with reasons. Any stream claiming them must
first land a tested engine here.

## How Android / Windows should adapt these contracts

### Android (Kotlin/Compose, SAF)
- The engines assume a filesystem path. Under SAF you do not always have
  one: wrap a `DocumentFile` / `Uri` in a small adapter that exposes
  open-input-stream / open-output-stream, then port the *logic* (conflict
  policies, traversal validation, bomb limits, warnings) — do not try to
  run this Python code on-device.
- Conflict `rename` naming (`name (2).ext`, `name (copy).ext`) is part of
  the contract: keep the exact strings so behaviour matches Windows.
- Atomic write on SAF = write to a temp document in the same directory,
  then replace via `DocumentsContract` semantics; there is no `os.replace`
  for SAF URIs, so document the mapping in the Android stream's STATUS.md.
- Permission grants, persistable URI permissions and the SAF picker UI are
  Android-only and stay in the Android stream (see §3).
- Validate archive member names with the same rules before writing
  anything, even though Android's sandbox limits the blast radius — a
  traversal inside the app's own storage is still data loss.

### Windows (native filesystem)
- The reference code maps almost directly: `os.replace` is atomic on
  NTFS for same-volume replaces; `shutil` equivalents exist in Rust/Win32
  (`CopyFile`, `MoveFileEx`). Keep the same conflict policies and error
  codes so error messages match Android.
- Windows reserved names and trailing dots/spaces are already rejected by
  `validate_name` — keep that check even though Win32 would also reject
  most of them, so the user gets the OmSuite error instead of a cryptic OS
  one.
- File locking: a file open in another app may fail a move/replace on
  Windows where it would succeed on Linux/Android. Map that OS error to
  `PERMISSION_DENIED` with a "file may be open in another app" detail —
  the reference code cannot test this path on Linux (see STATUS.md).

## 3. What is deliberately NOT shared (permission models differ)

- **Android SAF access**: picker flows, persistable permissions, `Uri`
  vs path handling. The engines never request permissions.
- **Windows Recycle Bin / trash**: there is no trash in `file_core.delete`
  (permanent delete, caller must confirm). Android has no system trash
  equivalent and Windows' Recycle Bin API differs — each app implements
  its own trash/confirm UX on top of `delete`.
- **Storage locations**: app-private dirs, Documents, SD card, install
  dir. The engines take paths the app already secured.
- **File locking / sharing violations** (Windows) and **scoped-storage
  denials** (Android): mapped to `PERMISSION_DENIED`, but the underlying
  cause and recovery UI are platform-specific.

## Security notes

- All inputs are treated as untrusted: no script/macro execution, no HTML
  interpretation of file content. `text_core.html_escape` exists for
  preview renderers; engines never render HTML themselves.
- No network, no telemetry, no account, no cloud in this code — it only
  touches local paths the caller passes in.
- No secrets, tokens, passwords, keystores or license text anywhere in
  `shared/` or `tests/` (verified by grep; the only matches were a YAML
  parser variable named `token` and test fixture prose).
