#!/usr/bin/env bash
# Run on the droplet as root. Pull app code + rebuild static site.
# Score JSON is updated by cron on-server and must not block deploys.
set -euo pipefail

APP_ROOT="${APP_ROOT:-/opt/officepool}"
cd "$APP_ROOT"

echo "==> Fetching latest from origin"
git fetch origin main

# Only update site/code files — leave live scores from cron untouched
git checkout origin/main -- \
  index.html \
  admin.html \
  favicon.svg \
  css \
  js \
  backend \
  data/pool.json \
  scripts \
  2>/dev/null || git checkout origin/main -- index.html favicon.svg css js backend data/pool.json scripts/

# Ignore score drift so future git pull attempts stay clean
git update-index --assume-unchanged data/scores.json data/rank-snapshots.json 2>/dev/null || true
git update-index --assume-unchanged data/knockout.json 2>/dev/null || true

echo "==> Deploying static site"
bash scripts/deploy-droplet.sh

echo "Done. https://8urt.net/wc2026/"
