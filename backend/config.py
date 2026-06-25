"""Configuration and .env loading for the knockout backend."""

from __future__ import annotations

import os
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
ENV_PATH = ROOT / ".env"


def load_env() -> None:
    if not ENV_PATH.exists():
        return
    for line in ENV_PATH.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        if key:
            os.environ.setdefault(key, value)


load_env()

APP_SECRET = os.environ.get("APP_SECRET", "dev-insecure-secret-change-me")
ADMIN_USERNAME = os.environ.get("ADMIN_USERNAME", "admin")
DEFAULT_PASSWORD = os.environ.get("DEFAULT_PASSWORD", "fifa2026")

DATA_DIR = Path(os.environ.get("OP_DATA_DIR", str(ROOT / "data")))
DB_PATH = Path(os.environ.get("APP_DB", str(DATA_DIR / "app.db")))

# Cookie scope: the app is reverse-proxied under /wc2026/api/, static under /wc2026/.
COOKIE_NAME = os.environ.get("COOKIE_NAME", "op_session")
COOKIE_PATH = os.environ.get("COOKIE_PATH", "/wc2026")
COOKIE_SECURE = os.environ.get("COOKIE_SECURE", "1") == "1"
SESSION_DAYS = int(os.environ.get("SESSION_DAYS", "30"))

# Minutes before kickoff that predictions lock.
CUTOFF_MINUTES = int(os.environ.get("CUTOFF_MINUTES", "60"))

# Default recovery questions offered to users.
SECURITY_QUESTIONS = [
    "What city were you born in?",
    "What was the name of your first school?",
    "What is your mother's maiden name?",
    "What was the name of your first pet?",
    "Who is your favourite football team?",
    "What was your childhood best friend's name?",
]
