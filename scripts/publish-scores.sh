#!/usr/bin/env bash
# Commit and push score files so GitHub Pages / raw scores stay in sync with local sync.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

LOCKDIR="$ROOT/.publish-lock"
if ! mkdir "$LOCKDIR" 2>/dev/null; then
  exit 0
fi

SCORES_TMP="$(mktemp)"
SNAP_TMP="$(mktemp)"
cleanup() {
  rm -f "$SCORES_TMP" "$SNAP_TMP"
  rmdir "$LOCKDIR" 2>/dev/null || true
}
trap cleanup EXIT

cp data/scores.json "$SCORES_TMP"
cp data/rank-snapshots.json "$SNAP_TMP"

restore_scores() {
  cp "$SCORES_TMP" data/scores.json
  cp "$SNAP_TMP" data/rank-snapshots.json
}

for attempt in 1 2 3; do
  git fetch origin main

  if git pull --rebase --autostash origin main; then
    :
  else
    echo "Rebase conflict while publishing scores — resetting to origin/main" >&2
    git rebase --abort 2>/dev/null || true
    git reset --hard origin/main
  fi

  restore_scores
  git add data/scores.json data/rank-snapshots.json
  if git diff --staged --quiet; then
    exit 0
  fi

  git commit -m "Sync scores from API-Football"

  if git push origin main; then
    echo "Published scores to GitHub"
    exit 0
  fi

  sleep 2
done

echo "Failed to publish scores after 3 attempts" >&2
exit 1
