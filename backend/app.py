"""FastAPI app: auth, knockout predictions, recovery, and admin.

Reverse-proxied by Apache at /wc2026/api/ -> 127.0.0.1:8001/
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import Cookie, Depends, FastAPI, HTTPException, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from . import config
from .db import connect, init_db, log_audit, now_iso
from .export import is_locked, public_id, write_knockout_json
from .ko_import import import_ko_fixtures
from .security import hash_secret, new_token, normalize_answer, verify_secret

app = FastAPI(title="Office Pool Knockout API", docs_url=None, redoc_url=None)

# Local dev only: allow the static site served from localhost to call the API
# with cookies. In production the site and API share an origin (no CORS needed).
app.add_middleware(
    CORSMiddleware,
    allow_origin_regex=r"https?://(localhost|127\.0\.0\.1)(:\d+)?",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

MAX_FAILED = 5
LOCK_MINUTES = 15


@app.on_event("startup")
def _startup() -> None:
    init_db()


# --------------------------------------------------------------------------- #
# Helpers
# --------------------------------------------------------------------------- #
def _parse_dt(value: Optional[str]) -> Optional[datetime]:
    if not value:
        return None
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None


def get_session_user(token: Optional[str]):
    if not token:
        return None
    conn = connect()
    try:
        row = conn.execute(
            """
            SELECT u.*, s.token AS session_token, s.expires_at AS session_expires
              FROM sessions s JOIN users u ON u.id = s.user_id
             WHERE s.token = ?
            """,
            (token,),
        ).fetchone()
        if not row:
            return None
        expires = _parse_dt(row["session_expires"])
        if expires and expires < datetime.now(timezone.utc):
            conn.execute("DELETE FROM sessions WHERE token = ?", (token,))
            conn.commit()
            return None
        return dict(row)
    finally:
        conn.close()


def require_user(op_session: Optional[str] = Cookie(default=None)):
    user = get_session_user(op_session)
    if not user:
        raise HTTPException(status_code=401, detail="Not logged in")
    return user


def require_ready_user(user=Depends(require_user)):
    if user["must_change_password"]:
        raise HTTPException(status_code=403, detail="Finish first-time setup")
    return user


def require_admin(user=Depends(require_user)):
    if user["role"] != "admin":
        raise HTTPException(status_code=403, detail="Admin only")
    return user


def _set_session_cookie(response: Response, token: str) -> None:
    response.set_cookie(
        key=config.COOKIE_NAME,
        value=token,
        max_age=config.SESSION_DAYS * 24 * 3600,
        path=config.COOKIE_PATH,
        httponly=True,
        secure=config.COOKIE_SECURE,
        samesite="lax",
    )


def _public_user(user: dict) -> dict:
    return {
        "username": user["username"],
        "role": user["role"],
        "mustChangePassword": bool(user["must_change_password"]),
        "needsRecoverySetup": not (user["dob"] and user["security_question"]),
    }


# --------------------------------------------------------------------------- #
# Models
# --------------------------------------------------------------------------- #
class LoginIn(BaseModel):
    username: str
    password: str


class FirstSetupIn(BaseModel):
    new_password: str = Field(min_length=6, max_length=128)
    dob: str = Field(min_length=4, max_length=20)
    security_question: str = Field(min_length=3, max_length=200)
    security_answer: str = Field(min_length=1, max_length=200)


class ChangePasswordIn(BaseModel):
    current_password: str
    new_password: str = Field(min_length=6, max_length=128)


class RecoveryInfoIn(BaseModel):
    dob: str = Field(min_length=4, max_length=20)
    security_question: str = Field(min_length=3, max_length=200)
    security_answer: str = Field(min_length=1, max_length=200)


class RecoveryResetIn(BaseModel):
    username: str
    dob: str
    security_answer: str
    new_password: str = Field(min_length=6, max_length=128)


class PredictionIn(BaseModel):
    ko_match_id: int
    home: int = Field(ge=0, le=99)
    away: int = Field(ge=0, le=99)


class AdminResetIn(BaseModel):
    username: str


class AdminMatchIn(BaseModel):
    id: Optional[int] = None
    stage: str
    slot: Optional[int] = None
    home: str
    away: str
    kickoff_utc: Optional[str] = None
    published: bool = False


class AdminPublishIn(BaseModel):
    stage: str
    published: bool = True


class AdminImportKoIn(BaseModel):
    stage: Optional[str] = None
    upcoming_only: bool = True


# --------------------------------------------------------------------------- #
# Health / meta
# --------------------------------------------------------------------------- #
@app.get("/health")
def health():
    return {"ok": True, "time": now_iso()}


@app.get("/meta")
def meta():
    return {"securityQuestions": config.SECURITY_QUESTIONS, "cutoffMinutes": config.CUTOFF_MINUTES}


# --------------------------------------------------------------------------- #
# Auth
# --------------------------------------------------------------------------- #
@app.post("/auth/login")
def login(body: LoginIn, response: Response):
    username = body.username.strip()
    conn = connect()
    try:
        user = conn.execute(
            "SELECT * FROM users WHERE username_lc = ?", (username.lower(),)
        ).fetchone()
        if not user:
            raise HTTPException(status_code=401, detail="Unknown user or wrong password")

        locked_until = _parse_dt(user["locked_until"])
        if locked_until and locked_until > datetime.now(timezone.utc):
            raise HTTPException(status_code=429, detail="Account temporarily locked. Try later.")

        if not verify_secret(body.password, user["password_hash"]):
            attempts = user["failed_attempts"] + 1
            lock = None
            if attempts >= MAX_FAILED:
                lock = (datetime.now(timezone.utc) + timedelta(minutes=LOCK_MINUTES)).isoformat()
                attempts = 0
            conn.execute(
                "UPDATE users SET failed_attempts = ?, locked_until = ? WHERE id = ?",
                (attempts, lock, user["id"]),
            )
            conn.commit()
            raise HTTPException(status_code=401, detail="Unknown user or wrong password")

        token = new_token()
        expires = (datetime.now(timezone.utc) + timedelta(days=config.SESSION_DAYS)).isoformat()
        conn.execute(
            "INSERT INTO sessions (token, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)",
            (token, user["id"], now_iso(), expires),
        )
        conn.execute(
            "UPDATE users SET failed_attempts = 0, locked_until = NULL, last_login = ? WHERE id = ?",
            (now_iso(), user["id"]),
        )
        conn.commit()
        _set_session_cookie(response, token)
        return _public_user(dict(user))
    finally:
        conn.close()


@app.post("/auth/logout")
def logout(response: Response, op_session: Optional[str] = Cookie(default=None)):
    if op_session:
        conn = connect()
        try:
            conn.execute("DELETE FROM sessions WHERE token = ?", (op_session,))
            conn.commit()
        finally:
            conn.close()
    response.delete_cookie(config.COOKIE_NAME, path=config.COOKIE_PATH)
    return {"ok": True}


@app.get("/auth/me")
def me(user=Depends(require_user)):
    return _public_user(user)


@app.post("/auth/first-setup")
def first_setup(body: FirstSetupIn, user=Depends(require_user)):
    conn = connect()
    try:
        conn.execute(
            """
            UPDATE users
               SET password_hash = ?, must_change_password = 0, dob = ?,
                   security_question = ?, security_answer_hash = ?, updated_at = ?
             WHERE id = ?
            """,
            (
                hash_secret(body.new_password),
                body.dob.strip(),
                body.security_question.strip(),
                hash_secret(normalize_answer(body.security_answer)),
                now_iso(),
                user["id"],
            ),
        )
        log_audit(conn, user["username"], "first_setup")
        conn.commit()
    finally:
        conn.close()
    return {"ok": True}


# --------------------------------------------------------------------------- #
# Account management
# --------------------------------------------------------------------------- #
@app.post("/account/password")
def change_password(body: ChangePasswordIn, user=Depends(require_user)):
    if not verify_secret(body.current_password, user["password_hash"]):
        raise HTTPException(status_code=400, detail="Current password is incorrect")
    conn = connect()
    try:
        conn.execute(
            "UPDATE users SET password_hash = ?, must_change_password = 0, updated_at = ? WHERE id = ?",
            (hash_secret(body.new_password), now_iso(), user["id"]),
        )
        log_audit(conn, user["username"], "change_password")
        conn.commit()
    finally:
        conn.close()
    return {"ok": True}


@app.post("/account/recovery")
def update_recovery(body: RecoveryInfoIn, user=Depends(require_user)):
    conn = connect()
    try:
        conn.execute(
            "UPDATE users SET dob = ?, security_question = ?, security_answer_hash = ?, updated_at = ? WHERE id = ?",
            (
                body.dob.strip(),
                body.security_question.strip(),
                hash_secret(normalize_answer(body.security_answer)),
                now_iso(),
                user["id"],
            ),
        )
        log_audit(conn, user["username"], "update_recovery")
        conn.commit()
    finally:
        conn.close()
    return {"ok": True}


# --------------------------------------------------------------------------- #
# Recovery (no session)
# --------------------------------------------------------------------------- #
@app.get("/recovery/question")
def recovery_question(username: str):
    conn = connect()
    try:
        user = conn.execute(
            "SELECT security_question, dob FROM users WHERE username_lc = ?",
            (username.strip().lower(),),
        ).fetchone()
    finally:
        conn.close()
    if not user or not user["security_question"]:
        # Do not reveal whether the user exists; return a generic message.
        raise HTTPException(status_code=404, detail="No recovery question set for this account")
    return {"securityQuestion": user["security_question"]}


@app.post("/recovery/reset")
def recovery_reset(body: RecoveryResetIn):
    conn = connect()
    try:
        user = conn.execute(
            "SELECT * FROM users WHERE username_lc = ?", (body.username.strip().lower(),)
        ).fetchone()
        if not user or not user["security_answer_hash"]:
            raise HTTPException(status_code=400, detail="Recovery not available for this account")

        locked_until = _parse_dt(user["locked_until"])
        if locked_until and locked_until > datetime.now(timezone.utc):
            raise HTTPException(status_code=429, detail="Too many attempts. Try later.")

        dob_ok = (user["dob"] or "").strip() == body.dob.strip()
        answer_ok = verify_secret(normalize_answer(body.security_answer), user["security_answer_hash"])
        if not (dob_ok and answer_ok):
            attempts = user["failed_attempts"] + 1
            lock = None
            if attempts >= MAX_FAILED:
                lock = (datetime.now(timezone.utc) + timedelta(minutes=LOCK_MINUTES)).isoformat()
                attempts = 0
            conn.execute(
                "UPDATE users SET failed_attempts = ?, locked_until = ? WHERE id = ?",
                (attempts, lock, user["id"]),
            )
            log_audit(conn, user["username"], "recovery_failed")
            conn.commit()
            raise HTTPException(status_code=400, detail="Recovery details do not match")

        conn.execute(
            """
            UPDATE users SET password_hash = ?, must_change_password = 0,
                   failed_attempts = 0, locked_until = NULL, updated_at = ?
             WHERE id = ?
            """,
            (hash_secret(body.new_password), now_iso(), user["id"]),
        )
        conn.execute("DELETE FROM sessions WHERE user_id = ?", (user["id"],))
        log_audit(conn, user["username"], "recovery_reset")
        conn.commit()
    finally:
        conn.close()
    return {"ok": True}


# --------------------------------------------------------------------------- #
# Knockout predictions
# --------------------------------------------------------------------------- #
@app.get("/ko/matches")
def ko_matches(user=Depends(require_ready_user)):
    conn = connect()
    try:
        rows = conn.execute(
            "SELECT * FROM ko_matches WHERE published = 1 "
            "ORDER BY kickoff_utc IS NULL, kickoff_utc, id"
        ).fetchall()
        preds = {
            row["ko_match_id"]: {"home": row["pred_home"], "away": row["pred_away"]}
            for row in conn.execute(
                "SELECT ko_match_id, pred_home, pred_away FROM ko_predictions WHERE user_id = ?",
                (user["id"],),
            ).fetchall()
        }
    finally:
        conn.close()

    out = []
    for row in rows:
        locked = is_locked(row["kickoff_utc"])
        pred = preds.get(row["id"])
        out.append(
            {
                "id": row["id"],
                "stage": row["stage"],
                "home": row["home"],
                "away": row["away"],
                "kickoffUtc": row["kickoff_utc"],
                "locked": locked,
                "status": row["status"],
                "scoreHome": row["score_home"],
                "scoreAway": row["score_away"],
                "prediction": pred,
            }
        )
    return {"matches": out}


@app.put("/ko/predictions")
def save_prediction(body: PredictionIn, user=Depends(require_ready_user)):
    conn = connect()
    try:
        match = conn.execute(
            "SELECT * FROM ko_matches WHERE id = ?", (body.ko_match_id,)
        ).fetchone()
        if not match or not match["published"]:
            raise HTTPException(status_code=404, detail="Match not available")
        if is_locked(match["kickoff_utc"]):
            raise HTTPException(
                status_code=403,
                detail=f"Predictions locked {config.CUTOFF_MINUTES} minutes before kickoff",
            )
        conn.execute(
            """
            INSERT INTO ko_predictions (user_id, ko_match_id, pred_home, pred_away, updated_at)
            VALUES (?, ?, ?, ?, ?)
            ON CONFLICT(user_id, ko_match_id)
            DO UPDATE SET pred_home = excluded.pred_home,
                          pred_away = excluded.pred_away,
                          updated_at = excluded.updated_at
            """,
            (user["id"], body.ko_match_id, body.home, body.away, now_iso()),
        )
        conn.commit()
    finally:
        conn.close()
    # Refresh the public export (cheap; no API call here).
    try:
        write_knockout_json(update_results=False)
    except Exception as error:  # noqa: BLE001
        print(f"knockout export after save failed: {error}")
    return {"ok": True}


# --------------------------------------------------------------------------- #
# Admin
# --------------------------------------------------------------------------- #
@app.get("/admin/users")
def admin_users(admin=Depends(require_admin)):
    conn = connect()
    try:
        rows = conn.execute(
            "SELECT username, role, must_change_password, dob IS NOT NULL AS has_dob, "
            "security_question IS NOT NULL AS has_q, last_login, locked_until "
            "FROM users ORDER BY username COLLATE NOCASE"
        ).fetchall()
    finally:
        conn.close()
    return {
        "users": [
            {
                "username": r["username"],
                "role": r["role"],
                "mustChangePassword": bool(r["must_change_password"]),
                "recoveryReady": bool(r["has_dob"] and r["has_q"]),
                "lastLogin": r["last_login"],
                "locked": bool(r["locked_until"]),
            }
            for r in rows
        ]
    }


@app.post("/admin/reset-password")
def admin_reset_password(body: AdminResetIn, admin=Depends(require_admin)):
    conn = connect()
    try:
        user = conn.execute(
            "SELECT * FROM users WHERE username_lc = ?", (body.username.strip().lower(),)
        ).fetchone()
        if not user:
            raise HTTPException(status_code=404, detail="User not found")
        conn.execute(
            """
            UPDATE users SET password_hash = ?, must_change_password = 1,
                   failed_attempts = 0, locked_until = NULL, updated_at = ?
             WHERE id = ?
            """,
            (hash_secret(config.DEFAULT_PASSWORD), now_iso(), user["id"]),
        )
        conn.execute("DELETE FROM sessions WHERE user_id = ?", (user["id"],))
        log_audit(conn, admin["username"], "admin_reset_password", body.username)
        conn.commit()
    finally:
        conn.close()
    return {"ok": True, "defaultPassword": config.DEFAULT_PASSWORD}


@app.get("/admin/ko/matches")
def admin_ko_matches(admin=Depends(require_admin)):
    conn = connect()
    try:
        rows = conn.execute(
            "SELECT * FROM ko_matches ORDER BY stage, kickoff_utc IS NULL, kickoff_utc, id"
        ).fetchall()
    finally:
        conn.close()
    return {"matches": [dict(r) for r in rows]}


@app.post("/admin/ko/match")
def admin_ko_match(body: AdminMatchIn, admin=Depends(require_admin)):
    conn = connect()
    try:
        if body.id:
            conn.execute(
                """
                UPDATE ko_matches SET stage = ?, slot = ?, home = ?, away = ?,
                       kickoff_utc = ?, published = ?, updated_at = ?
                 WHERE id = ?
                """,
                (
                    body.stage,
                    body.slot,
                    body.home.strip(),
                    body.away.strip(),
                    body.kickoff_utc,
                    1 if body.published else 0,
                    now_iso(),
                    body.id,
                ),
            )
            action = "admin_ko_update"
            detail = f"{body.id} {body.home} v {body.away}"
        else:
            conn.execute(
                """
                INSERT INTO ko_matches (stage, slot, home, away, kickoff_utc, published, source, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, 'admin', ?)
                """,
                (
                    body.stage,
                    body.slot,
                    body.home.strip(),
                    body.away.strip(),
                    body.kickoff_utc,
                    1 if body.published else 0,
                    now_iso(),
                ),
            )
            action = "admin_ko_create"
            detail = f"{body.stage} {body.home} v {body.away}"
        log_audit(conn, admin["username"], action, detail)
        conn.commit()
    finally:
        conn.close()
    try:
        write_knockout_json(update_results=False)
    except Exception as error:  # noqa: BLE001
        print(f"knockout export after admin change failed: {error}")
    return {"ok": True}


@app.post("/admin/ko/publish")
def admin_ko_publish(body: AdminPublishIn, admin=Depends(require_admin)):
    conn = connect()
    try:
        conn.execute(
            "UPDATE ko_matches SET published = ?, updated_at = ? WHERE stage = ?",
            (1 if body.published else 0, now_iso(), body.stage),
        )
        log_audit(conn, admin["username"], "admin_ko_publish", f"{body.stage}={body.published}")
        conn.commit()
    finally:
        conn.close()
    try:
        write_knockout_json(update_results=False)
    except Exception as error:  # noqa: BLE001
        print(f"knockout export after publish failed: {error}")
    return {"ok": True}


@app.post("/admin/ko/import-api")
def admin_ko_import_api(body: AdminImportKoIn, admin=Depends(require_admin)):
    if body.stage and body.stage not in {"R32", "R16", "QF", "SF", "THIRD", "FINAL"}:
        raise HTTPException(status_code=400, detail="Invalid stage")
    try:
        return import_ko_fixtures(
            stage=body.stage,
            upcoming_only=body.upcoming_only,
            actor=admin["username"],
        )
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error
    except Exception as error:  # noqa: BLE001
        raise HTTPException(status_code=502, detail=f"API import failed: {error}") from error


@app.get("/admin/audit")
def admin_audit(admin=Depends(require_admin)):
    conn = connect()
    try:
        rows = conn.execute(
            "SELECT ts, actor, action, detail FROM audit ORDER BY id DESC LIMIT 200"
        ).fetchall()
    finally:
        conn.close()
    return {"audit": [dict(r) for r in rows]}


@app.exception_handler(HTTPException)
def http_exc_handler(request, exc: HTTPException):
    return JSONResponse(status_code=exc.status_code, content={"error": exc.detail})
