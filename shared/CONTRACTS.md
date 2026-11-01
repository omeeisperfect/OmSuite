# OmSuite Shared Contracts (language-neutral)

These contracts are the stable interface between the Android (Kotlin/Compose)
and Windows apps and the processing core. The Python modules in this directory
are the **reference implementation**; the apps must implement the same
observable behaviour in their own language, not just the same function names.

## 0. Global rules

- **Real files only.** No hardcoded sample filesystem, no canned success.
  Every operation reports what actually happened on disk.
- **No silent overwrite, ever.** Any operation that would replace an existing
  file must resolve the conflict explicitly (see §1).
- **Errors are values with stable codes**, not free-text strings. Codes:
  `NOT_FOUND`, `ALREADY_EXISTS`, `PERMISSION_DENIED`, `READ_ONLY`,
  `INSUFFICIENT_STORAGE`, `MALFORMED_INPUT`, `OVERSIZED_INPUT`,
  `UNSAFE_PATH`, `CONFLICT`, `UNSUPPORTED_FORMAT`, `OMSUITE_ERROR`.
- **Untrusted input.** File contents and archive members are data, never
  code: no macro/script execution, no HTML script execution in previews.
  Previews must HTML-escape text before display.
- **Limits are parameters, not magic.** Every size/count limit in the
  reference code has a named default; apps must expose the same knobs.

## 1. Conflict resolution

Policies: `error` (default — refuse), `rename`, `overwrite`, `skip`.

- `rename` for a file `report.txt` produces `report (2).txt`, then
  `report (3).txt`, … (stem + ` (N)` + suffix).
- `duplicate` produces `report (copy).txt`, then `report (copy) (2).txt`, …
  Its default policy is `rename`, not `error`.
- `skip` performs nothing and reports "skipped" — it must not report success
  as if the file was written.
- `overwrite` is only legitimate for an explicit user save (e.g. pressing
  Save in the editor). Copy/move/create/archive-extract default to `error`.

## 2. File operations (`file_core`)

- `list_dir(dir, sort=name|size|mtime|type, descending, include_hidden)`:
  one directory, non-recursive. Hidden = name starts with `.`. Directories
  report size 0 (size is only meaningful for files).
- `search(dir, query, recursive, search_content, case_sensitive, max_results)`:
  name match always; content match only for files that decode as UTF-8 and
  are under the content size cap. Binary files are skipped. Symlinked
  directories are not followed. Unreadable subdirectories are skipped, not
  fatal.
- `copy / move / rename / duplicate / delete`: as in the reference code.
  `delete` on a directory requires `recursive=true`. Symlinks are unlinked,
  never followed, and are refused as copy/archive sources.
- `validate_name`: rejects empty, `.`, `..`, separators, NUL, trailing
  space/dot, and Windows reserved device names (`CON`, `PRN`, `AUX`, `NUL`,
  `COM1–9`, `LPT1–9`).
- `atomic_write(path, data, policy)`: temp file in the SAME directory,
  flush + fsync, then atomic replace. On failure the temp file is removed
  and the old file is untouched. Permission bits of a replaced file are
  preserved where the platform allows.

## 3. Archive operations (`archive_core`) — ZIP only

- `browse(archive)`: list members (name, uncompressed size, compressed
  size, is_dir) without extracting. All safety checks run here too.
- `extract(archive, dest, selected?, policy, progress?)` / `extract_all`:
  `selected` names must all exist or the call fails before writing.
- Safety, enforced BEFORE any byte is written: reject absolute paths,
  `..` components, drive letters, backslash traversal, and symlink entries.
  Bomb limits (defaults): max 10,000 entries, 1 GiB total uncompressed,
  512 MiB per entry, compression ratio 200:1.
- `create(archive, sources, policy, progress?)`: directories stored
  recursively under their own name (`docs/a.txt`). Symlink sources refused.
- `progress(done, total, name)` is called after each entry; an exception
  inside it aborts the operation.
- RAR / 7Z: NOT in this contract (no verified engine). Any app claiming
  them must add its own tested engine first.

## 4. Text / document operations (`text_core`)

- Formats: TXT, MD, JSON, XML, YAML-subset (see below). DOCX / XLSX /
  PPTX / PDF / EPUB are NOT in this contract.
- `read_text` returns: text, encoding (`utf-8`, `utf-8-sig`, or `latin-1`
  fallback with a warning), dominant newline (`\n`, `\r\n`, `\r`, or empty),
  BOM flag, warnings (mixed endings, latin-1 fallback).
- `write_text` preserves the original BOM and newline unless the caller
  overrides them. Files containing a NUL byte are rejected as binary.
- JSON: `validate_json` / `format_json` (pretty with indent, or minify).
  Duplicate object keys are warned (last value wins — data loss, surfaced).
- XML: well-formedness validation + pretty-print. Fidelity limit:
  re-serialization DROPS comments, processing instructions and DOCTYPE —
  the warning must be shown; never present it as lossless.
- YAML subset: block mappings (2-space indent), block sequences, plain /
  single- / double-quoted scalars, int / float / bool / null, comments.
  Explicitly rejected (error, never silent mis-parse): anchors, aliases,
  tags, multi-document files, block scalars (`|`, `>`), flow collections,
  duplicate keys, non-2-space indents.

## 5. Conversions (`convert_core`)

Every conversion returns `(output_text, warnings)`. Warnings describe
fidelity loss and MUST be shown to the user.

| Conversion | Fidelity |
|---|---|
| TXT → MD | Lossless for plain text; warns on lines that Markdown would render as structure (`# `, lists, fences). |
| MD → TXT | Lossy: headings, emphasis, code fences, link/image URLs, table separators dropped — each warned. Content inside fences is kept. |
| JSON pretty / minify | Lossless except duplicate keys (warned). |
| CSV → JSON | All values stay strings (no type guessing: `007` stays `"007"`). Ragged rows padded/truncated with warnings; duplicate headers warned. |
| JSON → CSV | Requires an array of objects. Missing keys → empty cells (warned); later-only keys extend the header; nested values serialized as compact JSON (warned). |
| CSV → MD table | `\|` in cells escaped as `\\|`. |
| MD table → CSV | Requires header + separator rows; non-table lines ignored (warned); ragged rows padded/truncated (warned). |

NOT in this contract: DOCX / XLSX / PPTX / PDF / EPUB / image / audio /
video conversion, OCR. Those need their own verified engines first.

## 6. Spreadsheets (`sheet_core`)

- Addressing: A1 notation, columns A..XFD, rows 1..1048576. Values are
  numbers, booleans, text, or formulas (text starting with `=`).
- Formulas: `+ - * /`, parentheses, unary minus, cell refs, `SUM` and
  `AVERAGE` over ranges (`A1:A5`). No other functions, no string
  literals in formulas. Empty cells read as 0 in formulas; text in a
  `SUM`/`AVERAGE` range is ignored; text in `+ - * /` is an error.
- `recalculate()` returns `(values, errors)`: circular references
  (code `CYCLE`) and other formula errors are reported per cell, never
  hang, never hide healthy cells.
- CSV: load stores cells as text (except `=` formulas); save writes a
  rectangular grid; booleans as TRUE/FALSE. Numbers reload as strings
  (formula coercion still computes them).
- XLSX: single worksheet only, no styles/dates/merged cells; formulas
  preserved as text and recomputed; other producers' cached values are
  ignored on read.

## 7. EPUB reading (`epub_core`)

- Follow `META-INF/container.xml` to the OPF, read manifest + spine in
  order; non-linear spine items are skipped and reported. Missing
  container / OPF / spine / chapter files are errors, never silent
  skips. Chapter text: tags stripped, paragraphs preserved, script /
  style content dropped. No EPUB writing, no DRM.

## 8. PDF text, best-effort (`pdf_core`)

- Content streams only; `FlateDecode` via zlib; `Tj` / `TJ` / `'` / `"`
  operators; literal + hex strings, common escapes, UTF-16BE BOM.
  `Td`/`TD`/`T*` insert a newline (best-effort line breaks).
  NO layout reconstruction, NO font/`ToUnicode` decoding, NO object /
  xref streams, NO encryption, NO scanned-image text (OCR is separate).
  Empty result means "no decodable text found", not "PDF is empty".

## 9. Slides (`slide_core`)

- Deck model: add / insert / delete / move slides (title, body,
  optional image path). HTML export is one file with inline CSS and
  escaped user text. Images embed as data URIs only when the file
  exists, is png/jpg/gif/webp and is under the size cap; otherwise a
  warning is returned and the image is referenced or dropped. No PPTX
  import/export, no animations, no speaker notes.

## 10. Deliberately NOT shared

Permission models differ too much to share safely, so these stay
platform-native (see README.md §3): Android SAF document access and
permission grants, Windows Recycle Bin / file locking semantics, trash
behaviour, and per-app storage locations. The engines above operate on
paths/handles the app has already secured; they never request permissions
themselves.
