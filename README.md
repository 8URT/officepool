# Office World Cup 2026 Pool — Live Ranking

Mobile-first live leaderboard for your office football pool. Predictions and fixtures live in `data/pool.json` (fixed for the tournament). Match results are stored in `data/scores.json` and synced from [openfootball](https://github.com/openfootball/worldcup.json).

**Live site:** https://8urt.github.io/officepool/

## What you get

- **Virtual ranking** — sorted by exact-score hits (1 point each), with tied ranks
- **Movement arrows** — last 5 results with ▲ / ▼ / dot per match
- **Score memory** — `data/scores.json` keeps all finished results (synced every 30 min)
- **Live + stored** — site merges stored scores with live API on each refresh
- **Player sheets** — tap a name to see predictions vs actual scores
- **Dark mode** — default dark theme, toggle saved in browser

## Scoring

Each participant gets **1 point per exact score** prediction. Correct winner alone does not count.

## Running locally

```bash
python3 -m http.server 8080
```

Open **http://localhost:8080**

## Scores (the only thing that updates)

Finished match scores are saved to **`data/scores.json`**. This is the site's shared memory — rankings still work if the live API is temporarily down.

**Automatic:** GitHub Actions runs every 30 minutes (`.github/workflows/sync-scores.yml`) and commits new results.

**Manual sync:**

```bash
python3 scripts/sync-scores.py
git add data/scores.json && git commit -m "Sync scores" && git push
```

## Deploy

1. **Settings → Pages → Source:** GitHub Actions
2. Push to `main` — the deploy workflow syncs scores and publishes the site

URL: **https://8urt.github.io/officepool/**

## Files

| File | Purpose |
|------|---------|
| `data/pool.json` | Participants, fixtures, predictions (fixed) |
| `data/scores.json` | Stored match results (updates during tournament) |
| `scripts/sync-scores.py` | openfootball → `data/scores.json` |
| `.github/workflows/sync-scores.yml` | Auto-sync scores every 30 min |
| `.github/workflows/deploy.yml` | Deploy to GitHub Pages |

## Live scores source

`https://raw.githubusercontent.com/openfootball/worldcup.json/master/2026/worldcup.json`

The site loads stored scores first, then merges live API data on top.

## Archive

`scripts/export-pool-data.py` was used once to build `pool.json` from the office spreadsheet. Predictions will not change — you do not need to run it again.
