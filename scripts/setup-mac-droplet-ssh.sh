#!/usr/bin/env bash
# Run on your Mac. Prints your SSH public key and a one-liner for the droplet.
set -euo pipefail

KEY="${SSH_PUBKEY_PATH:-$HOME/.ssh/id_ed25519.pub}"

if [[ ! -f "$KEY" ]]; then
  echo "No key at $KEY — generate one with: ssh-keygen -t ed25519"
  exit 1
fi

PUBKEY="$(cat "$KEY")"
HOST="${DROPLET_HOST:-146.190.102.191}"
USER="${DROPLET_USER:-root}"

echo "Your Mac public key:"
echo "$PUBKEY"
echo ""
echo "=== Paste this on the droplet (as root) ==="
echo ""
cat <<EOF
mkdir -p ~/.ssh && chmod 700 ~/.ssh
grep -qF '${PUBKEY}' ~/.ssh/authorized_keys 2>/dev/null || echo '${PUBKEY}' >> ~/.ssh/authorized_keys
chmod 600 ~/.ssh/authorized_keys
echo "Mac SSH key added."
EOF
echo ""
echo "=== Then from your Mac, test SSH ==="
echo "ssh ${USER}@${HOST}"
echo ""
echo "=== Optional: passwordless deploy from Mac ==="
echo "bash scripts/install-droplet-remote.sh   # first-time full setup"
echo "ssh ${USER}@${HOST} 'cd /opt/officepool && bash scripts/pull-deploy-droplet.sh'"
