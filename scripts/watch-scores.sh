#!/usr/bin/env bash
# Re-run score sync every 60s during match days (local dev).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if [[ -f .env ]]; then
  set -a
  # shellcheck disable=SC1091
  source .env
  set +a
fi

INTERVAL="${1:-60}"
echo "Watching scores every ${INTERVAL}s (Ctrl+C to stop)"
while true; do
  python3 scripts/sync-scores.py || true
  sleep "$INTERVAL"
done
