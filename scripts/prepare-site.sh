#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="${1:-$ROOT/_site}"

rm -rf "$OUT"
mkdir -p "$OUT"

cp "$ROOT/index.html" "$ROOT/favicon.svg" "$ROOT/.nojekyll" "$OUT/"
cp -r "$ROOT/css" "$ROOT/js" "$ROOT/data" "$OUT/"

ASSET_VERSION="$(git -C "$ROOT" rev-parse --short HEAD 2>/dev/null || date -u +%Y%m%d%H%M%S)"
if [[ "$OSTYPE" == darwin* ]]; then
  sed -i '' "s|js/app.js|js/app.js?v=${ASSET_VERSION}|" "$OUT/index.html"
else
  sed -i "s|js/app.js|js/app.js?v=${ASSET_VERSION}|" "$OUT/index.html"
fi

echo "Site prepared at $OUT (app.js?v=${ASSET_VERSION})"
