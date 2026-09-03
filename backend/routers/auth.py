"""Authentication router — login + account management.

POST /Ign/v1/auth/login     — authenticate, return JWT
POST /Ign/v1/auth/account   — change username / password (requires auth)
"""

import sqlite3
from datetime import datetime, timedelta, timezone
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from jose import jwt

from core.logger import get_logger
from database import get_db, get_jwt_secret, verify_password, _hash_password
from middleware.auth import get_current_user

log = get_logger("routers.auth")

router = APIRouter()

# Token lifetime: 24 hours (private server, convenience > paranoia)
TOKEN_TTL_HOURS = 24


# ── Request / response models ────────────────────────────────────────

class LoginRequest(BaseModel):
    username: str
    password: str


class LoginResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    username: str


class AccountRequest(BaseModel):
    name: str = Field(default="", description="Username")
    oldpasswd: str = Field(default="", description="Current password for verification")
    newpasswd: str = Field(default="", description="New password (empty to skip)")


class AccountResponse(BaseModel):
    ok: bool = True


# ── Endpoints ────────────────────────────────────────────────────────

@router.post("/Ign/v1/auth/login", response_model=LoginResponse)
def login(body: LoginRequest, conn: sqlite3.Connection = Depends(get_db)):
    """Authenticate with username + password, return a JWT access token.

    First-run: if no user exists yet, the submitted credentials become the
    admin account — effectively registering the first client that connects.
    """
    user = conn.execute("SELECT username, password_hash FROM users WHERE id = 1").fetchone()

    if user is None:
        # ── First-run registration ────────────────────────────
        if not body.username or not body.password:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST,
                                detail="Username and password are required to set up the server")
        conn.execute(
            "INSERT INTO users (id, username, password_hash) VALUES (1, ?, ?)",
            (body.username, _hash_password(body.password)),
        )
        conn.commit()
        log.info(f"First-run setup — account '{body.username}' created")
    else:
        # ── Normal login ──────────────────────────────────────
        if user["username"] != body.username:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED,
                                detail="Invalid username or password")

        if not verify_password(body.password, user["password_hash"]):
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED,
                                detail="Invalid username or password")

    secret = get_jwt_secret(conn)
    now = datetime.now(timezone.utc)
    payload = {
        "sub": body.username,
        "iat": now,
        "exp": now + timedelta(hours=TOKEN_TTL_HOURS),
    }
    token = jwt.encode(payload, secret, algorithm="HS256")

    return LoginResponse(access_token=token, username=body.username)


@router.post("/Ign/v1/auth/account", response_model=AccountResponse)
def update_account(
    body: AccountRequest,
    conn: sqlite3.Connection = Depends(get_db),
    _current: dict = Depends(get_current_user),
):
    """Update account. Always updates username without password check.
    Password is only updated when newpasswd is non-empty, and requires
    oldpasswd verification."""
    user = conn.execute("SELECT username, password_hash FROM users WHERE id = 1").fetchone()
    if user is None:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                            detail="No user account found")

    # 1. Always update username (no verification needed)
    new_name = body.name if body.name else user["username"]

    # 2. Update password only if newpasswd is non-empty
    new_hash = user["password_hash"]
    if body.newpasswd:
        if not verify_password(body.oldpasswd, user["password_hash"]):
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN,
                                detail="Old password is incorrect")
        new_hash = _hash_password(body.newpasswd)

    conn.execute(
        "UPDATE users SET username = ?, password_hash = ? WHERE id = 1",
        (new_name, new_hash),
    )
    conn.commit()

    return AccountResponse()
