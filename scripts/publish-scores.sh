#!/usr/bin/env bash
# Commit and push score files so GitHub Pages / raw scores stay in sync with local sync.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

git add data/scores.json data/rank-snapshots.json
if git diff --staged --quiet; then
  exit 0
fi

git commit -m "Sync scores from API-Football"

for attempt in 1 2 3; do
  if git pull --rebase origin main && git push origin main; then
    echo "Published scores to GitHub"
    exit 0
  fi
  sleep 3
done

echo "Failed to publish scores after 3 attempts" >&2
exit 1
