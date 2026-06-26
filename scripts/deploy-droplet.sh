#!/usr/bin/env bash
# Rebuild the knockout site (/wc2026final) on the droplet + refresh the backend.
# The existing /wc2026 group-stage site is never touched by this script.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WEB_ROOT="${WEB_ROOT:-/var/www/wc2026final}"
BASE_PATH="${BASE_PATH:-/wc2026final}"
DATA_LINK="${DATA_LINK:-/opt/officepool/data}"
VENV="${VENV:-$ROOT/.venv}"
API_SERVICE="${API_SERVICE:-officepool-api}"

# Backend: update venv deps, migrate/seed DB, refresh knockout export.
if [[ -x "$VENV/bin/python" ]]; then
  echo "==> Updating backend dependencies"
  "$VENV/bin/pip" install -q -r "$ROOT/backend/requirements.txt"

  echo "==> Migrating + seeding database"
  "$VENV/bin/python" -m backend.seed_users

  echo "==> Refreshing knockout export"
  "$VENV/bin/python" -m backend.export || true

  if systemctl list-unit-files 2>/dev/null | grep -q "${API_SERVICE}.service"; then
    echo "==> Restarting ${API_SERVICE}"
    systemctl restart "$API_SERVICE"
    sleep 1
    if ! systemctl is-active --quiet "$API_SERVICE"; then
      echo "ERROR: ${API_SERVICE} failed to start. Check: journalctl -u ${API_SERVICE} -n 30"
      exit 1
    fi
    import_code="$(curl -s -o /dev/null -w '%{http_code}' -X POST "http://127.0.0.1:8001/admin/ko/import-api" \
      -H "Content-Type: application/json" -d '{"upcoming_only":true}')"
    if [[ "$import_code" == "404" ]]; then
      echo "ERROR: API is missing /admin/ko/import-api — backend/ was not updated. Re-run pull-deploy-droplet.sh"
      exit 1
    fi
    echo "    API restarted (import-api HTTP ${import_code})"
  fi
else
  echo "==> Skipping backend steps (no venv at $VENV; run setup-droplet.sh first)"
fi

echo "==> Building static site"
BASE_PATH="$BASE_PATH" bash "$ROOT/scripts/prepare-site.sh" "$WEB_ROOT"

rm -rf "$WEB_ROOT/data"
ln -sf "$DATA_LINK" "$WEB_ROOT/data"

if id www-data &>/dev/null; then
  chown -R www-data:www-data "$WEB_ROOT"
fi

echo "Deployed to $WEB_ROOT (base=${BASE_PATH}, data -> ${DATA_LINK})"
