"""Password / answer hashing (stdlib pbkdf2) and token helpers.

PBKDF2-HMAC-SHA256 is used because it is always available in the stdlib
(no OpenSSL scrypt dependency), so it works identically on macOS dev and the
Ubuntu droplet.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import os
import secrets

PBKDF2_ALGO = "sha256"
PBKDF2_ITERATIONS = 200_000
PBKDF2_DKLEN = 32


def _b64(raw: bytes) -> str:
    return base64.b64encode(raw).decode("ascii")


def _ub64(text: str) -> bytes:
    return base64.b64decode(text.encode("ascii"))


def hash_secret(value: str, *, iterations: int = PBKDF2_ITERATIONS) -> str:
    salt = os.urandom(16)
    dk = hashlib.pbkdf2_hmac(PBKDF2_ALGO, value.encode("utf-8"), salt, iterations, PBKDF2_DKLEN)
    return f"pbkdf2${PBKDF2_ALGO}${iterations}${_b64(salt)}${_b64(dk)}"


def verify_secret(value: str, stored: str | None) -> bool:
    if not stored:
        return False
    try:
        algo, hashname, iterations, salt_b64, hash_b64 = stored.split("$")
        if algo != "pbkdf2":
            return False
        salt = _ub64(salt_b64)
        expected = _ub64(hash_b64)
        dk = hashlib.pbkdf2_hmac(
            hashname, value.encode("utf-8"), salt, int(iterations), len(expected)
        )
        return hmac.compare_digest(dk, expected)
    except Exception:
        return False


def normalize_answer(answer: str) -> str:
    return " ".join((answer or "").strip().lower().split())


def new_token() -> str:
    return secrets.token_urlsafe(32)
