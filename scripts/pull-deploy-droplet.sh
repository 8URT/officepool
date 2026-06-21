#!/usr/bin/env bash
# Run on the droplet as root. git pull + rebuild static site.
set -euo pipefail

APP_ROOT="${APP_ROOT:-/opt/officepool}"
cd "$APP_ROOT"

echo "==> Pulling latest from origin"
git fetch origin main
git pull --ff-only origin main

echo "==> Deploying static site"
bash scripts/deploy-droplet.sh

echo "Done. https://8urt.net/wc2026/"
