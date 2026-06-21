#!/usr/bin/env bash
# Print a one-liner to paste on the droplet (root SSH session).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

if [[ -f "$ROOT/.env" ]]; then
  set -a
  # shellcheck disable=SC1091
  source "$ROOT/.env"
  set +a
fi

if [[ -z "${API_FOOTBALL_KEY:-}" ]]; then
  echo "Set API_FOOTBALL_KEY in .env first."
  exit 1
fi

cat <<EOF
# Paste on the droplet as root:
export API_FOOTBALL_KEY='${API_FOOTBALL_KEY}'
curl -fsSL https://raw.githubusercontent.com/8URT/officepool/main/scripts/setup-droplet.sh | bash
EOF
