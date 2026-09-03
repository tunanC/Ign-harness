"""SQLite persistence layer — connection, init, and dependency injection.

Tables (created on first startup):
  - jwt_secret:  single-row table holding the per-server JWT signing secret
  - users:       single-row table holding the one admin account
  - settings:    key-value store for LLM config and other server-side settings
  - license:     license activation state
  - trace_spans: SPMP execution trace (Phase 3)
"""

import os
import sqlite3
import secrets
from pathlib import Path

DATA_DIR = Path(os.environ.get("IGN_DATA_DIR", Path(__file__).resolve().parent / "data"))
DB_PATH = DATA_DIR / "app.db"


# ---------------------------------------------------------------------------
# Connection helpers
# ---------------------------------------------------------------------------

def get_connection() -> sqlite3.Connection:
    """Return a new SQLite connection. Caller is responsible for closing."""
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(DB_PATH), check_same_thread=False)
    conn.text_factory = str            # explicit UTF-8 text decode/encode
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA encoding = 'UTF-8'")   # set on fresh DB before anything else
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    return conn


# FastAPI dependency — yields a connection and closes it after the request.
def get_db():
    conn = get_connection()
    try:
        yield conn
    finally:
        conn.close()


# ---------------------------------------------------------------------------
# Schema initialisation
# ---------------------------------------------------------------------------

def init_db():
    """Create tables + seed default data. Idempotent — safe to call every startup."""
    conn = get_connection()
    try:
        # ── per-server JWT secret ────────────────────────────
        conn.execute("""
            CREATE TABLE IF NOT EXISTS jwt_secret (
                id INTEGER PRIMARY KEY CHECK (id = 1),
                secret TEXT NOT NULL
            )
        """)
        # Seed random secret if empty
        row = conn.execute("SELECT secret FROM jwt_secret WHERE id = 1").fetchone()
        if row is None:
            conn.execute("INSERT INTO jwt_secret (id, secret) VALUES (1, ?)",
                         (secrets.token_urlsafe(64),))

        # ── user table (single admin account) ────────────────
        conn.execute("""
            CREATE TABLE IF NOT EXISTS users (
                id       INTEGER PRIMARY KEY CHECK (id = 1),
                username TEXT    NOT NULL,
                password_hash TEXT NOT NULL
            )
        """)
        # No default user — first login registers the account.

        # ── settings (key-value) ─────────────────────────────
        conn.execute("""
            CREATE TABLE IF NOT EXISTS settings (
                key   TEXT PRIMARY KEY,
                value TEXT NOT NULL
            )
        """)

        # ── license ──────────────────────────────────────────
        conn.execute("""
            CREATE TABLE IF NOT EXISTS license (
                id       INTEGER PRIMARY KEY CHECK (id = 1),
                activated            INTEGER NOT NULL DEFAULT 0,
                source               TEXT,
                trial_days_remaining INTEGER NOT NULL DEFAULT 60,
                trial_total_days     INTEGER NOT NULL DEFAULT 60,
                machine_code         TEXT,
                licensee             TEXT,
                expire_date          TEXT,
                seats_total          INTEGER,
                seats_used           INTEGER
            )
        """)
        row = conn.execute("SELECT id FROM license WHERE id = 1").fetchone()
        if row is None:
            conn.execute("INSERT INTO license (id) VALUES (1)")

        conn.commit()
    finally:
        conn.close()


# ---------------------------------------------------------------------------
# Convenience accessors (used by routers)
# ---------------------------------------------------------------------------

def get_jwt_secret(conn: sqlite3.Connection) -> str:
    return conn.execute("SELECT secret FROM jwt_secret WHERE id = 1").fetchone()["secret"]


# ── password hashing (hashlib PBKDF2, no external deps) ────────────

import hashlib


def _hash_password(password: str) -> str:
    """Return  salt$hash_hex  for storage."""
    salt = secrets.token_hex(32)
    dk = hashlib.pbkdf2_hmac("sha256", password.encode(), salt.encode(), 600_000)
    return f"{salt}${dk.hex()}"


def verify_password(password: str, stored: str) -> bool:
    """Compare plaintext password against stored salt$hash."""
    salt, hash_hex = stored.split("$", 1)
    dk = hashlib.pbkdf2_hmac("sha256", password.encode(), salt.encode(), 600_000)
    return secrets.compare_digest(dk.hex(), hash_hex)


# ── Assistant name ──────────────────────────────────────────────────

import json as _json


def get_assistant_name(conn: sqlite3.Connection) -> str | None:
    """Read the assistant name from settings, or None if not set."""
    row = conn.execute(
        "SELECT value FROM settings WHERE key = 'assistant_name'"
    ).fetchone()
    if row:
        try:
            return _json.loads(row["value"])
        except (_json.JSONDecodeError, TypeError):
            return row["value"]
    return None
