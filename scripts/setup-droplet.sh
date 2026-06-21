#!/usr/bin/env bash
# First-time setup for https://8urt.net/wc2026 on a WordPress droplet.
# Run as root: bash scripts/setup-droplet.sh
set -euo pipefail

REPO_URL="${REPO_URL:-https://github.com/8URT/officepool.git}"
APP_ROOT="${APP_ROOT:-/opt/officepool}"
WEB_ROOT="${WEB_ROOT:-/var/www/wc2026}"
BASE_PATH="${BASE_PATH:-/wc2026}"
LOG_FILE="${LOG_FILE:-/var/log/wc-pool-sync.log}"
CRON_MARKER="# wc-pool-sync"

echo "==> Installing packages"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq git python3 curl

echo "==> Cloning or updating app at ${APP_ROOT}"
if [[ -d "${APP_ROOT}/.git" ]]; then
  git -C "$APP_ROOT" pull --ff-only
else
  git clone "$REPO_URL" "$APP_ROOT"
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

echo "==> Initial score sync"
python3 scripts/sync-scores.py

echo "==> Building static site"
bash scripts/deploy-droplet.sh

echo "==> Configuring web server"
APACHE_ACTIVE="$(systemctl is-active apache2 2>/dev/null || echo inactive)"
NGINX_ACTIVE="$(systemctl is-active nginx 2>/dev/null || echo inactive)"

if [[ "$APACHE_ACTIVE" == "active" ]]; then
  echo "    Using Apache"
  a2enmod alias 2>/dev/null || true

  SNIPPET="/etc/apache2/conf-available/wc2026.conf"
  cat > "$SNIPPET" <<'APACHE'
Alias /wc2026 /var/www/wc2026
<Directory /var/www/wc2026>
    Options -Indexes +FollowSymLinks
    AllowOverride None
    Require all granted
</Directory>

<DirectoryMatch "^/var/www/wc2026/(\.git|scripts)">
    Require all denied
</DirectoryMatch>
APACHE

  a2enconf wc2026 2>/dev/null || true
  apache2ctl configtest
  systemctl reload apache2
elif [[ "$NGINX_ACTIVE" == "active" ]]; then
  echo "    Using nginx"
  SNIPPET="/etc/nginx/snippets/wc2026.conf"
  cat > "$SNIPPET" <<'NGINX'
location /wc2026/ {
    alias /var/www/wc2026/;
    try_files $uri $uri/ /wc2026/index.html;
}

location ~ ^/wc2026/data/.*\.json$ {
    alias /var/www/wc2026/data/;
    add_header Cache-Control "no-cache, no-store, must-revalidate";
}
NGINX

  for site in /etc/nginx/sites-enabled/*; do
    if grep -q "server_name.*8urt.net" "$site" 2>/dev/null; then
      if ! grep -q "wc2026.conf" "$site"; then
        sed -i '/server_name.*8urt.net/a \    include snippets/wc2026.conf;' "$site"
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
CRON_LINE="* * * * * cd ${APP_ROOT} && /usr/bin/python3 scripts/sync-scores.py >> ${LOG_FILE} 2>&1"
(
  crontab -l 2>/dev/null | grep -v "$CRON_MARKER" || true
  echo "$CRON_LINE $CRON_MARKER"
) | crontab -

touch "$LOG_FILE"
chmod 644 "$LOG_FILE"

echo ""
echo "Setup complete."
echo "  Site:  https://8urt.net/wc2026/"
echo "  App:   ${APP_ROOT}"
echo "  Logs:  ${LOG_FILE}"
echo ""
echo "Verify:"
echo "  curl -sI https://8urt.net/wc2026/"
echo "  curl -sI https://8urt.net/wc2026/data/scores.json"
echo "  tail -5 ${LOG_FILE}"
