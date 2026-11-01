# Stream 4 — Shared Engines: STATUS (31 Oct 2026)

## Files created (all under `~/workspace/omsuite/`)

- `shared/errors.py` (76 lines) — stable error codes + OSError mapping.
- `shared/file_core.py` (384 lines) — list/sort/search, copy/move/rename/
  delete/duplicate, conflict resolution, atomic write, capped reads.
- `shared/archive_core.py` (241 lines) — ZIP browse/extract-all/
  extract-selected/create, traversal + symlink + bomb guards, progress.
- `shared/text_core.py` (387 lines) — TXT/MD/JSON/XML/YAML-subset,
  encoding + line-ending preservation, JSON/XML validation + formatting,
  safe previews.
- `shared/convert_core.py` (242 lines) — TXT↔MD, JSON pretty/minify,
  CSV↔JSON, CSV↔MD table, each returning `(output, warnings)`.
- `shared/CONTRACTS.md` — language-neutral spec for Android/Windows ports.
- `shared/README.md` — contracts, SAF vs native-filesystem adaptation,
  what is deliberately NOT shared.
- `tests/test_file_core.py` (139 lines), `tests/test_archive_core.py`
  (124 lines), `tests/test_text_core.py` (109 lines),
  `tests/test_convert_core.py` (78 lines).
- This file. No other directories touched (docs/, apps/, scripts/,
  .github/ not edited; COORDINATOR_PLAN.md read only).

## Commands run (exact) and output

```sh
$ cd ~/workspace/omsuite && python3 -m unittest discover -s tests -v
# first run: Ran 35 tests — FAILED (failures=2, skipped=1)
#   - test_bomb_ratio_rejected: test crafted STORED (uncompressed) zips,
#     so the ratio was ~1:1, not a bomb. Fixed the TEST to force DEFLATED.
#   - test_csv_md_table_roundtrip: convert_core split table rows on every
#     "|", breaking escaped "\|" cells. Fixed the ENGINE to split on
#     unescaped pipes only.
# second run: Ran 35 tests — FAILED (errors=1, skipped=1)
#   - the 912:1 test bomb also exceeds the DEFAULT 200:1 limit (correct
#     engine behaviour); fixed the TEST's wrong "passes with defaults"
#     assertion to use a normal archive instead.
$ cd ~/workspace/omsuite && python3 -m unittest discover -s tests
Ran 36 tests in 0.031s
OK (skipped=1)
```

Final: **36 tests run, 35 passed, 0 failed, 1 skipped.**
The skipped test is `test_permission_denied_on_readonly_dir`: this VM runs
as root (uid 0, verified with `id -u`), and root bypasses file-permission
checks, so the permission-denied path cannot be exercised here. It is
skipped by `unittest.skipIf(os.geteuid() == 0, …)`, NOT counted as passed.

Environment: Python 3.12.3, stdlib only, no packages installed.

## What the tests cover

- File ops: list sort/hidden, name + content search, copy conflict
  error/rename/overwrite/skip, move, rename (incl. 6 invalid names),
  duplicate naming, delete rules + symlink non-following, atomic write
  (overwrite, error-policy leaves old content, rename-policy, no temp
  leftovers), capped reads, directory-into-itself refusal.
- ZIP: create/extract round-trip + progress callback, traversal rejection
  (`../`, absolute, drive-letter), symlink-entry rejection, bomb ratio /
  entry-count / single-file limits, extract-selected + missing-entry error,
  extract conflicts (error/rename/skip), malformed + missing archives,
  create conflict + symlink-source refusal.
- Text: CRLF + BOM preservation, LF override, mixed-ending warning,
  latin-1 fallback warning, binary (NUL) rejection, JSON validate/format/
  duplicate-key warning/minify, XML validate/format + comment/DOCTYPE
  drop warnings, YAML subset round-trip (incl. list-of-mappings),
  YAML unsupported-construct rejection (anchors, multi-doc, block scalar,
  duplicate keys), HTML escaping, preview truncation.
- Conversions: TXT→MD warnings, MD→TXT losses + warnings, JSON
  pretty/minify round-trip, CSV↔JSON round-trip (incl. `007` staying a
  string), ragged/duplicate/extra-cell CSV warnings, JSON→CSV nested +
  missing-key warnings, CSV↔MD-table round-trip incl. `|` cells,
  malformed table rejection.

## Limitations (honest)

- L1. Atomicity is "temp file + fsync + os.replace", not crash-proof
  against OS/power failure: a power cut between fsync and replace can
  still leave the temp file. Apps must clean `.<name>.*` temp files on
  startup. Crash-during-write was NOT simulated (would need fault
  injection); the test verifies content preservation and temp cleanup on
  the error path only.
- L2. Archive extraction validates all entry names up front, but a
  conflict error midway (policy `error`) can leave earlier entries
  extracted. The caller gets the exception, not a partial list — apps
  must surface "partially extracted" honestly (planned improvement: return
  the written list on the exception object).
- L3. YAML is a subset (CONTRACTS.md §4). Anything outside it errors
  rather than mis-parsing — safe, but a real-world YAML file with anchors
  will be refused, not edited.
- L4. XML pretty-print drops comments / processing instructions /
  DOCTYPE (ElementTree limitation) — warned, never lossless.
- L5. MD→TXT is lossy by design; CSV→JSON keeps everything as strings
  (no type inference). Both are documented in CONTRACTS.md §5.
- L6. `search` content matching is UTF-8 text only; binary and
  latin-1-encoded files are skipped for content search (they still match
  by name).
- L7. Copy size default cap is 2 GiB and text read cap 50 MiB; callers
  must raise them explicitly for larger files — a silent refusal is
  better than an OOM, but apps must explain it.

## Not Tested

- Permission-denied / read-only paths on a real non-root user (skipped:
  VM runs as root; see above). Needs a non-root run or an Android/Windows
  device run by those streams.
- Windows file-locking (file open in another app) — cannot occur on Linux.
- Insufficient-storage path (`ENOSPC`): not simulated (would need a full
  filesystem or fault injection); the code path exists (`_check_space`
  + `wrap_os_error`) but has no executed test.
- SAF adaptation and the Kotlin/Rust ports of these contracts — the other
  streams own those; this Python code is the reference, not the shipped
  app code.
- Performance / large-file behaviour beyond the 1 MiB bomb fixture.

## Not implemented / Not verified (do NOT claim)

- DOCX / XLSX / PPTX / PDF / EPUB reading, editing or conversion — no
  engine, no tests. (Python stdlib has no verified engine for these.)
- RAR / 7Z archives — ZIP only.
- OCR — no engine here (on-device OCR belongs to the Scan & OCR module).
- Formula engine (Sheets), slide rendering, media transcoding — out of
  this stream's scope; other streams must not present this core as
  covering them.
- No LICENSE file added (license status stays "not yet selected" per the
  coordinator plan; never invented).

## Blockers

None for this stream's scope. No secrets, tokens, passwords or keystores
were used, requested or stored. A grep for password/token/secret/keystore
across `shared/` and `tests/` returned only two false positives: a YAML
parser variable named `token` and test fixture prose ("the secret word
is banana").
