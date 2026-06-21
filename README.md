# Office World Cup 2026 Pool — Live Ranking

Mobile-first live leaderboard for your office football pool. Predictions and fixtures live in `data/pool.json` (fixed for the tournament). Match results are stored in `data/scores.json` and synced from openfootball + API-Football (live).

**Live site:** https://8urt.net/wc2026/ (primary) · https://8urt.github.io/officepool/ (archive)

## What you get

- **Virtual ranking** — official standings from finished matches only; W/L pill for last 5 FT results
- **Live ranking tab** — appears during live matches; provisional points and ▲/▼ vs kickoff snapshot
- **Match spotlight** — live score box above rankings (or next match when idle)
- **Score memory** — `data/scores.json` + `data/rank-snapshots.json`
- **Player sheets** — tap a name to see predictions vs actual scores
- **Dark mode** — default dark theme, toggle saved in browser

## Scoring

Each participant gets **1 point per exact score** prediction. Correct winner alone does not count.

## Running locally

```bash
cp .env.example .env
# Edit .env and add your API-Football key (direct subscription, api-sports.io)

python3 scripts/sync-scores.py
python3 -m http.server 8080
```

Open **http://localhost:8080**

### Live match days

Re-sync scores every 60 seconds:

```bash
./scripts/watch-scores.sh 60
```

To keep **GitHub / the online site** in sync while you watch locally, add `PUBLISH_SCORES=1` to `.env` (or run `PUBLISH_SCORES=1 ./scripts/watch-scores.sh 60`). That pushes `data/scores.json` after each sync.

> GitHub’s scheduled Actions often run every 1–4 hours, not every 5 minutes. Local publish during matches is the reliable way to keep the live site current.

## API key (keep private)

- **Local:** put your key in `.env` as `API_FOOTBALL_KEY=...` (never commit `.env`)
- **GitHub (when you push):** add repository secret `API_FOOTBALL_KEY` under Settings → Secrets → Actions
- The browser never calls API-Football directly — only `scripts/sync-scores.py` uses the key

## Scores (the only thing that updates)

Finished and live scores are saved to **`data/scores.json`**. Kickoff rank snapshots go to **`data/rank-snapshots.json`**.

**Automatic:** GitHub Actions syncs scores when scheduled (often every 1–4 hours in practice, not every 5 minutes).

**Manual sync:**

```bash
python3 scripts/sync-scores.py
```

## Deploy to droplet (8urt.net/wc2026)

Self-hosted on the WordPress droplet. The browser loads scores from same-origin `data/scores.json`; a server cron runs `sync-scores.py` every minute (no `PUBLISH_SCORES` needed).

**First-time setup** (SSH as root on the droplet):

```bash
git clone https://github.com/8URT/officepool.git /opt/officepool
cd /opt/officepool
cp .env.example .env && nano .env   # API_FOOTBALL_KEY=...
bash scripts/setup-droplet.sh
```

**Updates** (after pushing code changes):

```bash
cd /opt/officepool && git pull && bash scripts/deploy-droplet.sh
```

Scores update automatically via cron (`/var/log/wc-pool-sync.log`).

## Deploy (GitHub Pages)

1. Add `API_FOOTBALL_KEY` secret on GitHub
2. **Settings → Pages → Source:** GitHub Actions
3. Push to `main` — deploy workflow syncs scores and publishes the site

URL: **https://8urt.github.io/officepool/**

## Files

| File | Purpose |
|------|---------|
| `data/pool.json` | Participants, fixtures, predictions (fixed) |
| `data/scores.json` | Stored match results (FT + live) |
| `data/rank-snapshots.json` | Rank at kickoff per live match |
| `scripts/sync-scores.py` | API-Football + openfootball → data files |
| `scripts/watch-scores.sh` | Local 60s sync loop |
| `.env.example` | API key template (copy to `.env`) |
| `.github/workflows/sync-scores.yml` | Auto-sync scores every 5 min |
| `scripts/deploy-droplet.sh` | Rebuild `/var/www/wc2026` for droplet |
| `scripts/setup-droplet.sh` | First-time droplet install (Apache/nginx + cron) |

## Data sources

- **API-Football** (live + FT when key is set): `https://v3.football.api-sports.io`
- **openfootball** (FT fallback): `https://raw.githubusercontent.com/openfootball/worldcup.json/master/2026/worldcup.json`

The site loads stored scores from `data/scores.json` and merges openfootball on refresh.

## Archive

`scripts/export-pool-data.py` was used once to build `pool.json` from the office spreadsheet. Predictions will not change — you do not need to run it again.
