#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="${1:-$ROOT/_site}"

rm -rf "$OUT"
mkdir -p "$OUT"

cp "$ROOT/index.html" "$ROOT/favicon.svg" "$ROOT/.nojekyll" "$OUT/"
cp -r "$ROOT/css" "$ROOT/js" "$ROOT/data" "$OUT/"

echo "Site prepared at $OUT"
