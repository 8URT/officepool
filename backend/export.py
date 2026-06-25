"""Update knockout results from API-Football and export public knockout.json.

Run as a module from cron:  python -m backend.export
Also called by the API after a prediction or fixture change.
"""

from __future__ import annotations

import importlib.util
import json
import os
from datetime import datetime, timedelta, timezone
from pathlib import Path

from . import config
from .db import connect, now_iso

KNOCKOUT_JSON = config.DATA_DIR / "knockout.json"
ID_OFFSET = 1000  # keep knockout ids from colliding with group match ids (1-72)
STAGE_ORDER = ["R32", "R16", "QF", "SF", "THIRD", "FINAL"]
STAGE_LABELS = {
    "R32": "Round of 32",
    "R16": "Round of 16",
    "QF": "Quarter-finals",
    "SF": "Semi-finals",
    "THIRD": "Third place",
    "FINAL": "Final",
}

_sync = None


def _sync_module():
    global _sync
    if _sync is None:
        path = config.ROOT / "scripts" / "sync-scores.py"
        spec = importlib.util.spec_from_file_location("sync_scores", path)
        module = importlib.util.module_from_spec(spec)
        assert spec.loader is not None
        spec.loader.exec_module(module)
        _sync = module
    return _sync


def public_id(ko_id: int) -> int:
    return ID_OFFSET + ko_id


def match_key(home: str, away: str) -> str:
    return _sync_module().match_key(home, away)


def _parse_dt(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None


def is_locked(kickoff_utc: str | None, now: datetime | None = None) -> bool:
    """A match is locked when within CUTOFF_MINUTES of kickoff (or already started)."""
    kickoff = _parse_dt(kickoff_utc)
    if not kickoff:
        return False
    now = now or datetime.now(timezone.utc)
    return now >= kickoff - timedelta(minutes=config.CUTOFF_MINUTES)


def fetch_api_results() -> dict:
    """Return {match_key: parsed fixture} for all WC fixtures the API knows about."""
    sync = _sync_module()
    sync.load_dotenv()
    api_key = os.environ.get("API_FOOTBALL_KEY", "").strip()
    results: dict = {}
    if not api_key:
        return results
    headers = {"x-apisports-key": api_key}
    urls = [
        f"{sync.API_FOOTBALL_BASE}/fixtures?league={sync.WC_LEAGUE_ID}&season={sync.WC_SEASON}",
        f"{sync.API_FOOTBALL_BASE}/fixtures?live=all",
    ]
    for url in urls:
        try:
            payload = sync.fetch_json(url, headers=headers)
        except Exception as error:  # noqa: BLE001 - network best effort
            print(f"knockout export: API fetch failed ({url}): {error}")
            continue
        for fixture in payload.get("response") or []:
            entry = sync.parse_api_fixture(fixture)
            if entry:
                results[entry["key"]] = entry
    return results


def update_ko_results(conn) -> int:
    """Update ko_matches scores/status from API-Football. Returns rows touched."""
    results = fetch_api_results()
    if not results:
        return 0
    touched = 0
    rows = conn.execute("SELECT * FROM ko_matches").fetchall()
    for row in rows:
        key = match_key(row["home"], row["away"])
        entry = results.get(key)
        if not entry:
            continue
        is_live = 1 if entry.get("isLive") else 0
        status = entry.get("status") or row["status"]
        score_home = entry.get("scoreHome")
        score_away = entry.get("scoreAway")
        conn.execute(
            """
            UPDATE ko_matches
               SET status = ?, score_home = ?, score_away = ?, is_live = ?,
                   minute = ?, source = ?, updated_at = ?
             WHERE id = ?
            """,
            (
                status,
                score_home,
                score_away,
                is_live,
                entry.get("minute"),
                entry.get("source", "api-football"),
                now_iso(),
                row["id"],
            ),
        )
        touched += 1
    conn.commit()
    return touched


def _fmt_date(kickoff_utc: str | None) -> tuple[str | None, str | None]:
    dt = _parse_dt(kickoff_utc)
    if not dt:
        return None, None
    dt = dt.astimezone(timezone.utc)
    return dt.strftime("%Y-%m-%d"), dt.strftime("%H:%M")


def build_knockout_json(conn) -> dict:
    now = datetime.now(timezone.utc)
    matches = conn.execute(
        "SELECT * FROM ko_matches WHERE published = 1 ORDER BY kickoff_utc IS NULL, kickoff_utc, id"
    ).fetchall()

    out_matches = []
    out_scores = []
    revealed_ids: set[int] = set()

    for row in matches:
        date_str, time_str = _fmt_date(row["kickoff_utc"])
        locked = is_locked(row["kickoff_utc"], now)
        finished = row["status"] in {"finished", "FT", "AET", "PEN"}
        live = bool(row["is_live"])
        out_matches.append(
            {
                "id": public_id(row["id"]),
                "koId": row["id"],
                "stage": row["stage"],
                "stageLabel": STAGE_LABELS.get(row["stage"], row["stage"]),
                "home": row["home"],
                "away": row["away"],
                "date": date_str,
                "time": time_str,
                "kickoffUtc": row["kickoff_utc"],
                "locked": locked,
            }
        )
        if (finished or live) and row["score_home"] is not None and row["score_away"] is not None:
            out_scores.append(
                {
                    "home": row["home"],
                    "away": row["away"],
                    "scoreHome": row["score_home"],
                    "scoreAway": row["score_away"],
                    "status": "live" if live else "finished",
                    "isLive": live,
                    "minute": row["minute"],
                    "source": row["source"] or "api-football",
                    "syncedAt": row["updated_at"],
                }
            )
        # Reveal predictions only once the match is locked (cutoff passed).
        if locked or finished or live:
            revealed_ids.add(row["id"])

    predictions: dict[str, dict] = {}
    if revealed_ids:
        placeholders = ",".join("?" for _ in revealed_ids)
        rows = conn.execute(
            f"""
            SELECT u.username AS username, p.ko_match_id AS ko_id,
                   p.pred_home AS home, p.pred_away AS away
              FROM ko_predictions p
              JOIN users u ON u.id = p.user_id
             WHERE p.ko_match_id IN ({placeholders})
            """,
            tuple(revealed_ids),
        ).fetchall()
        for row in rows:
            predictions.setdefault(row["username"], {})[str(public_id(row["ko_id"]))] = {
                "home": row["home"],
                "away": row["away"],
            }

    return {
        "generatedAt": now.isoformat(),
        "stages": STAGE_ORDER,
        "stageLabels": STAGE_LABELS,
        "matches": out_matches,
        "scores": out_scores,
        "predictions": predictions,
    }


def write_knockout_json(update_results: bool = False) -> dict:
    conn = connect()
    try:
        if update_results:
            update_ko_results(conn)
        data = build_knockout_json(conn)
    finally:
        conn.close()
    config.DATA_DIR.mkdir(parents=True, exist_ok=True)
    KNOCKOUT_JSON.write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8")
    return data


def main() -> None:
    data = write_knockout_json(update_results=True)
    print(
        f"knockout.json: {len(data['matches'])} published, "
        f"{len(data['scores'])} with scores, {len(data['predictions'])} users revealed"
    )


if __name__ == "__main__":
    main()
