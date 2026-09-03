"""JWT authentication dependency for FastAPI.

Every protected endpoint uses  Depends(get_current_user)  which:
  1. Reads the Authorization: Bearer <token> header
  2. Loads the per-server JWT secret from SQLite
  3. Verifies the token signature + expiry
"""

import sqlite3
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from jose import jwt, JWTError

from database import get_db, get_jwt_secret

security = HTTPBearer()


def get_current_user(
    credentials: HTTPAuthorizationCredentials = Depends(security),
    conn: sqlite3.Connection = Depends(get_db),
) -> dict:
    """Validate JWT and return the decoded payload (contains username)."""
    token = credentials.credentials
    secret = get_jwt_secret(conn)
    try:
        payload = jwt.decode(token, secret, algorithms=["HS256"])
        username: str | None = payload.get("sub")
        if username is None:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED,
                                detail="Invalid token: missing subject")
        return {"username": username}
    except JWTError:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED,
                            detail="Invalid or expired token")
