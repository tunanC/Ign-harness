"""Settings router — LLM/STT config and combined info.

GET  /Ign/v1/settings/info       → return LLM + STT config + license status
POST /Ign/v1/settings            → save settings (llm / stt)
POST /Ign/v1/settings/test-llm  → test LLM connectivity
"""

import sqlite3
import json
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
import httpx

from database import get_db, get_assistant_name
from middleware.auth import get_current_user

router = APIRouter()


# ── Models ────────────────────────────────────────────────────────────

class LLMConfig(BaseModel):
    provider: str = "openai_compatible"
    api_url: str = ""
    api_key: str = ""
    model: str = ""


class STTConfig(BaseModel):
    """语音识别（STT）配置——与文本 LLM 同样的保存方式（settings 表 stt 键）。"""

    api_url: str = ""
    api_key: str = ""
    model: str = ""


class SettingsRequest(BaseModel):
    llm: LLMConfig | None = None
    stt: STTConfig | None = None


class LicenseInfo(BaseModel):
    activated: bool = False
    source: str | None = None
    trial_days_remaining: int = 60
    trial_total_days: int = 60
    machine_code: str | None = None
    licensee: str | None = None
    expire_date: str | None = None
    seats_total: int | None = None
    seats_used: int | None = None

    class Config:
        from_attributes = True


class SettingsInfo(BaseModel):
    llm: LLMConfig
    stt: STTConfig
    license: LicenseInfo


# ── Helpers ───────────────────────────────────────────────────────────

def _get_settings(conn: sqlite3.Connection) -> dict:
    rows = conn.execute("SELECT key, value FROM settings").fetchall()
    return {r["key"]: json.loads(r["value"]) for r in rows}


def _get_llm_config(conn: sqlite3.Connection) -> LLMConfig:
    cfg = _get_settings(conn)
    llm_raw = cfg.get("llm", {})
    return LLMConfig(
        provider=llm_raw.get("provider", "openai_compatible"),
        api_url=llm_raw.get("api_url", ""),
        api_key=llm_raw.get("api_key", ""),
        model=llm_raw.get("model", ""),
    )


def _get_stt_config(conn: sqlite3.Connection) -> STTConfig:
    cfg = _get_settings(conn)
    stt_raw = cfg.get("stt", {})
    return STTConfig(
        api_url=stt_raw.get("api_url", ""),
        api_key=stt_raw.get("api_key", ""),
        model=stt_raw.get("model", ""),
    )


def _get_license(conn: sqlite3.Connection) -> LicenseInfo:
    row = conn.execute("SELECT * FROM license WHERE id = 1").fetchone()
    if row is None:
        return LicenseInfo()
    return LicenseInfo(
        activated=bool(row["activated"]),
        source=row["source"],
        trial_days_remaining=row["trial_days_remaining"],
        trial_total_days=row["trial_total_days"],
        machine_code=row["machine_code"],
        licensee=row["licensee"],
        expire_date=row["expire_date"],
        seats_total=row["seats_total"],
        seats_used=row["seats_used"],
    )


# ── Endpoints ─────────────────────────────────────────────────────────

@router.get("/Ign/v1/settings/info", response_model=SettingsInfo)
def get_settings_info(conn: sqlite3.Connection = Depends(get_db)):
    return SettingsInfo(
        llm=_get_llm_config(conn),
        stt=_get_stt_config(conn),
        license=_get_license(conn),
    )


@router.post("/Ign/v1/settings")
def save_settings(body: SettingsRequest, conn: sqlite3.Connection = Depends(get_db)):
    # llm / stt 均存 settings 表（INSERT OR REPLACE），保存方式一致
    for key, cfg in (("llm", body.llm), ("stt", body.stt)):
        if cfg is not None:
            value = json.dumps(cfg.model_dump())
            conn.execute(
                "INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)", (key, value)
            )
            conn.commit()
    return {"ok": True}


@router.post("/Ign/v1/settings/test-llm")
async def test_llm(body: LLMConfig):
    """Send a minimal chat completion request to verify LLM connectivity."""
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.post(
                f"{body.api_url.rstrip('/')}/chat/completions",
                headers={
                    "Authorization": f"Bearer {body.api_key}",
                    "Content-Type": "application/json",
                },
                json={
                    "model": body.model,
                    "messages": [{"role": "user", "content": "ping"}],
                    "max_tokens": 5,
                },
            )
        if resp.status_code == 200:
            data = resp.json()
            return {
                "ok": True,
                "model": body.model,
                "latency_ms": int(resp.elapsed.total_seconds() * 1000),
            }
        return {"ok": False, "error": f"HTTP {resp.status_code}: {resp.text}"}
    except Exception as e:
        return {"ok": False, "error": str(e)}


# ── Assistant name ──────────────────────────────────────────────────────


class AssistantNameRequest(BaseModel):
    name: str


class AssistantInfo(BaseModel):
    name: str
    persona: str


@router.get("/Ign/v1/settings/assistant", response_model=AssistantInfo)
def get_assistant(
    conn: sqlite3.Connection = Depends(get_db),
    _user: dict = Depends(get_current_user),
):
    from core.persona import persona_manager
    return AssistantInfo(
        name=persona_manager.name,
        persona=persona_manager.get_persona_text(),
    )


@router.post("/Ign/v1/settings/assistant")
def update_assistant(
    body: AssistantNameRequest,
    _user: dict = Depends(get_current_user),
):
    from core.persona import persona_manager
    if not body.name or not body.name.strip():
        raise HTTPException(status_code=422, detail="名称不能为空")
    persona_manager.set_name(body.name.strip())
    return {"ok": True, "name": persona_manager.name}
