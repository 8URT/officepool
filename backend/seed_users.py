"""Seed user accounts from the participants list in data/pool.json.

Creates one account per participant (default password) plus an admin account.
Idempotent: existing users are left untouched (password not reset).

  python -m backend.seed_users
"""

from __future__ import annotations

import json

from . import config
from .db import connect, init_db, log_audit, now_iso
from .security import hash_secret

POOL_PATH = config.ROOT / "data" / "pool.json"


def participants() -> list[str]:
    data = json.loads(POOL_PATH.read_text(encoding="utf-8"))
    return list(data.get("participants") or [])


def upsert_user(conn, username: str, role: str = "user") -> bool:
    exists = conn.execute(
        "SELECT 1 FROM users WHERE username_lc = ?", (username.lower(),)
    ).fetchone()
    if exists:
        return False
    ts = now_iso()
    conn.execute(
        """
        INSERT INTO users (username, username_lc, password_hash, must_change_password, role,
                           created_at, updated_at)
        VALUES (?, ?, ?, 1, ?, ?, ?)
        """,
        (username, username.lower(), hash_secret(config.DEFAULT_PASSWORD), role, ts, ts),
    )
    return True


def main() -> None:
    init_db()
    conn = connect()
    try:
        created = 0
        for name in participants():
            if upsert_user(conn, name):
                created += 1
        admin_created = upsert_user(conn, config.ADMIN_USERNAME, role="admin")
        # Make sure the admin account always has the admin role.
        conn.execute(
            "UPDATE users SET role = 'admin' WHERE username_lc = ?",
            (config.ADMIN_USERNAME.lower(),),
        )
        log_audit(conn, "system", "seed_users", f"created={created} admin_created={admin_created}")
        conn.commit()
        print(
            f"Seeded users: {created} new participant accounts; "
            f"admin '{config.ADMIN_USERNAME}' {'created' if admin_created else 'exists'}. "
            f"Default password: {config.DEFAULT_PASSWORD}"
        )
    finally:
        conn.close()


if __name__ == "__main__":
    main()
