#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="${1:-$ROOT/_site}"
BASE_PATH="${BASE_PATH:-}"

rm -rf "$OUT"
mkdir -p "$OUT"

cp "$ROOT/index.html" "$ROOT/admin.html" "$ROOT/favicon.svg" "$ROOT/.nojekyll" "$OUT/"
cp -r "$ROOT/css" "$ROOT/js" "$ROOT/data" "$OUT/"

sed_inplace() {
  if [[ "$OSTYPE" == darwin* ]]; then sed -i '' "$1" "$2"; else sed -i "$1" "$2"; fi
}

ASSET_VERSION="$(git -C "$ROOT" rev-parse --short HEAD 2>/dev/null || date -u +%Y%m%d%H%M%S)"
for page in index.html admin.html; do
  [[ -f "$OUT/$page" ]] || continue
  sed_inplace "s|js/app.js|js/app.js?v=${ASSET_VERSION}|" "$OUT/$page"
  sed_inplace "s|js/auth.js|js/auth.js?v=${ASSET_VERSION}|" "$OUT/$page"
  sed_inplace "s|js/admin.js|js/admin.js?v=${ASSET_VERSION}|" "$OUT/$page"
  if [[ -n "$BASE_PATH" ]]; then
    BASE_HREF="${BASE_PATH%/}/"
    sed_inplace "s|<head>|<head>\\n  <base href=\"${BASE_HREF}\">|" "$OUT/$page"
  fi
done

echo "Site prepared at $OUT (v=${ASSET_VERSION}${BASE_PATH:+, base=${BASE_PATH}})"
