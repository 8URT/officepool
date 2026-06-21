#!/usr/bin/env bash
# Run on the droplet as root. Creates a deploy key so git pull works via SSH.
set -euo pipefail

APP_ROOT="${APP_ROOT:-/opt/officepool}"
KEY_PATH="${DEPLOY_KEY_PATH:-/root/.ssh/officepool_github}"
SSH_CONFIG="/root/.ssh/config"
REPO_SSH="git@github.com:8URT/officepool.git"

mkdir -p /root/.ssh
chmod 700 /root/.ssh

if [[ ! -f "$KEY_PATH" ]]; then
  echo "==> Generating GitHub deploy key at ${KEY_PATH}"
  ssh-keygen -t ed25519 -f "$KEY_PATH" -N "" -C "officepool-droplet-deploy"
fi

chmod 600 "$KEY_PATH"
chmod 644 "${KEY_PATH}.pub"

if ! grep -q "Host github.com" "$SSH_CONFIG" 2>/dev/null; then
  cat >> "$SSH_CONFIG" <<EOF

Host github.com
  HostName github.com
  User git
  IdentityFile ${KEY_PATH}
  IdentitiesOnly yes
EOF
  chmod 600 "$SSH_CONFIG"
fi

# Trust GitHub host key on first use
if ! grep -q "github.com" /root/.ssh/known_hosts 2>/dev/null; then
  ssh-keyscan -t ed25519 github.com >> /root/.ssh/known_hosts 2>/dev/null
  chmod 644 /root/.ssh/known_hosts
fi

if [[ -d "${APP_ROOT}/.git" ]]; then
  git -C "$APP_ROOT" remote set-url origin "$REPO_SSH"
  echo "==> Git remote set to ${REPO_SSH}"
else
  echo "==> Clone with: git clone ${REPO_SSH} ${APP_ROOT}"
fi

echo ""
echo "=== Add this deploy key to GitHub ==="
echo "Repo: https://github.com/8URT/officepool/settings/keys"
echo "Title: officepool-droplet"
echo "Allow write access: NO (read-only is enough for pull)"
echo ""
cat "${KEY_PATH}.pub"
echo ""
echo "After adding the key, test on the droplet:"
echo "  ssh -T git@github.com"
echo "  cd ${APP_ROOT} && git pull --ff-only"
