# OmSuite — Security

Date: 31 Oct 2026. Owner: stream 5. This file states the threat model,
what is implemented, and — equally important — what security checks were
**NOT** performed. A check that was not run is listed as Not Tested, never
implied to have passed.

## Threat model

OmSuite is a personal, local-first suite. The assets are the user's own
files and settings on their own devices. The product has no server, no
account, and no network transmission of user data, so the realistic
threats are:

1. **Untrusted files the user opens** — documents, images, archives, and
   downloaded files may be malformed or malicious. Processing is local,
   but a parser bug or a traversal flaw can still damage local files.
2. **Active content inside files** — macros, embedded scripts, HTML/JS,
   and archive entries that try to escape the destination folder.
3. **Accidental data loss** — overwrite, partial extraction, interrupted
   writes, or a delete the user did not mean.
4. **Accidental disclosure through distribution** — a secret, keystore,
   signing key, or personal document committed to the public repository
   or packed into a source ZIP.
5. **Supply-chain risk** — a compromised or vulnerable third-party
   dependency bundled into the app.
6. **Unsigned-distribution risk** — a user cannot verify an unsigned
   installer or a debug APK the way they could a signed release.

Out of scope for this phase (by product design, not by oversight): cloud
accounts, multi-user access control, and DRM bypass. DRM is never
bypassed for any e-book format.

## What is implemented

- **No network transmission of user data.** No cloud storage, sync,
  backup, collaboration, telemetry, or silent upload exists in either app
  (architecture-level exclusion, stream 1 D-13). Runtime product
  functionality does not depend on a cloud service. (Dependency downloads
  during development/CI are not product runtime behaviour.)
- **No account / login / subscription.** Nothing to phish, nothing to
  leak from an auth store.
- **Archive guards (shared reference + Windows core, unit-tested):**
  entry-name validation up front (rejects `../`, absolute paths, and
  drive-letter paths), symlink-entry rejection, decompression-bomb guards
  (ratio, entry-count, and single-file limits), extract-conflict policies
  (error/rename/skip — never silent overwrite), and progress reporting.
- **HTML is never executed in previews.** Markdown preview escapes HTML;
  `javascript:` links are blocked (Windows). HTML files are treated as
  untrusted text, not rendered as active pages.
- **Macros / embedded scripts are never auto-executed.** No macro engine
  exists in either app.
- **Safe writes where implemented:** temp-file + fsync + atomic replace
  (shared reference); atomic JSON settings store (Windows); overwrite
  confirmation in editors; copy/move never overwrite (Windows ` - Copy`
  naming); delete is permanent-with-confirmation (Windows) — a stated
  limit, not a silent behaviour.
- **File validation:** file signatures/structure are validated where the
  engines do so (JSON/XML validation, binary/NUL rejection for text,
  malformed-archive rejection). Extensions alone are never trusted as
  proof of content — and extension recognition is never advertised as
  editing support (see `FORMAT_SUPPORT.md`).
- **Repository hygiene:** `.gitignore` excludes keystores, signing
  properties, build outputs, and `node_modules/`; `scripts/secret-scan.sh`
  runs before every push and before packaging and refuses on any
  credential-shaped pattern or signing file; `scripts/package-source.sh`
  refuses to package if the scan fails and excludes build/dependency
  directories and any `LICENSE*` file.
- **No secrets in this tree (verified 31 Oct 2026):** a pattern scan over
  the source tree (excluding `.git/` and `node_modules/`) found no
  credential patterns and no keystore/signing files. The only
  "password"-word matches anywhere are doc comments inside
  `node_modules/@types/node/*.d.ts` (e.g. "Password used to generate
  key" in API documentation) — not credentials, and `node_modules/` is
  gitignored and excluded from source ZIPs. No `LICENSE` file exists
  anywhere in the tree (project licence: NOT YET SELECTED).
- **Signing honesty:** no release keystore, signing key, or password
  exists, is committed, or is recorded anywhere. The Android APK is
  debug-signed only; the Windows installer is unsigned. Neither is ever
  described as signed or as a release.

## What security checks were NOT performed

- **Security review / code audit:** Not Tested. No dedicated security
  review of either app has been run.
- **Dependency vulnerability audit:** Not Tested. No vulnerability scan
  (e.g. npm audit / Gradle dependency audit) result is recorded for this
  build. The dependency inventory is a stream-1 draft; resolved versions
  must be re-confirmed at integration time.
- **Malicious-file test corpus:** Not Tested. Archive guards are
  unit-tested against crafted fixtures (traversal, symlink, bomb-ratio
  fixtures in the shared tests), but no hostile-file corpus, fuzzing run,
  or archive-bomb test on a device has been executed.
- **Crash / power-interruption recovery:** Not Tested. Crash-during-write
  was not simulated (would need fault injection); the shared engine's
  atomic-write test verifies content preservation and temp cleanup on
  the error path only.
- **Permission-denied / read-only paths on a real non-root user:**
  Not Tested. The shared test for this is skipped because the dev VM runs
  as root (uid 0), which bypasses permission checks. Needs a non-root run
  or a device run.
- **Windows file-locking, insufficient-storage (ENOSPC), and
  low-storage paths:** Not Tested (cannot occur / not simulated on Linux).
- **Accessibility / screen-reader check:** Not Tested (not a security
  check, but recorded here so it is not lost).
- **Secret-scan limits:** the scan matches known credential patterns; it
  cannot prove the absence of a secret in an unrecognised form. If a
  secret is ever committed by accident, it must be revoked/rotated
  immediately — deleting it from the latest commit is not enough
  (Master Instructions §11).

## Data protection notes

- Only feature metadata is stored locally (recents, favourites, reading
  positions, settings, conversion history where implemented). Large user
  documents are not duplicated into the app database.
- Cache cleanup must never delete user-created documents (policy; the
  Windows cache-clear and Android clear-cache actions are scoped to app
  cache, and their Windows-device behaviour is Not Tested).
- Error messages must not expose sensitive paths unnecessarily (policy;
  not audited — see "NOT performed" above).
- Temporary files are cleaned after failed operations where the engines
  implement it; apps must clean `.<name>.*` temp files on startup
  (shared engine requirement L1).

## Signing-key handling (for the user, when release signing is set up)

- Keep the release keystore and its passwords **outside** the repository
  and outside source ZIPs, backed up securely by the user only.
- Never paste a keystore, password, or token into chat, a file, or a
  memory note. GitHub access for this project is via the secure connector
  route only — never via a token in chat.
- Do not silently substitute a debug key for a release key. A debug APK
  shared with anyone must be labelled "debug build".
