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
PUBLISH="${PUBLISH_SCORES:-0}"
echo "Watching scores every ${INTERVAL}s (Ctrl+C to stop)"
if [[ "$PUBLISH" == "1" ]]; then
  echo "WARNING: PUBLISH_SCORES=1 pushes to GitHub. Production sync runs on the droplet — leave this off."
  echo "Publishing score updates to GitHub (PUBLISH_SCORES=1)"
fi
while true; do
  python3 scripts/sync-scores.py || true
  if [[ "$PUBLISH" == "1" ]]; then
    bash scripts/publish-scores.sh || true
  fi
  sleep "$INTERVAL"
done
