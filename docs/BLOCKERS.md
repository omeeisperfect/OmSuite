# OmSuite — Blockers

Date: 31 Oct 2026. Owner: stream 5. Each blocker states its impact, the
alternatives considered, the exact user action required (if any), and its
current state. Nothing here is a request for a routine approval — only
items that genuinely require user authority or a GitHub-side permission
are addressed to the user.

## B-1 — Local Gradle/Android build is platform-blocked (no user action)

- **Impact:** No Android build, unit-test run, or compile check can be
  executed on the development VM. The Android app's compile is unproven
  and its 14 unit tests are Not Tested until CI runs.
- **Evidence:** `which java kotlin gradle` → no output;
  `ls /usr/lib/jvm` → `No such file or directory`. The coordinator plan
  records the underlying cause as Java loopback timeouts plus a missing
  `/etc/ssl/certs/java/cacerts`.
- **Alternatives considered:** (a) Downloading/installing a JDK under
  `~/workspace/` — not attempted, because the recorded block is a
  platform restriction, not a missing download, and CI is the designated
  route. (b) Hand-editing Kotlin to "fix" unproven compile issues —
  rejected: stream 2 explicitly warns against blind edits; CI errors are
  fixed against real compiler output.
- **Chosen path:** GitHub Actions CI (`.github/workflows/android.yml`,
  ubuntu-latest, JDK 17) is the Android build route.
- **Required user action:** None for this blocker itself. (CI can only
  run once blocker B-3, the missing repository, is resolved.)
- **Current state:** Open, worked around via CI. Not a project defect.

## B-2 — Windows NSIS installer cannot be built on the Linux VM (no user action)

- **Impact:** No Windows installer exists. The installer, its size, and
  its install flow are all Not Tested. A recipient-PC install test (the
  real acceptance test for the Windows app) cannot happen until an
  installer is produced.
- **Evidence (exact):** `electron-builder@26.18.0 --win nsis --x64` →
  `wine process failed ENOENT` / `Exit code: ENOENT. spawn wine ENOENT`.
  Two attempts both reached `dist/win-unpacked/` (357 MB) before the NSIS
  step failed. `which wine` → no output. The partial 190,333-byte
  `OmSuite-Setup-0.1.0.exe` and the unpacked directory were deleted so no
  partial artifact can be mistaken for a real installer.
- **Alternatives considered:** (a) Installing Wine system-wide — not
  attempted (outside stream 3's scope, and would still leave the
  installer unverified on Windows). (b) Shipping the unpacked directory
  — rejected (it was never run, and an unpacked folder is not an
  installer). (c) A Linux-built installer via another packager — rejected
  as unverifiable theatre for the same reason.
- **Chosen path:** Build on a Windows machine
  (`scripts/build-windows.ps1`, Windows 10/11 x64, Node.js 20+) or via
  GitHub Actions CI (`.github/workflows/windows.yml`, windows-latest
  runner, which has native Windows tooling).
- **Required user action:** None for this blocker itself. (CI can only
  run once blocker B-3 is resolved; a Windows-machine build needs a
  Windows PC, which the user has, but no step is requested yet.)
- **Current state:** Open, worked around via CI/Windows-machine route.

## B-3 — Public GitHub repository does not exist yet; creation approval pending (USER ACTION REQUIRED)

- **Impact:** Nothing can be pushed, no CI workflow can run, no release
  can be published, and the Master Instructions' "public GitHub
  repository" handover item is unmet. All local work (docs, workflows,
  scripts, both apps, shared engines) is complete on disk but unpublished.
- **Evidence (31 Oct 2026, ~22:35 IST):**
  - GitHub connector status: `connected`, authenticated as
    `omeeisperfect` (github.com/omeeisperfect).
  - Repository search `OmSuite user:omeeisperfect` → `total_count: 0`.
    No OmSuite repository exists under the user's account, so no
    duplicate would be created. (The only public matches for "OmSuite"
    are unrelated third-party repositories: `Thatchlabs/OMsuite`
    (TypeScript, 2023) and `stranix79/omsaver`.)
  - A `create_repository` call (public, name `OmSuite`) was attempted via
    the connector only — never via a token in chat. The call did not
    complete: the service restarted mid-call, and the request is now
    **pending approval** (approval id
    `connector-2e7a32c5-c961-47dc-9ffd-ac545895d6b2`, requested
    2026-10-31T17:21:50Z). A re-check after the restart confirmed the
    repository was **not** created.
- **Alternatives considered:** (a) Retrying creation in a loop — rejected
  (the request is already pending a decision; re-issuing it risks a
  duplicate). (b) Asking the user for a GitHub token in chat — **never**:
  prohibited by the Master Instructions, the coordinator plan, and the
  user's own standing decision (D-57 D1: token chat mein NAHI). (c) Using
  a local git remote or another host — rejected: the Master Instructions
  require the public GitHub repository, and local work continues
  regardless.
- **Required user action (exactly one step):** Approve the pending
  GitHub request to create a public repository named `OmSuite` (or, if
  the approval card has expired, re-authorise repository creation through
  the normal connector flow when prompted). Nothing else is needed from
  the user for this blocker — no token, no password, no settings change.
- **Current state:** BLOCKED on that approval. Local work is unaffected
  and continues. Once the repository exists, stream 5's push attempt (see
  B-4) proceeds via the connector only.

## B-4 — Push write permission is unproven and may be missing (conditional; check only if a push fails with 403)

- **Impact if it occurs:** Even with a repository, source cannot be
  published from this environment, and CI still cannot run (CI lives in
  the repository).
- **Evidence:** This is a **known risk, not yet an OmSuite outcome**. A
  prior push for a *different* repository (omnexa-launcher) failed with
  HTTP 403 `Resource not accessible by integration` on the git/trees
  POST, even though reads worked — which indicates the GitHub App
  installation may lack Contents write permission. No OmSuite push has
  been attempted yet (there is no repository to push to), so this
  failure has **not** been reproduced for OmSuite.
- **Alternatives considered:** If a push fails with the same 403: STOP
  pushing immediately, do not retry in a loop, do not ask for a token in
  chat, record the exact error, continue all local work, and report it
  as the terminal blocker. No alternative push route (token, `gh auth`,
  device flow) is acceptable.
- **Required user action (only if the 403 occurs):** Exactly one
  GitHub-side check — GitHub → Settings → Applications → Meta Muse AI →
  Contents: **Read and write**. No token, no password, no repository
  setting beyond that permission.
- **Current state:** Not yet triggered. Awaiting B-3 (repository
  creation) before any push is attempted.

## B-5 — Project licence not yet selected (USER DECISION REQUIRED, not blocking builds)

- **Impact:** No `LICENSE` file exists, and no doc, README, release note,
  or package metadata may claim OmSuite is MIT/Apache/GPL licensed or
  that reuse is permitted. Public repository visibility does not grant
  reuse permission. This does not block building, testing, or pushing
  source — it blocks only the licence claim and the final release
  labelling.
- **Alternatives considered:** Inventing a licence — prohibited
  (Master Instructions §§7, 11; stream 1 D-10). Every candidate licence's
  consequences must be explained before the user chooses.
- **Required user action:** Choose the project licence (or explicitly
  defer the choice). Until then the status stays "not yet selected".
- **Current state:** Open, awaiting the user's decision. Third-party
  licences still apply in full regardless (see
  `DEPENDENCIES_AND_LICENSES.md`).

## B-6 — Release signing not set up (USER ACTION REQUIRED before any release)

- **Impact:** No signed release can be produced on either platform. The
  Android APK is debug-signed only; the Windows installer is unsigned
  (SmartScreen will warn). Neither may be distributed as a release.
- **Alternatives considered:** Committing a keystore or a debug key as a
  release key — prohibited and rejected. Using a temporary debug key
  silently — prohibited and rejected.
- **Required user action (only when a real release is wanted):** Create
  and safeguard a release keystore/certificate outside the repository
  (and, for Windows, a code-signing certificate), following the secure
  backup instructions that will accompany the release. No key material
  is ever to be pasted into chat or committed.
- **Current state:** Open, by design for this phase. Debug/unsigned
  artifacts are honestly labelled as such wherever they appear.
