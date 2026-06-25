"""SQLite schema and connection helpers."""

from __future__ import annotations

import sqlite3
from datetime import datetime, timezone

from . import config

SCHEMA = """
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL,
  username_lc TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  must_change_password INTEGER NOT NULL DEFAULT 1,
  dob TEXT,
  security_question TEXT,
  security_answer_hash TEXT,
  role TEXT NOT NULL DEFAULT 'user',
  failed_attempts INTEGER NOT NULL DEFAULT 0,
  locked_until TEXT,
  last_login TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS ko_matches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  stage TEXT NOT NULL,
  slot INTEGER,
  home TEXT NOT NULL,
  away TEXT NOT NULL,
  kickoff_utc TEXT,
  status TEXT NOT NULL DEFAULT 'scheduled',
  score_home INTEGER,
  score_away INTEGER,
  is_live INTEGER NOT NULL DEFAULT 0,
  minute INTEGER,
  published INTEGER NOT NULL DEFAULT 0,
  source TEXT,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS ko_predictions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  ko_match_id INTEGER NOT NULL REFERENCES ko_matches(id) ON DELETE CASCADE,
  pred_home INTEGER NOT NULL,
  pred_away INTEGER NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(user_id, ko_match_id)
);

CREATE TABLE IF NOT EXISTS audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts TEXT NOT NULL,
  actor TEXT,
  action TEXT NOT NULL,
  detail TEXT
);
"""


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def connect() -> sqlite3.Connection:
    config.DATA_DIR.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(config.DB_PATH), timeout=15)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    return conn


def init_db() -> None:
    conn = connect()
    try:
        conn.executescript(SCHEMA)
        conn.commit()
    finally:
        conn.close()


def log_audit(conn: sqlite3.Connection, actor: str | None, action: str, detail: str = "") -> None:
    conn.execute(
        "INSERT INTO audit (ts, actor, action, detail) VALUES (?, ?, ?, ?)",
        (now_iso(), actor, action, detail),
    )
