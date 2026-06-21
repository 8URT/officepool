#!/usr/bin/env bash
# Rebuild the static site on the droplet (preserves data/ symlink to live JSON).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WEB_ROOT="${WEB_ROOT:-/var/www/wc2026}"
BASE_PATH="${BASE_PATH:-/wc2026}"
DATA_LINK="${DATA_LINK:-/opt/officepool/data}"

BASE_PATH="$BASE_PATH" bash "$ROOT/scripts/prepare-site.sh" "$WEB_ROOT"

rm -rf "$WEB_ROOT/data"
ln -sf "$DATA_LINK" "$WEB_ROOT/data"

if id www-data &>/dev/null; then
  chown -R www-data:www-data "$WEB_ROOT"
fi

echo "Deployed to $WEB_ROOT (base=${BASE_PATH}, data -> ${DATA_LINK})"
