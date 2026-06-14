#!/usr/bin/env python3
"""Fetch openfootball scores and merge into data/scores.json (site memory)."""

from __future__ import annotations

import json
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "data" / "scores.json"
API_URL = (
    "https://raw.githubusercontent.com/openfootball/worldcup.json/master/2026/worldcup.json"
)

TEAM_ALIASES = {
    "Korea Republic": "South Korea",
    "United States": "USA",
    "Bosnia and Herzegovina": "Bosnia & Herzegovina",
    "Turkey": "Turkiye",
    "Türkiye": "Turkiye",
    "Czech Republic": "Czechia",
}


def normalize_team(name: str | None) -> str | None:
    if not name:
        return name
    return TEAM_ALIASES.get(name, name)


def match_key(home: str, away: str) -> str:
    teams = sorted([normalize_team(home) or home, normalize_team(away) or away])
    return f"{teams[0]}|{teams[1]}"


def fetch_api() -> list[dict]:
    with urllib.request.urlopen(API_URL, timeout=30) as response:
        payload = json.load(response)
    return payload.get("matches") or []


def parse_api_matches(api_matches: list[dict]) -> dict[str, dict]:
    parsed: dict[str, dict] = {}
    for match in api_matches:
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
            "date": match.get("date"),
            "round": match.get("round"),
            "group": match.get("group"),
            "source": "openfootball",
            "syncedAt": datetime.now(timezone.utc).isoformat(),
        }
    return parsed


def load_existing() -> dict[str, dict]:
    if not OUT.exists():
        return {}
    data = json.loads(OUT.read_text(encoding="utf-8"))
    existing: dict[str, dict] = {}
    for match in data.get("matches") or []:
        key = match.get("key") or match_key(match.get("home", ""), match.get("away", ""))
        existing[key] = {**match, "key": key}
    return existing


def main() -> None:
    existing = load_existing()
    api_matches = parse_api_matches(fetch_api())
    merged = {**existing, **api_matches}

    payload = {
        "source": "openfootball",
        "updatedAt": datetime.now(timezone.utc).isoformat(),
        "matchCount": len(merged),
        "matches": sorted(
            merged.values(),
            key=lambda m: (m.get("date") or "", m.get("home") or ""),
        ),
    }

    OUT.parent.mkdir(exist_ok=True)
    OUT.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    print(f"Stored {len(merged)} results in {OUT} ({len(api_matches)} from API this run)")


if __name__ == "__main__":
    main()
