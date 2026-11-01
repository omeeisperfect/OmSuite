#!/usr/bin/env bash
# OmSuite secret scan — run before every push and before packaging.
# Exits non-zero if a credential-shaped pattern is found in the source
# tree. node_modules/ and .git/ are excluded: dependency type-definition
# files contain the word "password" in doc comments, which is not a
# credential; every other match is treated as a real finding.
# Usage: ./scripts/secret-scan.sh [tree-root]   (default: repo root)
set -euo pipefail
ROOT="${1:-$(cd "$(dirname "$0")/.." && pwd)}"
echo "Scanning: $ROOT"
PATTERN='(ghp_[A-Za-z0-9]{20,}|gho_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----|AKIA[0-9A-Z]{16})'
FOUND=0
if grep -rInE --exclude-dir=.git --exclude-dir=node_modules --exclude-dir=__pycache__ "$PATTERN" "$ROOT" ; then
  FOUND=1
fi
# Keystore / signing files must never be present, whatever their content.
if find "$ROOT" \( -name '*.keystore' -o -name '*.jks' -o -name '*.p12' -o -name '*.pfx' -o -name 'keystore.properties' \) \
     -not -path '*/node_modules/*' -not -path '*/.git/*' -print | grep -q . ; then
  echo "FOUND signing files (see above)"; FOUND=1
fi
if [ "$FOUND" -eq 1 ]; then
  echo "SECRET SCAN: FAILED — do not push or package until findings are removed and any exposed credential is revoked/rotated."
  exit 1
fi
echo "SECRET SCAN: CLEAN (no credential patterns, no signing files)"
