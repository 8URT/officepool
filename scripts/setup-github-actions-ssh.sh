#!/usr/bin/env bash
# Run on your Mac. Creates an SSH key for GitHub Actions → droplet deploy.
set -euo pipefail

KEY_DIR="${HOME}/.ssh"
KEY_PATH="${KEY_DIR}/officepool_gha_deploy"
HOST="${DROPLET_HOST:-146.190.102.191}"
USER="${DROPLET_USER:-root}"

mkdir -p "$KEY_DIR"
chmod 700 "$KEY_DIR"

if [[ ! -f "$KEY_PATH" ]]; then
  echo "==> Generating GitHub Actions deploy key at ${KEY_PATH}"
  ssh-keygen -t ed25519 -f "$KEY_PATH" -N "" -C "officepool-github-actions"
fi

echo ""
echo "=== Step 1: Add public key to the droplet ==="
echo "Paste on the droplet as root:"
echo ""
PUBKEY="$(cat "${KEY_PATH}.pub")"
cat <<EOF
mkdir -p ~/.ssh && chmod 700 ~/.ssh
grep -qF '${PUBKEY}' ~/.ssh/authorized_keys 2>/dev/null || echo '${PUBKEY}' >> ~/.ssh/authorized_keys
chmod 600 ~/.ssh/authorized_keys
EOF
echo ""
echo "=== Step 2: Add GitHub repository secrets ==="
echo "https://github.com/8URT/officepool/settings/secrets/actions"
echo ""
echo "DROPLET_HOST = ${HOST}"
echo "DROPLET_USER = ${USER}"
echo "DROPLET_SSH_KEY = (private key below — copy entire block including BEGIN/END)"
echo "API_FOOTBALL_KEY = (your existing API key secret)"
echo ""
echo "--- DROPLET_SSH_KEY (private) ---"
cat "$KEY_PATH"
echo "--- end private key ---"
echo ""
echo "=== Step 3: Test from Mac ==="
echo "ssh -i ${KEY_PATH} ${USER}@${HOST} 'hostname'"
echo ""
echo "=== Step 4: Trigger deploy ==="
echo "Push to main (or run 'Deploy to droplet' workflow manually on GitHub)."
