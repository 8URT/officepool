# Office World Cup 2026 Pool — Live Ranking

Mobile-first live leaderboard for your office football pool. Predictions are exported locally from Excel; match results are stored in `data/scores.json` and synced from [openfootball](https://github.com/openfootball/worldcup.json).

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

## Local setup (predictions)

The Excel file stays **on your machine only** — it is not in the repo.

1. Place `World Cup 2026.xlsx` in the project folder.
2. Export predictions:

```bash
pip3 install openpyxl
python3 scripts/export-pool-data.py
```

3. Commit and push `data/pool.json` when predictions change.

4. Run locally:

```bash
python3 -m http.server 8080
```

## Scores memory (API results)

Finished match scores are saved to **`data/scores.json`**. This is the site's shared memory — rankings still work if the live API is temporarily down.

**Sync manually:**

```bash
python3 scripts/sync-scores.py
git add data/scores.json
git commit -m "Sync scores"
git push
```

**Automatic sync:** GitHub Actions runs every 30 minutes (`.github/workflows/sync-scores.yml`) and commits new results when they appear.

## Deploy

### GitHub Pages

1. **Settings → Pages → Source:** GitHub Actions
2. Push to `main` — deploy workflow syncs scores and publishes the site

Published files: `index.html`, `css/`, `js/`, `data/pool.json`, `data/scores.json`, `favicon.svg`

The Excel file and export scripts are **not** deployed.

## Files

| File | Purpose |
|------|---------|
| `World Cup 2026.xlsx` | Local only — source spreadsheet (gitignored) |
| `scripts/export-pool-data.py` | Excel → `data/pool.json` (predictions + fixtures) |
| `scripts/sync-scores.py` | openfootball → `data/scores.json` (results memory) |
| `data/pool.json` | Participants, fixtures, predictions |
| `data/scores.json` | Stored match results (site memory) |
| `.github/workflows/sync-scores.yml` | Auto-sync scores every 30 min |
| `.github/workflows/deploy.yml` | Deploy to GitHub Pages |

## Live scores source

`https://raw.githubusercontent.com/openfootball/worldcup.json/master/2026/worldcup.json`

The site loads stored scores first, then merges live API data on top. Stored scores are never removed — only updated or added.
