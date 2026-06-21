# Office World Cup 2026 Pool — Live Ranking

Mobile-first live leaderboard for your office football pool. Predictions and fixtures live in `data/pool.json` (fixed for the tournament). Match results are stored in `data/scores.json` and synced from openfootball + API-Football (live).

**Live site:** https://8urt.net/wc2026/ (primary) · https://8urt.github.io/officepool/ (redirects to primary)

## What you get

- **Virtual ranking** — official standings from finished matches only; W/L pill for last 5 FT results
- **Live ranking tab** — appears during live matches; provisional points and ▲/▼ vs kickoff snapshot
- **Match spotlight** — live score box above rankings (or next match when idle)
- **Score memory** — `data/scores.json` + `data/rank-snapshots.json`
- **Player sheets** — tap a name to see predictions vs actual scores
- **Dark mode** — default dark theme, toggle saved in browser

## Scoring

Each participant gets **1 point per exact score** prediction. Correct winner alone does not count.

## Running locally (dev only)

For testing UI changes — **do not sync scores locally** during matches; the droplet handles live scores.

```bash
cp .env.example .env
# API key optional for local UI work; scores come from committed data/pool.json + data/scores.json

python3 -m http.server 8080
```

Open **http://localhost:8080**

To test score sync logic once (not for production):

```bash
python3 scripts/sync-scores.py
```

Do **not** run `./scripts/watch-scores.sh` or set `PUBLISH_SCORES=1` — that pushes to GitHub and duplicates the droplet cron.

## API key (keep private)

- **Droplet (production):** `/opt/officepool/.env` — used by cron every minute
- **Local dev:** optional in `.env` for one-off `sync-scores.py` tests only
- The browser never calls API-Football directly

## Scores

Finished and live scores live in **`data/scores.json`** on the droplet. Kickoff snapshots in **`data/rank-snapshots.json`**.

**Production:** droplet cron runs `sync-scores.py` every minute (`/var/log/wc-pool-sync.log`).

**GitHub repo:** score files in git are not updated automatically — the droplet is the source of truth.

## Deploy to droplet (8urt.net/wc2026)

Self-hosted on the WordPress droplet. The browser loads scores from same-origin `data/scores.json`; a server cron runs `sync-scores.py` every minute (no `PUBLISH_SCORES` needed).

### SSH setup (one time)

Three SSH links to configure:

| Link | Purpose | Script |
|------|---------|--------|
| Mac → droplet | SSH in, run deploys | `bash scripts/setup-mac-droplet-ssh.sh` |
| droplet → GitHub | `git pull` without password | `bash scripts/setup-droplet-github-ssh.sh` (on droplet) |
| GitHub Actions → droplet | Auto-deploy on push | `bash scripts/setup-github-actions-ssh.sh` (on Mac) |

**1. Mac → droplet** — run on your Mac, paste the output on the droplet:

```bash
bash scripts/setup-mac-droplet-ssh.sh
```

**2. droplet → GitHub** — run on the droplet, add the printed key at [Deploy keys](https://github.com/8URT/officepool/settings/keys):

```bash
cd /opt/officepool && bash scripts/setup-droplet-github-ssh.sh
ssh -T git@github.com   # should say "successfully authenticated"
```

**3. GitHub Actions → droplet** — run on your Mac, follow printed steps for secrets + droplet `authorized_keys`:

```bash
bash scripts/setup-github-actions-ssh.sh
```

GitHub secrets needed for optional auto-deploy: `DROPLET_HOST`, `DROPLET_USER`, `DROPLET_SSH_KEY`, `API_FOOTBALL_KEY`. Run `bash scripts/setup-github-actions-ssh.sh` on your Mac to generate the key and print setup steps. The **Deploy to droplet** workflow is manual-only (Actions → Run workflow) so failed push notifications stop.

### First-time install

```bash
# On droplet (after Mac SSH key is added):
export API_FOOTBALL_KEY='your_key'
curl -fsSL https://raw.githubusercontent.com/8URT/officepool/main/scripts/setup-droplet.sh | bash
```

Or from your Mac (password SSH OK):

```bash
bash scripts/install-droplet-remote.sh
```

### Updates

**On droplet:**

```bash
cd /opt/officepool && bash scripts/pull-deploy-droplet.sh
```

**From GitHub:** push to `main` — the `Deploy to droplet` workflow runs `git pull` + rebuild (when `DROPLET_SSH_KEY` secret is set).

Scores update automatically via cron (`/var/log/wc-pool-sync.log`).

## Deploy (GitHub Pages)

GitHub Pages only hosts the **redirect** to https://8urt.net/wc2026/. No score sync on GitHub.

Manual deploy: **Actions → Deploy to GitHub Pages → Run workflow**

URL: **https://8urt.github.io/officepool/** (redirects to droplet)

## Files

| File | Purpose |
|------|---------|
| `data/pool.json` | Participants, fixtures, predictions (fixed) |
| `data/scores.json` | Stored match results (FT + live) |
| `data/rank-snapshots.json` | Rank at kickoff per live match |
| `scripts/sync-scores.py` | API-Football + openfootball → data files |
| `scripts/watch-scores.sh` | Local dev loop (do not use in production) |
| `.env.example` | API key template (copy to `.env`) |
| `scripts/deploy-droplet.sh` | Rebuild `/var/www/wc2026` for droplet |
| `scripts/pull-deploy-droplet.sh` | `git pull` + deploy on droplet |
| `scripts/setup-droplet.sh` | First-time droplet install (Apache/nginx + cron) |
| `scripts/setup-droplet-github-ssh.sh` | droplet deploy key for GitHub pull |
| `scripts/setup-mac-droplet-ssh.sh` | Add Mac SSH key to droplet |
| `scripts/setup-github-actions-ssh.sh` | GHA SSH key for auto-deploy |

## Data sources

- **API-Football** (live + FT when key is set): `https://v3.football.api-sports.io`
- **openfootball** (FT fallback): `https://raw.githubusercontent.com/openfootball/worldcup.json/master/2026/worldcup.json`

The site loads stored scores from `data/scores.json` and merges openfootball on refresh.

## Archive

`scripts/export-pool-data.py` was used once to build `pool.json` from the office spreadsheet. Predictions will not change — you do not need to run it again.
