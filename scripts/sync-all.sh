#!/usr/bin/env bash
# Cron entrypoint (every minute): refresh group-stage scores and knockout data.
# Group sync uses stdlib only (system python). Knockout export uses the venv.
set -uo pipefail

APP_ROOT="${APP_ROOT:-/opt/officepool}"
VENV="${VENV:-$APP_ROOT/.venv}"
cd "$APP_ROOT"

# Group-stage scores (writes data/scores.json + rank-snapshots.json).
/usr/bin/python3 scripts/sync-scores.py

# Knockout results + public export (writes data/knockout.json).
if [[ -x "$VENV/bin/python" ]]; then
  "$VENV/bin/python" -m backend.export || true
fi
