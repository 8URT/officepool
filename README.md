# Office World Cup 2026 Pool — Live Ranking

Mobile-first live leaderboard for your office football pool. Predictions come from the Excel sheet; match results auto-sync from the free [openfootball](https://github.com/openfootball/worldcup.json) dataset (no API key).

**Live site:** enable GitHub Pages (see [Deploy](#deploy)) → `https://8urt.github.io/officepool/`

## What you get

- **Virtual ranking** — sorted by exact-score hits (1 point each), with tied ranks
- **Movement arrows** — last 5 results with ▲ / ▼ / dot per match
- **Auto refresh** — polls openfootball every 2 minutes
- **Player sheets** — tap a name to see predictions vs actual scores
- **Calendar & Results** — upcoming fixtures and finished matches
- **Dark mode** — default dark theme, toggle saved in browser

## Scoring

Each participant gets **1 point per exact score** prediction. Correct winner alone does not count.

## Local development

1. **Export predictions** after updating the Excel file:

```bash
pip3 install openpyxl
python3 scripts/export-pool-data.py
```

2. **Run a local server** (required for JSON loading):

```bash
python3 -m http.server 8080
```

3. Open **http://localhost:8080**

## Updating during the tournament

1. Update `World Cup 2026.xlsx` with new predictions.
2. Re-run `python3 scripts/export-pool-data.py`.
3. Commit and push `data/pool.json` — the live site picks it up on the next refresh (within 2 min).

Live match scores sync automatically from openfootball; re-export only when **predictions** change.

## Deploy

### GitHub Pages (recommended)

The repo includes a GitHub Actions workflow (`.github/workflows/deploy.yml`) that deploys on every push to `main`.

**One-time setup:**

1. Open **Settings → Pages** on [github.com/8URT/officepool](https://github.com/8URT/officepool)
2. Under **Build and deployment**, set **Source** to **GitHub Actions**
3. Push to `main` — the workflow builds and publishes the site

Your URL will be: **https://8urt.github.io/officepool/**

Only the static web files are published (`index.html`, `css/`, `js/`, `data/`, `favicon.svg`). The Excel file and export script stay in the repo but are not served publicly.

### Netlify / Cloudflare Pages

Use the included `netlify.toml` or point your host at the repo root with:

```bash
bash scripts/prepare-site.sh _site
```

Publish the `_site` folder, or set the build command to that script.

### Manual upload

Upload these files to any static host:

- `index.html`, `favicon.svg`
- `css/styles.css`
- `js/app.js`
- `data/pool.json`

## Files

| File | Purpose |
|------|---------|
| `World Cup 2026.xlsx` | Source pool spreadsheet (not deployed) |
| `scripts/export-pool-data.py` | Excel → `data/pool.json` |
| `scripts/prepare-site.sh` | Build folder for static hosting |
| `data/pool.json` | Participants, matches, predictions |
| `index.html` | Main page |
| `js/app.js` | Ranking logic + live score sync |
| `.github/workflows/deploy.yml` | GitHub Pages deployment |

## Live scores source

`https://raw.githubusercontent.com/openfootball/worldcup.json/master/2026/worldcup.json`

Community-maintained; updates after matches finish. Falls back to scores in the Excel dashboard sheet if the feed is unavailable.
