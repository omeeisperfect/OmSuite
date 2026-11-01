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

## Addendum — 1 Nov 2026 (shared-engine extension, no apps/docs/git touched)

New engines (all stdlib-only, all tested):
- `shared/sheet_core.py` + `tests/test_sheet_core.py` (16 tests): A1
  addressing, formulas (+ - * / parens, refs, SUM/AVERAGE), cycle
  detection via recalculate() errors, CSV round-trip, minimal
  single-sheet XLSX read/write (stdlib zip/xml). One real engine bug
  caught by tests and fixed: the formula tokenizer kept leading
  whitespace in token text, so `SUM(A1, A2*2)` read A2 as 0.
- `shared/epub_core.py` + `tests/test_epub_core.py` (3 tests):
  container -> OPF -> spine chapters, tag-stripped paragraphs.
- `shared/pdf_core.py` + `tests/test_pdf_core.py` (5 tests):
  best-effort Tj/TJ extraction, uncompressed + FlateDecode, hex/UTF-16BE.
- `shared/slide_core.py` + `tests/test_slide_core.py` (5 tests): deck
  model + single-file HTML export with escaping and image embedding.
- `shared/archive_core.py` (small fix, tested): extract() now validates
  directory entries too (a traversal dir name previously slipped past
  the file checks) and creates explicit empty-dir entries.
- `shared/convert_core.py`: NO behaviour change. CSV<->JSON round-trips
  and JSON pretty-print already existed; 3 new tests pin hard cells
  (commas/quotes/unicode/multiline) and indent options.
- `shared/CONTRACTS.md` (§6–§9) and `shared/README.md` updated for the
  new engines and their limits.

Test command: `cd ~/workspace/omsuite && python3 -m unittest discover -s tests`
Before: 36 run, 35 pass, 0 fail, 1 skipped.
After: 69 run, 68 pass, 0 fail, 1 skipped (same pre-existing root skip:
test_permission_denied_on_readonly_dir). No existing test was weakened;
two new-test fixture mistakes (unquoted comma; score-column mix-up)
were fixed in the new tests, not in engines, except the tokenizer bug
above which was a genuine engine fix.

## Addendum — 1 Nov 2026 (CORRECTION pass, shared engines only)

Scope kept strictly to `shared/*.py` (+ their tests in `tests/`):
no apps/, docs/, .github/, no git push, no LICENSE, no secrets. Only
the Python stdlib is used. Every behaviour below has tests; no existing
test was modified (49 new tests were APPENDED to the existing files).

- `file_core.py`: `copy_many` / `move_many` (progress, ok/skipped/
  errors, abort-vs-collect), `properties` (recursive size/counts,
  symlink-aware), `filter_entries` + search `extensions`/`min_size`/
  `max_size`, `confirm_overwrite` on copy/move/rename/atomic_write
  (decline == skip), read-only decided from mode bits (holds even for
  root — the old `os.access`-only check passed for uid 0), missing
  destination directory is NOT_FOUND (was a misleading permission
  error), directory copies containing any symlink are refused,
  atomic-write temps carry a `.om_tmp_` marker and
  `cleanup_temp_files` removes exactly those (crash recovery).
- `sheet_core.py`: out-of-grid references (`A0`, `XFE1`, `A1048577`,
  bad ranges) are now `#REF!` errors, not silent 0s — this was a real
  bug: `cell_value` looked up the absent key and returned 0. New:
  `display_values()` / `value_or_error()` (`#DIV/0!` / `#VALUE!` /
  `#REF!` / `#CYCLE!`), in-memory multi-sheet `Workbook`
  (CSV/XLSX stay single-sheet, as documented), `sort_rows` (errors /
  empties always last, header option) and `filter_rows` (broken cells
  appear as `#...!` values, never crash the filter).
- `slide_core.py`: `duplicate_slide` (independent copy after the
  original), per-slide speaker `notes`, `export_html(include_notes=)`
  (notes absent by default, escaped `<aside>` in handout mode), `clear`.
- `pdf_core.py`: stream bodies sliced by direct `/Length` when it
  plausibly ends at `endstream` (a body containing those bytes no
  longer truncates the stream — tested with the word inside a string),
  stream dict read from after the previous `endstream` (binary `<<`
  bytes can't steal `/Filter`), per-stream decompression cap (default
  50 MiB; over-cap streams skipped). `merge_pdfs` / `split_pdf` are
  stubs raising UNSUPPORTED_FORMAT — no fake merge/split. Docstring
  now lists layout/fonts/scanned/encrypted/editing/merge/split as NOT
  supported.
- `epub_core.py`: TOC from EPUB3 nav (levels + fragments) with EPUB2
  NCX fallback, empty TOC when neither exists; `Bookmark` (dict
  round-trip), `book_progress` (0.0–1.0, end is exactly 1.0),
  `search_epub` (snippets, case-insensitive default); encrypted/DRM
  EPUBs (`META-INF/encryption.xml`) and MOBI/AZW refused with
  UNSUPPORTED_FORMAT. No images/styles/DRM — documented.
- `archive_core.py`: encrypted entries refused (UNSUPPORTED_FORMAT,
  never silently skipped); non-ZIP formats refused clearly (.rar/.7z/
  .tar/.gz by name with non-ZIP bytes; a real ZIP misnamed .rar still
  reads); `create` stores explicit entries for file-less directories
  (ordinary trees stay file-only in browse, so the old exact-list test
  still passes); extraction is temp-file + replace per entry (a failed
  entry leaves an existing destination untouched — verified for CRC
  failure under overwrite); bytes actually written are counted against
  the size limits; failures midway attach `partial_paths` to the
  exception (fixes old limitation L2); CRC mismatches become
  MALFORMED_INPUT; nested ZIPs extract as opaque files, never expanded;
  extracted files get mode 0644 (entry permission bits not restored).
  RAR/7Z/TAR remain NOT supported.
- `convert_core.py`: closed `convert` dispatcher returning a
  `ConversionResult` (output + warnings + source_unchanged); every
  unverified pair raises UNSUPPORTED_FORMAT naming the pair (incl.
  txt->txt and docx->pdf). `convert_file` (extension-derived formats,
  atomic destination write, default policy "error", src == dst
  refused, source bytes verified unchanged) and in-memory
  `ConversionHistory` (add / records / clear). Individual
  `*_to_*` / `json_*` functions are unchanged.
- `text_core.py`: `markdown_to_html` (headings, paragraphs, bold/italic,
  code spans + fences, lists, blockquotes, rules, simple tables, links,
  images) — text escaped BEFORE markup, so `<script>` renders as text;
  unsafe link/image schemes (javascript:/data:/...) render as plain
  text with a warning; one level of balanced parens in URLs is handled
  (a `javascript:alert(1)` URL is refused whole, not cut at the inner
  paren). `tokenize_code` / `tokens_to_html` (display-only heuristic,
  never a parser). Both reject NUL (binary) and oversize input and
  handle empty input.

Test command: `cd ~/workspace/omsuite && python3 -m unittest discover -s tests`
Before (this pass): 69 run, 68 pass, 0 fail, 1 skipped.
After: 118 run, 117 pass, 0 fail, 1 skipped (same pre-existing root
skip: test_permission_denied_on_readonly_dir — the new mode-bit
read-only tests DO run as root and pass). No existing test was
weakened; three new-test mistakes were fixed in the tests (a `json_minify`
parameter shadowing the function of the same name in the new dispatcher
— renamed to `minify`; a flag_bits fixture that `writestr` resets —
patched byte-wise; a fence expectation missing `&#x27;` escaping).

Still NOT tested / NOT implemented (honest):
- Permission-denied on a real non-root user (old skip), Windows
  file-locking, ENOSPC simulation, SAF/Kotlin ports, device runs.
- The forged-header runtime size counter: a forged archive is verified
  refused with no partial file, but via the CRC guard in the stdlib
  reader rather than the new byte counter (the counter is
  defense-in-depth for readers that don't enforce file_size).
- Multi-sheet XLSX, DOCX/PPTX, PDF merge/split/editing, RAR/7Z/TAR,
  EPUB writing, OCR, media transcoding: NOT implemented, and every one
  of these now has a clear UNSUPPORTED_FORMAT path where a caller could
  previously have hit a confusing error or a silent gap.
- No LICENSE file added; no secrets/tokens/keystores used or stored
  (grep over `shared/` + `tests/` for password/token/secret/keystore
  returns only the pre-existing YAML `token` variable and test prose).
