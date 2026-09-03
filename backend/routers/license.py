"""License router.

GET  /Ign/v1/license/status   → current license state
POST /Ign/v1/license/activate → submit license key (mock for Phase 1)
"""

import sqlite3
from fastapi import APIRouter, Depends
from pydantic import BaseModel

from database import get_db
from routers.settings import LicenseInfo, _get_license

router = APIRouter()


class ActivateRequest(BaseModel):
    license_key: str


class ActivateResponse(BaseModel):
    ok: bool
    license: LicenseInfo


@router.get("/Ign/v1/license/status", response_model=LicenseInfo)
def license_status(conn: sqlite3.Connection = Depends(get_db)):
    return _get_license(conn)


@router.post("/Ign/v1/license/activate", response_model=ActivateResponse)
def activate_license(body: ActivateRequest, conn: sqlite3.Connection = Depends(get_db)):
    """Mock activation — always succeeds in Phase 1."""
    conn.execute("""
        UPDATE license SET activated = 1, source = 'personal', licensee = 'Licensed User'
        WHERE id = 1
    """)
    conn.commit()
    return ActivateResponse(ok=True, license=_get_license(conn))
