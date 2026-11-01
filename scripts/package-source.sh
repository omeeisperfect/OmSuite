#!/usr/bin/env bash
# OmSuite source packaging — build a source ZIP + SHA-256 checksum.
# Refuses to run if the secret scan fails. Never includes: .git,
# node_modules, dist/, build/, __pycache__, keystores, or any LICENSE
# file (the project licence is NOT YET SELECTED — see docs/BLOCKERS.md).
# Usage: ./scripts/package-source.sh [output-dir]   (default: ./release)
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="${1:-$ROOT/release}"
mkdir -p "$OUT"
"$ROOT/scripts/secret-scan.sh" "$ROOT"
STAMP="$(date +%Y%m%d)"
ZIP="$OUT/OmSuite-source-$STAMP.zip"
rm -f "$ZIP" "$ZIP.sha256"
cd "$ROOT"
# zip the tracked source layout only; excludes are belt-and-braces.
zip -r -q "$ZIP" apps shared docs scripts tests .github .gitignore \
  -x '*/node_modules/*' '*/dist/*' '*/build/*' '*/__pycache__/*' \
     '*/.gradle/*' '*.keystore' '*.jks' '*.p12' '*.pfx' 'LICENSE*'
sha256sum "$ZIP" > "$ZIP.sha256"
echo "Wrote: $ZIP"
cat "$ZIP.sha256"
