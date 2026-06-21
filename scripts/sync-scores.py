#!/usr/bin/env python3
"""Sync scores from API-Football (live + FT) and openfootball into data/scores.json."""

from __future__ import annotations

import json
import os
import urllib.error
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
POOL_PATH = ROOT / "data" / "pool.json"
OUT = ROOT / "data" / "scores.json"
SNAPSHOTS_PATH = ROOT / "data" / "rank-snapshots.json"
ENV_PATH = ROOT / ".env"
OPENFOOTBALL_URL = (
    "https://raw.githubusercontent.com/openfootball/worldcup.json/master/2026/worldcup.json"
)
API_FOOTBALL_BASE = "https://v3.football.api-sports.io"
WC_LEAGUE_ID = 1
WC_SEASON = 2026
ARROW_MATCH_LOOKBACK = 5

TEAM_ALIASES = {
    "Korea Republic": "South Korea",
    "South Korea": "South Korea",
    "United States": "USA",
    "USA": "USA",
    "Bosnia and Herzegovina": "Bosnia & Herzegovina",
    "Bosnia & Herzegovina": "Bosnia & Herzegovina",
    "Turkey": "Turkiye",
    "Türkiye": "Turkiye",
    "Turkiye": "Turkiye",
    "Czech Republic": "Czechia",
    "Czechia": "Czechia",
    "Cape Verde Islands": "Cape Verde",
    "Congo DR": "DR Congo",
}

API_TO_POOL = {
    "Korea Republic": "Korea Republic",
    "South Korea": "Korea Republic",
    "United States": "United States",
    "USA": "United States",
    "Bosnia and Herzegovina": "Bosnia and Herzegovina",
    "Bosnia & Herzegovina": "Bosnia and Herzegovina",
    "Turkey": "Turkey",
    "Türkiye": "Turkey",
    "Turkiye": "Turkey",
    "Czech Republic": "Czech Republic",
    "Czechia": "Czech Republic",
    "Cape Verde Islands": "Cape Verde",
    "Congo DR": "DR Congo",
    "Côte d'Ivoire": "Ivory Coast",
    "Curacao": "Curaçao",
}

LIVE_STATUSES = {"1H", "HT", "2H", "ET", "BT", "P", "LIVE", "INT"}
FINISHED_STATUSES = {"FT", "AET", "PEN"}
MATCH_WINDOW_BEFORE = timedelta(hours=2)
MATCH_WINDOW_AFTER = timedelta(hours=2)

MONTH_NAMES = [
    "Jan", "Feb", "Mar", "Apr", "May", "Jun",
    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
]


def load_dotenv() -> None:
    if not ENV_PATH.exists():
        return
    for line in ENV_PATH.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        if key and key not in os.environ:
            os.environ[key] = value


def normalize_team(name: str | None) -> str | None:
    if not name:
        return name
    return TEAM_ALIASES.get(name, name)


def api_team_to_pool(name: str | None) -> str | None:
    if not name:
        return name
    return API_TO_POOL.get(name, name)


def match_key(home: str, away: str) -> str:
    teams = sorted([normalize_team(home) or home, normalize_team(away) or away])
    return f"{teams[0]}|{teams[1]}"


def pool_date_to_iso(date_str: str) -> str | None:
    months = {
        "Jan": "01",
        "Feb": "02",
        "Mar": "03",
        "Apr": "04",
        "May": "05",
        "Jun": "06",
        "Jul": "07",
        "Aug": "08",
        "Sep": "09",
        "Oct": "10",
        "Nov": "11",
        "Dec": "12",
    }
    cleaned = date_str.replace(",", "").strip()
    parts = cleaned.split()
    if len(parts) != 3:
        return None
    month = months.get(parts[0][:3])
    if not month:
        return None
    return f"{parts[2]}-{month}-{int(parts[1]):02d}"


def fetch_json(url: str, headers: dict | None = None) -> dict:
    request = urllib.request.Request(url, headers=headers or {})
    with urllib.request.urlopen(request, timeout=30) as response:
        return json.load(response)


def parse_pool_utc(match: dict) -> datetime | None:
    """Kickoff in pool.json is stored as UTC."""
    date_str = match.get("date")
    time_str = match.get("time") or "00:00"
    if not date_str:
        return None

    if isinstance(date_str, str) and date_str[:4].isdigit() and "-" in date_str:
        year, month, day = [int(part) for part in date_str.split("-")]
    else:
        cleaned = str(date_str).replace(",", "").strip().split()
        if len(cleaned) < 3:
            return None
        month = MONTH_NAMES.index(cleaned[0][:3]) + 1
        day = int(cleaned[1])
        year = int(cleaned[2])

    hour, minute = [int(part) for part in str(time_str).split(":")]
    return datetime(year, month, day, hour, minute, tzinfo=timezone.utc)


def should_fetch_api_football(pool: dict, existing: dict[str, dict]) -> bool:
    """Call API-Football only near kickoff or while a match is still live."""
    if any(match.get("isLive") for match in existing.values()):
        return True

    now = datetime.now(timezone.utc)
    for match in pool.get("matches") or []:
        kickoff = parse_pool_utc(match)
        if not kickoff:
            continue
        if kickoff - MATCH_WINDOW_BEFORE <= now <= kickoff + MATCH_WINDOW_AFTER:
            return True
    return False


def fetch_openfootball() -> dict[str, dict]:
    parsed: dict[str, dict] = {}
    try:
        payload = fetch_json(OPENFOOTBALL_URL)
    except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as error:
        print(f"openfootball unavailable: {error}")
        return parsed

    for match in payload.get("matches") or []:
        ft = match.get("score", {}).get("ft")
        if not ft or len(ft) != 2 or ft[0] is None or ft[1] is None:
            continue
        home = match.get("team1")
        away = match.get("team2")
        if not home or not away:
            continue
        key = match_key(home, away)
        parsed[key] = {
            "key": key,
            "home": home,
            "away": away,
            "scoreHome": ft[0],
            "scoreAway": ft[1],
            "status": "finished",
            "isLive": False,
            "date": match.get("date"),
            "round": match.get("round"),
            "group": match.get("group"),
            "source": "openfootball",
            "syncedAt": datetime.now(timezone.utc).isoformat(),
        }
    return parsed


def parse_api_fixture(fixture: dict) -> dict | None:
    fixture_info = fixture.get("fixture") or {}
    teams = fixture.get("teams") or {}
    goals = fixture.get("goals") or {}
    league = fixture.get("league") or {}
    status = (fixture_info.get("status") or {}).get("short") or ""
    elapsed = (fixture_info.get("status") or {}).get("elapsed")

    home_api = (teams.get("home") or {}).get("name")
    away_api = (teams.get("away") or {}).get("name")
    if not home_api or not away_api:
        return None

    home = api_team_to_pool(home_api) or home_api
    away = api_team_to_pool(away_api) or away_api
    key = match_key(home, away)

    score_home = goals.get("home")
    score_away = goals.get("away")

    if status in FINISHED_STATUSES:
        if score_home is None or score_away is None:
            return None
        return {
            "key": key,
            "home": home,
            "away": away,
            "scoreHome": score_home,
            "scoreAway": score_away,
            "status": "finished",
            "isLive": False,
            "minute": None,
            "date": (fixture_info.get("date") or "")[:10] or None,
            "round": league.get("round"),
            "group": league.get("group"),
            "source": "api-football",
            "syncedAt": datetime.now(timezone.utc).isoformat(),
        }

    if status in LIVE_STATUSES:
        if score_home is None:
            score_home = 0
        if score_away is None:
            score_away = 0
        status_text = f"{elapsed}'" if elapsed is not None else "Live"
        return {
            "key": key,
            "home": home,
            "away": away,
            "scoreHome": score_home,
            "scoreAway": score_away,
            "status": "live",
            "isLive": True,
            "minute": elapsed,
            "statusText": status_text,
            "date": (fixture_info.get("date") or "")[:10] or None,
            "round": league.get("round"),
            "group": league.get("group"),
            "source": "api-football",
            "syncedAt": datetime.now(timezone.utc).isoformat(),
        }

    return None


def pool_keys(pool: dict) -> set[str]:
    keys: set[str] = set()
    for match in pool.get("matches") or []:
        keys.add(match_key(match["home"], match["away"]))
    return keys


def filter_to_pool(matches: dict[str, dict], pool: dict) -> dict[str, dict]:
    allowed = pool_keys(pool)
    return {key: value for key, value in matches.items() if key in allowed}


def fetch_api_football(pool: dict) -> dict[str, dict]:
    api_key = os.environ.get("API_FOOTBALL_KEY", "").strip()
    if not api_key:
        print("API_FOOTBALL_KEY not set — skipping API-Football (use .env locally)")
        return {}

    headers = {"x-apisports-key": api_key}
    parsed: dict[str, dict] = {}

    urls = [
        f"{API_FOOTBALL_BASE}/fixtures?league={WC_LEAGUE_ID}&season={WC_SEASON}",
        f"{API_FOOTBALL_BASE}/fixtures?live=all",
    ]

    for url in urls:
        try:
            payload = fetch_json(url, headers=headers)
        except urllib.error.HTTPError as error:
            print(f"API-Football HTTP error ({url}): {error.code}")
            continue
        except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as error:
            print(f"API-Football unavailable ({url}): {error}")
            continue

        for fixture in payload.get("response") or []:
            entry = parse_api_fixture(fixture)
            if entry:
                parsed[entry["key"]] = entry

    return filter_to_pool(parsed, pool)


def load_existing() -> dict[str, dict]:
    if not OUT.exists():
        return {}
    data = json.loads(OUT.read_text(encoding="utf-8"))
    existing: dict[str, dict] = {}
    for match in data.get("matches") or []:
        key = match.get("key") or match_key(match.get("home", ""), match.get("away", ""))
        existing[key] = {**match, "key": key}
    return existing


def load_pool() -> dict:
    return json.loads(POOL_PATH.read_text(encoding="utf-8"))


def get_prediction(predictions: dict, match_id: int) -> dict | None:
    return predictions.get(match_id) or predictions.get(str(match_id))


def is_exact(prediction: dict | None, result: dict) -> bool:
    if not prediction or not result:
        return False
    return (
        prediction.get("home") == result.get("scoreHome")
        and prediction.get("away") == result.get("scoreAway")
    )


def assign_ranks(standings: list[dict]) -> list[dict]:
    rank = 1
    ranked = []
    for index, entry in enumerate(standings):
        if index > 0:
            prev = standings[index - 1]
            tied = entry["points"] == prev["points"] and entry["exactHits"] == prev["exactHits"]
            if not tied:
                rank = index + 1
        ranked.append({**entry, "rank": rank})
    return ranked


def build_participant_stats(pool: dict, finished_matches: list[dict]) -> list[dict]:
    stats = []
    for name in pool.get("participants") or []:
        points = 0
        exact_hits = 0
        predictions = (pool.get("predictions") or {}).get(name) or {}
        for match in finished_matches:
            prediction = get_prediction(predictions, match["id"])
            result = match.get("result") or {}
            if is_exact(prediction, result):
                points += pool.get("scoring", {}).get("exactScore", 1)
                exact_hits += 1
        stats.append({"name": name, "points": points, "exactHits": exact_hits})
    stats.sort(key=lambda item: (-item["points"], -item["exactHits"], item["name"]))
    return assign_ranks(stats)


def pool_matches_with_results(pool: dict, merged: dict[str, dict]) -> tuple[list[dict], list[dict]]:
    finished: list[dict] = []
    live: list[dict] = []
    for match in pool.get("matches") or []:
        key = match_key(match["home"], match["away"])
        stored = merged.get(key)
        if not stored:
            continue
        entry = {**match, "result": stored, "key": key}
        if stored.get("isLive") or stored.get("status") == "live":
            live.append(entry)
        elif stored.get("status") == "finished":
            finished.append(entry)
    return finished, live


def load_snapshots() -> dict:
    if not SNAPSHOTS_PATH.exists():
        return {"updatedAt": None, "snapshots": {}}
    return json.loads(SNAPSHOTS_PATH.read_text(encoding="utf-8"))


def save_snapshots(data: dict) -> None:
    data["updatedAt"] = datetime.now(timezone.utc).isoformat()
    SNAPSHOTS_PATH.parent.mkdir(exist_ok=True)
    SNAPSHOTS_PATH.write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8")


def update_snapshots(pool: dict, merged: dict[str, dict]) -> None:
    finished, live = pool_matches_with_results(pool, merged)
    if not live:
        return

    snapshot_data = load_snapshots()
    snapshots = snapshot_data.setdefault("snapshots", {})
    standings = build_participant_stats(pool, finished)
    ranks = {entry["name"]: entry["rank"] for entry in standings}
    now = datetime.now(timezone.utc).isoformat()

    for match in live:
        key = match_key(match["home"], match["away"])
        if key in snapshots:
            continue
        snapshots[key] = {
            "matchId": match.get("id"),
            "home": match["home"],
            "away": match["away"],
            "capturedAt": now,
            "ranks": ranks,
        }
        print(f"Kickoff snapshot saved for {match['home']} vs {match['away']}")

    save_snapshots(snapshot_data)


def reconcile_live_status(
    merged: dict[str, dict],
    openfootball: dict[str, dict],
    api_football: dict[str, dict],
) -> None:
    now = datetime.now(timezone.utc)

    for key, match in list(merged.items()):
        if not match.get("isLive"):
            continue

        if key in api_football and not api_football[key].get("isLive"):
            merged[key] = api_football[key]
            continue

        if key in openfootball:
            merged[key] = openfootball[key]
            continue

        synced_at = match.get("syncedAt")
        if not synced_at:
            continue

        synced = datetime.fromisoformat(synced_at.replace("Z", "+00:00"))
        age_s = (now - synced).total_seconds()
        minute = match.get("minute") or 0
        if (minute >= 70 and age_s >= 10 * 60) or age_s >= 45 * 60:
            merged[key] = {
                **match,
                "status": "finished",
                "isLive": False,
                "minute": None,
                "statusText": None,
            }


def merge_maps(*maps: dict[str, dict]) -> dict[str, dict]:
    merged: dict[str, dict] = {}
    for item in maps:
        merged.update(item)
    return merged


def main() -> None:
    load_dotenv()
    pool = load_pool()
    existing = load_existing()
    openfootball = fetch_openfootball()

    if should_fetch_api_football(pool, existing):
        api_football = fetch_api_football(pool)
    else:
        api_football = {}
        print("API-Football skipped — outside match window (kickoff ±2h, no live matches)")

    # Priority: API-Football (live + FT) > openfootball FT > existing stored
    merged = merge_maps(existing, openfootball, api_football)
    merged = filter_to_pool(merged, pool)
    reconcile_live_status(merged, openfootball, api_football)

    update_snapshots(pool, merged)

    live_count = sum(1 for match in merged.values() if match.get("isLive"))
    finished_count = sum(1 for match in merged.values() if match.get("status") == "finished")

    payload = {
        "source": "api-football+openfootball" if api_football else "openfootball",
        "updatedAt": datetime.now(timezone.utc).isoformat(),
        "matchCount": len(merged),
        "liveCount": live_count,
        "finishedCount": finished_count,
        "matches": sorted(
            merged.values(),
            key=lambda m: (m.get("date") or "", m.get("home") or ""),
        ),
    }

    OUT.parent.mkdir(exist_ok=True)
    OUT.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    print(
        f"Stored {len(merged)} results in {OUT} "
        f"({finished_count} finished, {live_count} live, {len(api_football)} from API-Football)"
    )


if __name__ == "__main__":
    main()
