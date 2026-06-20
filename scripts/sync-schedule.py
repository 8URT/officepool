#!/usr/bin/env python3
"""Align pool.json kickoff times (UTC) with API-Football fixtures."""

from __future__ import annotations

import argparse
import importlib.util
import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location("sync_scores", ROOT / "scripts" / "sync-scores.py")
sync = importlib.util.module_from_spec(SPEC)
assert SPEC.loader is not None
SPEC.loader.exec_module(sync)

API_FOOTBALL_BASE = sync.API_FOOTBALL_BASE
API_TO_POOL = sync.API_TO_POOL
POOL_PATH = sync.POOL_PATH
WC_LEAGUE_ID = sync.WC_LEAGUE_ID
WC_SEASON = sync.WC_SEASON
fetch_json = sync.fetch_json
load_dotenv = sync.load_dotenv
match_key = sync.match_key

EXTRA_API_TO_POOL = {
    **API_TO_POOL,
    "Cape Verde Islands": "Cape Verde",
    "Congo DR": "DR Congo",
    "Côte d'Ivoire": "Ivory Coast",
    "Curacao": "Curaçao",
}

MONTH_NAMES = [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
]
DAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
MUT = ZoneInfo("Indian/Mauritius")


def api_to_pool(name: str) -> str:
    return EXTRA_API_TO_POOL.get(name, name)


def fetch_fixture_kickoffs() -> dict[str, datetime]:
    api_key = os.environ.get("API_FOOTBALL_KEY", "").strip()
    if not api_key:
        raise SystemExit("API_FOOTBALL_KEY not set")

    url = f"{API_FOOTBALL_BASE}/fixtures?league={WC_LEAGUE_ID}&season={WC_SEASON}"
    payload = fetch_json(url, headers={"x-apisports-key": api_key})
    kickoffs: dict[str, datetime] = {}

    for fixture in payload.get("response") or []:
        home = api_to_pool((fixture.get("teams") or {}).get("home", {}).get("name", ""))
        away = api_to_pool((fixture.get("teams") or {}).get("away", {}).get("name", ""))
        if not home or not away:
            continue
        key = match_key(home, away)
        raw = (fixture.get("fixture") or {}).get("date")
        if not raw:
            continue
        kickoffs[key] = datetime.fromisoformat(raw.replace("Z", "+00:00"))

    return kickoffs


def parse_pool_utc(match: dict) -> datetime | None:
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


def format_pool_fields(kickoff_utc: datetime) -> dict[str, str]:
    mut = kickoff_utc.astimezone(MUT)
    return {
        "day": DAY_NAMES[kickoff_utc.weekday()],
        "date": f"{MONTH_NAMES[kickoff_utc.month - 1]} {kickoff_utc.day}, {kickoff_utc.year}",
        "time": kickoff_utc.strftime("%H:%M"),
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--write",
        action="store_true",
        help="Update data/pool.json when API kickoffs differ",
    )
    args = parser.parse_args()

    load_dotenv()
    pool = json.loads(POOL_PATH.read_text(encoding="utf-8"))
    kickoffs = fetch_fixture_kickoffs()
    changes: list[str] = []
    missing: list[str] = []

    for match in pool.get("matches") or []:
        key = match_key(match["home"], match["away"])
        api_kickoff = kickoffs.get(key)
        if not api_kickoff:
            missing.append(f"#{match['id']} {match['home']} vs {match['away']}")
            continue

        pool_kickoff = parse_pool_utc(match)
        if not pool_kickoff:
            continue

        diff_min = abs((pool_kickoff - api_kickoff).total_seconds()) / 60
        if diff_min <= 1:
            continue

        new_fields = format_pool_fields(api_kickoff)
        label = f"#{match['id']} {match['home']} vs {match['away']}"
        changes.append(
            f"{label}: {match['date']} {match['time']} UTC -> "
            f"{new_fields['date']} {new_fields['time']} UTC"
        )

        if args.write:
            match.update(new_fields)

    if missing:
        print("Missing API fixtures:")
        for item in missing:
            print(f"  - {item}")

    if not changes:
        print("All kickoff times match API-Football.")
        return

    print(f"Kickoff mismatches: {len(changes)}")
    for line in changes:
        print(f"  - {line}")

    if args.write:
        POOL_PATH.write_text(json.dumps(pool, indent=2) + "\n", encoding="utf-8")
        print(f"Updated {POOL_PATH}")
    else:
        print("Run with --write to apply fixes.")


if __name__ == "__main__":
    main()
