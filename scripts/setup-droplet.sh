#!/usr/bin/env bash
# Setup for https://8urt.net/wc2026final (knockout app with login + admin).
# The existing https://8urt.net/wc2026 (group-stage app) is left untouched.
# Run as root: bash scripts/setup-droplet.sh
set -euo pipefail

REPO_URL="${REPO_URL:-}"
APP_ROOT="${APP_ROOT:-/opt/officepool}"
WEB_ROOT="${WEB_ROOT:-/var/www/wc2026final}"
BASE_PATH="${BASE_PATH:-/wc2026final}"
LOG_FILE="${LOG_FILE:-/var/log/wc-pool-sync.log}"
CRON_MARKER="# wc-pool-sync"
DEPLOY_KEY_PATH="${DEPLOY_KEY_PATH:-/root/.ssh/officepool_github}"

if [[ -z "$REPO_URL" ]]; then
  if [[ -f "$DEPLOY_KEY_PATH" ]]; then
    REPO_URL="git@github.com:8URT/officepool.git"
  else
    REPO_URL="https://github.com/8URT/officepool.git"
  fi
fi

echo "==> Installing packages"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq git python3 python3-venv python3-pip curl

echo "==> Cloning or updating app at ${APP_ROOT} (${REPO_URL})"
if [[ -d "${APP_ROOT}/.git" ]]; then
  git -C "$APP_ROOT" pull --ff-only
else
  git clone "$REPO_URL" "$APP_ROOT"
fi

# Offer GitHub SSH setup hint if still on HTTPS
if [[ -f "${APP_ROOT}/.git/config" ]] && grep -q 'https://github.com' "${APP_ROOT}/.git/config" 2>/dev/null; then
  echo "    Tip: run bash scripts/setup-droplet-github-ssh.sh for SSH git pull"
fi

cd "$APP_ROOT"

if [[ -n "${API_FOOTBALL_KEY:-}" ]]; then
  printf 'API_FOOTBALL_KEY=%s\n' "$API_FOOTBALL_KEY" > .env
  chmod 600 .env
fi

if [[ ! -f .env ]]; then
  cp .env.example .env
  echo ""
  echo "ERROR: Add your API_FOOTBALL_KEY to ${APP_ROOT}/.env then re-run this script."
  echo "  nano ${APP_ROOT}/.env"
  exit 1
fi

if ! grep -q '^API_FOOTBALL_KEY=.\+' .env 2>/dev/null; then
  echo "ERROR: API_FOOTBALL_KEY is missing in ${APP_ROOT}/.env"
  exit 1
fi

chmod 600 .env

# --- Knockout backend secrets -------------------------------------------------
if ! grep -q '^APP_SECRET=' .env; then
  printf 'APP_SECRET=%s\n' "$(head -c 32 /dev/urandom | base64 | tr -d '/+=' | head -c 43)" >> .env
  echo "    Generated APP_SECRET"
fi
if ! grep -q '^ADMIN_USERNAME=' .env; then
  printf 'ADMIN_USERNAME=%s\n' "${ADMIN_USERNAME:-admin}" >> .env
  echo "    Set ADMIN_USERNAME=${ADMIN_USERNAME:-admin}"
fi
# Session cookie must be scoped to this site's base path, else the browser
# won't send it back to /<base>/api/ and logins won't persist.
if grep -q '^COOKIE_PATH=' .env; then
  sed -i "s|^COOKIE_PATH=.*|COOKIE_PATH=${BASE_PATH}|" .env
else
  printf 'COOKIE_PATH=%s\n' "$BASE_PATH" >> .env
fi
chmod 600 .env

# --- Swapfile (insurance on the 1 GB droplet) --------------------------------
if [[ ! -f /swapfile ]] && ! swapon --show 2>/dev/null | grep -q '/swapfile'; then
  echo "==> Creating 1 GB swapfile"
  fallocate -l 1G /swapfile || dd if=/dev/zero of=/swapfile bs=1M count=1024
  chmod 600 /swapfile
  mkswap /swapfile >/dev/null
  swapon /swapfile
  grep -q '/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

# --- Python venv + backend deps ----------------------------------------------
echo "==> Setting up Python venv"
if [[ ! -x "${APP_ROOT}/.venv/bin/python" ]]; then
  python3 -m venv "${APP_ROOT}/.venv"
fi
"${APP_ROOT}/.venv/bin/pip" install -q --upgrade pip
"${APP_ROOT}/.venv/bin/pip" install -q -r "${APP_ROOT}/backend/requirements.txt"

echo "==> Initialising + seeding database"
"${APP_ROOT}/.venv/bin/python" -m backend.seed_users

echo "==> Installing officepool-api systemd service"
cp "${APP_ROOT}/scripts/officepool-api.service" /etc/systemd/system/officepool-api.service
systemctl daemon-reload
systemctl enable officepool-api >/dev/null 2>&1 || true
systemctl restart officepool-api

echo "==> Initial score sync"
python3 scripts/sync-scores.py
"${APP_ROOT}/.venv/bin/python" -m backend.export || true

echo "==> Building static site"
bash scripts/deploy-droplet.sh

echo "==> Configuring web server"
APACHE_ACTIVE="$(systemctl is-active apache2 2>/dev/null || echo inactive)"
NGINX_ACTIVE="$(systemctl is-active nginx 2>/dev/null || echo inactive)"

if [[ "$APACHE_ACTIVE" == "active" ]]; then
  echo "    Using Apache"
  a2enmod alias proxy proxy_http 2>/dev/null || true

  # Loaded as 00-* so the specific /wc2026final alias is evaluated BEFORE the
  # existing generic /wc2026 alias (which would otherwise intercept it).
  SNIPPET="/etc/apache2/conf-available/00-wc2026final.conf"
  cat > "$SNIPPET" <<'APACHE'
Alias /wc2026final /var/www/wc2026final
<Directory /var/www/wc2026final>
    Options -Indexes +FollowSymLinks
    AllowOverride None
    Require all granted
</Directory>

# Reverse proxy the knockout API to the local FastAPI service.
ProxyPreserveHost On
ProxyPass        /wc2026final/api/ http://127.0.0.1:8001/
ProxyPassReverse /wc2026final/api/ http://127.0.0.1:8001/

# Never serve the database, secrets, or backend/code over the web.
<DirectoryMatch "^/var/www/wc2026final/(\.git|scripts|backend)">
    Require all denied
</DirectoryMatch>
<FilesMatch "(^\.env$|\.db$|\.db-.*$|\.py$)">
    Require all denied
</FilesMatch>
APACHE

  a2enconf 00-wc2026final 2>/dev/null || true
  apache2ctl configtest
  systemctl reload apache2
elif [[ "$NGINX_ACTIVE" == "active" ]]; then
  echo "    Using nginx"
  SNIPPET="/etc/nginx/snippets/wc2026final.conf"
  cat > "$SNIPPET" <<'NGINX'
location /wc2026final/api/ {
    proxy_pass http://127.0.0.1:8001/;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
}

location /wc2026final/ {
    alias /var/www/wc2026final/;
    try_files $uri $uri/ /wc2026final/index.html;
}

location ~ ^/wc2026final/data/.*\.json$ {
    alias /var/www/wc2026final/data/;
    add_header Cache-Control "no-cache, no-store, must-revalidate";
}

# Never serve the database, secrets, or backend code.
location ~ ^/wc2026final/.*\.(db|env|py)$ { deny all; }
location ~ ^/wc2026final/(backend|scripts|\.git)/ { deny all; }
NGINX

  for site in /etc/nginx/sites-enabled/*; do
    if grep -q "server_name.*8urt.net" "$site" 2>/dev/null; then
      if ! grep -q "wc2026final.conf" "$site"; then
        sed -i '/server_name.*8urt.net/a \    include snippets/wc2026final.conf;' "$site"
      fi
    fi
  done
  nginx -t
  systemctl reload nginx
else
  echo "ERROR: Neither apache2 nor nginx is active. Configure manually."
  exit 1
fi

echo "==> Installing cron (every minute)"
CRON_LINE="* * * * * cd ${APP_ROOT} && /bin/bash scripts/sync-all.sh >> ${LOG_FILE} 2>&1"
(
  crontab -l 2>/dev/null | grep -v "$CRON_MARKER" || true
  echo "$CRON_LINE $CRON_MARKER"
) | crontab -

touch "$LOG_FILE"
chmod 644 "$LOG_FILE"

echo ""
echo "Setup complete."
echo "  New site:      https://8urt.net/wc2026final/   (login + knockout)"
echo "  Existing site: https://8urt.net/wc2026/        (unchanged)"
echo "  App:           ${APP_ROOT}"
echo "  Logs:          ${LOG_FILE}"
echo ""
echo "Verify:"
echo "  curl -sI https://8urt.net/wc2026final/"
echo "  curl -sI https://8urt.net/wc2026final/data/scores.json"
echo "  curl -sI https://8urt.net/wc2026final/api/health"
echo "  tail -5 ${LOG_FILE}"
