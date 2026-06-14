# Office World Cup 2026 Pool — Live Ranking

Mobile-first live leaderboard for your office football pool. Predictions come from the Excel sheet; match results auto-sync from the free [openfootball](https://github.com/openfootball/worldcup.json) dataset (no API key).

## What you get

- **Virtual ranking first** — sorted by exact-score hits (1 point each)
- **Movement arrows** — ▲ / ▼ / — vs your last view (stored in the browser session)
- **Auto refresh** — polls for new full-time scores every 2 minutes
- **Recent results** — shows who nailed each finished match
- **Up next** — upcoming fixtures from your sheet

## Scoring (from your Excel)

Each participant gets **1 point per exact score** prediction. Correct winner alone does not count — it must match the final scoreline.

## Quick start

1. **Export predictions** after updating the Excel file:

```bash
pip3 install openpyxl
python3 scripts/export-pool-data.py
```

2. **Run a local server** (needed for JSON loading):

```bash
cd "/Users/burt/Downloads/WC POOL"
python3 -m http.server 8080
```

3. Open **http://localhost:8080** on your phone (same Wi‑Fi) or desktop.

## Updating during the tournament

1. When colleagues submit scores, update `World Cup 2026.xlsx`.
2. Re-run `python3 scripts/export-pool-data.py`.
3. Refresh the page — rankings recalculate instantly.

Live match scores are fetched automatically; you only need to re-export when **predictions** change.

## Deploy (optional)

Upload these files to any static host (Netlify, GitHub Pages, Cloudflare Pages):

- `index.html`
- `css/styles.css`
- `js/app.js`
- `data/pool.json`

Re-export and re-upload `pool.json` whenever predictions change.

## Files

| File | Purpose |
|------|---------|
| `World Cup 2026.xlsx` | Source pool spreadsheet |
| `scripts/export-pool-data.py` | Excel → `data/pool.json` |
| `data/pool.json` | Participants, matches, predictions |
| `index.html` | Main page |
| `js/app.js` | Ranking logic + live score sync |

## Live scores source

Uses the public JSON feed:

`https://raw.githubusercontent.com/openfootball/worldcup.json/master/2026/worldcup.json`

This is community-maintained and updates after matches finish — not second-by-second in-play data. For a phone-friendly pool leaderboard during the tournament, that is usually enough.

If the feed is down, the page falls back to scores already entered in the **Dashboard Final Score** sheet.
