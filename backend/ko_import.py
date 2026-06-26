"""Import knockout fixtures from API-Football into ko_matches."""

from __future__ import annotations

import os
from datetime import datetime, timezone

from .db import connect, log_audit, now_iso
from .export import STAGE_ORDER, _sync_module, write_knockout_json

# Longer needles first so "semi-final" wins over "final".
ROUND_TO_STAGE = [
    ("round of 32", "R32"),
    ("round of 16", "R16"),
    ("quarter-final", "QF"),
    ("semi-final", "SF"),
    ("3rd place", "THIRD"),
    ("third place", "THIRD"),
    ("final", "FINAL"),
]

TBD_NAMES = {"tbd", "to be determined", "null", ""}


def round_to_stage(round_name: str | None) -> str | None:
    if not round_name:
        return None
    lower = round_name.lower()
    if "group" in lower:
        return None
    for needle, stage in ROUND_TO_STAGE:
        if needle not in lower:
            continue
        if stage == "FINAL" and "semi" in lower:
            continue
        return stage
    return None


def parse_api_team(team: dict | None) -> str:
    if not team:
        return "TBD"
    name = (team.get("name") or "").strip()
    if not name or name.lower() in TBD_NAMES:
        return "TBD"
    sync = _sync_module()
    return sync.api_team_to_pool(name) or name


def parse_knockout_fixture(fixture: dict) -> dict | None:
    league = fixture.get("league") or {}
    stage = round_to_stage(league.get("round"))
    if not stage:
        return None

    fix = fixture.get("fixture") or {}
    fixture_id = fix.get("id")
    if not fixture_id:
        return None

    kickoff_utc = None
    raw_date = fix.get("date")
    if raw_date:
        kickoff_utc = datetime.fromisoformat(raw_date.replace("Z", "+00:00")).isoformat()

    teams = fixture.get("teams") or {}
    status = (fix.get("status") or {}).get("short") or "NS"

    return {
        "api_fixture_id": int(fixture_id),
        "stage": stage,
        "home": parse_api_team(teams.get("home")),
        "away": parse_api_team(teams.get("away")),
        "kickoff_utc": kickoff_utc,
        "status": status,
        "round": league.get("round"),
    }


def fetch_knockout_fixtures(*, stage: str | None = None, upcoming_only: bool = True) -> list[dict]:
    sync = _sync_module()
    sync.load_dotenv()
    api_key = os.environ.get("API_FOOTBALL_KEY", "").strip()
    if not api_key:
        raise ValueError("API_FOOTBALL_KEY not set")

    url = f"{sync.API_FOOTBALL_BASE}/fixtures?league={sync.WC_LEAGUE_ID}&season={sync.WC_SEASON}"
    payload = sync.fetch_json(url, headers={"x-apisports-key": api_key})

    now = datetime.now(timezone.utc)
    fixtures: list[dict] = []
    for fixture in payload.get("response") or []:
        parsed = parse_knockout_fixture(fixture)
        if not parsed:
            continue
        if stage and parsed["stage"] != stage:
            continue
        if upcoming_only:
            status = parsed["status"]
            if status in sync.FINISHED_STATUSES:
                continue
            kickoff = parsed.get("kickoff_utc")
            if kickoff and status not in sync.LIVE_STATUSES:
                kickoff_dt = datetime.fromisoformat(kickoff.replace("Z", "+00:00"))
                if kickoff_dt < now:
                    continue
        fixtures.append(parsed)

    fixtures.sort(
        key=lambda row: (
            STAGE_ORDER.index(row["stage"]) if row["stage"] in STAGE_ORDER else 99,
            row.get("kickoff_utc") or "",
            row["api_fixture_id"],
        )
    )
    return fixtures


def _find_existing(conn, row: dict):
    existing = conn.execute(
        "SELECT * FROM ko_matches WHERE api_fixture_id = ?",
        (row["api_fixture_id"],),
    ).fetchone()
    if existing:
        return existing

    if not row.get("kickoff_utc"):
        return None

    return conn.execute(
        """
        SELECT * FROM ko_matches
         WHERE api_fixture_id IS NULL
           AND stage = ?
           AND kickoff_utc = ?
         ORDER BY id
         LIMIT 1
        """,
        (row["stage"], row["kickoff_utc"]),
    ).fetchone()


def import_ko_fixtures(
    *,
    stage: str | None = None,
    upcoming_only: bool = True,
    actor: str | None = None,
) -> dict:
    fixtures = fetch_knockout_fixtures(stage=stage, upcoming_only=upcoming_only)
    created = updated = 0
    samples: list[str] = []

    conn = connect()
    try:
        for row in fixtures:
            existing = _find_existing(conn, row)
            if existing:
                conn.execute(
                    """
                    UPDATE ko_matches
                       SET stage = ?, home = ?, away = ?, kickoff_utc = ?,
                           api_fixture_id = ?, source = 'api-football', updated_at = ?
                     WHERE id = ?
                    """,
                    (
                        row["stage"],
                        row["home"],
                        row["away"],
                        row["kickoff_utc"],
                        row["api_fixture_id"],
                        now_iso(),
                        existing["id"],
                    ),
                )
                updated += 1
            else:
                conn.execute(
                    """
                    INSERT INTO ko_matches (
                      stage, home, away, kickoff_utc, published, source,
                      api_fixture_id, updated_at
                    ) VALUES (?, ?, ?, ?, 0, 'api-football', ?, ?)
                    """,
                    (
                        row["stage"],
                        row["home"],
                        row["away"],
                        row["kickoff_utc"],
                        row["api_fixture_id"],
                        now_iso(),
                    ),
                )
                created += 1

            if len(samples) < 5:
                samples.append(f"{row['stage']} {row['home']} v {row['away']}")

        if actor:
            log_audit(
                conn,
                actor,
                "admin_ko_import_api",
                f"created={created} updated={updated} stage={stage or 'all'} upcoming={upcoming_only}",
            )
        conn.commit()
    finally:
        conn.close()

    write_knockout_json(update_results=False)
    return {
        "ok": True,
        "created": created,
        "updated": updated,
        "total": len(fixtures),
        "samples": samples,
    }
