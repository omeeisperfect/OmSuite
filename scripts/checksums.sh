#!/usr/bin/env bash
# OmSuite checksums — print SHA-256 for every file given, or for every
# file in a release directory. Usage:
#   ./scripts/checksums.sh FILE [FILE ...]
#   ./scripts/checksums.sh --dir release/
set -euo pipefail
if [ "${1:-}" = "--dir" ]; then
  cd "$2"
  sha256sum ./* 2>/dev/null || { echo "No files in $2"; exit 1; }
else
  sha256sum "$@"
fi
