#!/usr/bin/env bash
# Run from your Mac terminal (password SSH OK). Installs WC pool on the droplet.
set -euo pipefail

HOST="${DROPLET_HOST:-146.190.102.191}"
USER="${DROPLET_USER:-root}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

if [[ -f "$ROOT/.env" ]]; then
  set -a
  # shellcheck disable=SC1091
  source "$ROOT/.env"
  set +a
fi

if [[ -z "${API_FOOTBALL_KEY:-}" ]]; then
  echo "Set API_FOOTBALL_KEY in .env or export it before running."
  exit 1
fi

echo "Connecting to ${USER}@${HOST} (enter password if prompted)..."
ssh -o StrictHostKeyChecking=accept-new "${USER}@${HOST}" \
  "export API_FOOTBALL_KEY='${API_FOOTBALL_KEY}'; bash -s" < "$ROOT/scripts/setup-droplet.sh"

echo ""
echo "Verifying https://8urt.net/wc2026/ ..."
curl -sI "https://8urt.net/wc2026/" | head -3
curl -sI "https://8urt.net/wc2026/data/scores.json" | head -3
