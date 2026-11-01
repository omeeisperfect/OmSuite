# OmSuite — Release Layout

Date: 31 Oct 2026. Owner: stream 5. This is the packaging layout from
Master Instructions §14, adapted to what actually exists. **Empty or
missing artifacts are listed as missing — never faked, never replaced
with placeholders.** Binaries are distributed via GitHub Releases (or a
direct delivery ZIP) with checksums, not committed as ordinary source.

```
OmSuite_Final_Delivery/
  Android/
    OmSuite-debug.apk            MISSING — CI has never run (no repository yet)
    OmSuite-release.apk          MISSING — no release signing exists; do not
                                 substitute the debug APK for this file
    Android_Source.zip           MISSING — produced at handover by
                                 scripts/package-source.sh (source ZIP covers
                                 the whole tree; see note below)
    BUILD_INSTRUCTIONS.md        PRESENT (as docs/BUILD_STATUS.md + README.md)
    SIGNING_GUIDE.md             MISSING — to be written when release signing
                                 is set up (BLOCKERS.md B-6); must never
                                 contain key material
  Windows/
    OmSuite-Setup.exe            MISSING — local NSIS build failed (Wine);
                                 CI has never run (no repository yet)
    Windows_Source.zip           MISSING — see Android_Source.zip note
    BUILD_INSTRUCTIONS.md        PRESENT (as docs/BUILD_STATUS.md + README.md)
  Documentation/
    ARCHITECTURE.md              PRESENT (docs/, stream 1)
    DEPENDENCIES_AND_LICENSES.md PRESENT (docs/, stream 1, draft)
    FORMAT_SUPPORT.md            PRESENT (docs/, stream 1)
    SECURITY.md                  PRESENT (docs/, stream 5)
    KNOWN_LIMITATIONS.md         PRESENT (docs/, stream 5)
    FINAL_STATUS.md              PRESENT (docs/, stream 5)
    README.md                    PRESENT (docs/, stream 5)
    IMPLEMENTATION_STATUS.md     PRESENT (docs/, stream 5)
    BUILD_STATUS.md              PRESENT (docs/, stream 5)
    BLOCKERS.md                  PRESENT (docs/, stream 5)
    MASTER_PLAN.md               PRESENT (docs/, stream 1)
    DECISION_LOG.md              PRESENT (docs/, stream 1)
    THIRD_PARTY_NOTICES          MISSING — required at packaging time; must
                                 contain the full licence texts/notices for
                                 every bundled component (stream 1 inventory
                                 is a draft and must be resolved first)
  OmSuite_Final_Delivery.zip     MISSING — assembled at handover only, from
                                 real artifacts + real checksums
```

## Notes

- One source ZIP covers the whole tree (both platforms + shared + docs);
  per-platform `*_Source.zip` names in the Master Instructions layout map
  to that single ZIP plus a note of which directories belong to which
  platform. Do not create two divergent ZIPs.
- `scripts/package-source.sh` excludes `.git/`, `node_modules/`, `dist/`,
  `build/`, `__pycache__/`, `.gradle/`, keystores, and any `LICENSE*`
  file, and refuses to run if `scripts/secret-scan.sh` fails.
- Checksums: every release file gets a `.sha256` sidecar produced by
  `scripts/checksums.sh`. No checksum is recorded for a file that does
  not exist.
- Signing: no keystore, signing key, or password ever goes into the
  delivery ZIP, the repository, or this document.
- Licence: no `LICENSE` file is shipped until the user selects the
  project licence (BLOCKERS.md B-5).
