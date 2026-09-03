"""Speech router — 语音识别（STT）。

POST /Ign/v1/speech/recognize — 上传音频，返回识别文字（非实时，整段）。

WS   /Ign/v1/speech/ws — 实时语音识别中继：眼镜端 ⇄ Server ⇄ STT provider。
    鉴权：JWT 走 ?token= query 参数（浏览器 WebSocket 无法带请求头）。
    流程：读 DB settings 表 stt 键（api_url/api_key/model）→ 带 Authorization
    头连 provider WS → 发 run-task → 双向转发（PCM/指令 ↔ 事件）。
"""

import asyncio
import json
import uuid

import websockets
from fastapi import APIRouter, File, HTTPException, Request, UploadFile, WebSocket
from jose import JWTError, jwt

from core.llm_client import LLMError
from core.logger import get_logger
from database import get_connection, get_jwt_secret

log = get_logger("routers.speech")

router = APIRouter()

MAX_AUDIO_BYTES = 10 * 1024 * 1024  # 10 MB


@router.post("/Ign/v1/speech/recognize")
async def recognize_speech(request: Request, file: UploadFile = File(...)):
    """识别上传的音频（webm/ogg/mp3/wav…），返回文字。"""
    data = await file.read()
    if not data:
        raise HTTPException(status_code=400, detail="Empty audio upload")
    if len(data) > MAX_AUDIO_BYTES:
        raise HTTPException(status_code=400, detail="Audio too large (max 10 MB)")

    llm_client = request.app.state.llm_client
    try:
        text = await llm_client.transcribe(data, filename=file.filename or "audio.webm")
    except LLMError as exc:
        log.warning(f"语音识别失败: {exc}")
        raise HTTPException(status_code=502, detail=str(exc))

    log.info(f"STT ok ({len(data)} bytes, {file.content_type}) -> {text[:40]}…")
    return {"text": text}


# ── 实时识别：WS 中继（眼镜 ⇄ Server ⇄ STT provider） ─────────────────

def _load_stt_ws_config() -> dict:
    """从 DB settings 表读 stt 键（实时识别必须三项齐全，不回退 llm 键）。

    llm 键是文本 LLM 配置，走不了实时 ASR 协议，缺配置直接报错提示用户。
    """
    conn = get_connection()
    try:
        row = conn.execute("SELECT value FROM settings WHERE key = 'stt'").fetchone()
        if row is None:
            raise LLMError("语音识别未配置，请先在 Settings 中填写 STT 配置")
        cfg = json.loads(row["value"])
        if not (cfg.get("api_url") and cfg.get("api_key") and cfg.get("model")):
            raise LLMError("语音识别配置不完整，请先在 Settings 中填写 STT 配置")
        return {
            "api_url": cfg["api_url"].rstrip("/"),
            "api_key": cfg["api_key"],
            "model": cfg["model"],
        }
    finally:
        conn.close()


def _check_token(token: str) -> bool:
    """校验 JWT（与 middleware/auth 同规则，但 token 来自 query 参数）。"""
    conn = get_connection()
    try:
        secret = get_jwt_secret(conn)
    finally:
        conn.close()
    try:
        payload = jwt.decode(token, secret, algorithms=["HS256"])
        return bool(payload.get("sub"))
    except JWTError:
        return False


@router.websocket("/Ign/v1/speech/ws")
async def speech_ws(ws: WebSocket):
    """实时语音识别中继：读 DB 配置连 provider，双向转发帧。

    眼镜端协议（本端点）：
      → 二进制 PCM 帧（16kHz/16bit 单声道，原样转发 provider）
      → {"type":"finish"}（Server 转成 finish-task 发 provider）
      ← provider 事件原样转发（task-started/result-generated/task-finished/task-failed）
      ← {"type":"error","message":…}（配置缺失/连接失败）
    """
    if not _check_token(ws.query_params.get("token", "")):
        await ws.close(code=4002, reason="Invalid or missing token")
        return

    try:
        cfg = _load_stt_ws_config()
    except LLMError as exc:
        await ws.accept()
        await ws.send_text(json.dumps({"type": "error", "message": str(exc)}))
        await ws.close(code=4003, reason="STT not configured")
        return

    try:
        provider = await websockets.connect(
            cfg["api_url"],
            additional_headers={"Authorization": f"Bearer {cfg['api_key']}"},
        )
    except Exception as exc:
        log.warning(f"STT WS: provider 连接失败: {exc}")
        await ws.accept()
        await ws.send_text(json.dumps(
            {"type": "error", "message": f"连接语音识别服务失败: {exc}"}))
        await ws.close(code=4004, reason="Provider connect failed")
        return

    # ── 启动识别任务（收到 task-started 前 provider 不收音频，眼镜端自行缓存）──
    task_id = str(uuid.uuid4())
    run_msg = json.dumps({
        "header": {"action": "run-task", "task_id": task_id, "streaming": "duplex"},
        "payload": {
            "task_group": "audio",
            "task": "asr",
            "function": "recognition",
            "model": cfg["model"],
            "input": {},
            "parameters": {"format": "pcm", "sample_rate": 16000},
        },
    })
    await provider.send(run_msg)
    log.info(f"STT WS: 中继启动 task={task_id} model={cfg['model']}")
    log.info(f"STT WS: 发送 run-task -> {run_msg}")

    await ws.accept()

    async def glasses_to_provider():
        """眼镜 → provider：二进制 PCM 原样转发；{"type":"finish"} 转 finish-task。"""
        try:
            while True:
                msg = await ws.receive()
                if msg["type"] == "websocket.disconnect":
                    return
                data = msg.get("bytes")
                if data is not None:
                    await provider.send(data)
                    continue
                text = msg.get("text")
                if not text:
                    continue
                try:
                    obj = json.loads(text)
                except ValueError:
                    continue
                if obj.get("type") == "finish":
                    finish_msg = json.dumps({
                        "header": {"action": "finish-task",
                                   "task_id": task_id, "streaming": "duplex"},
                        "payload": {"input": {}},  # 文档确认：input 固定 {}
                    })
                    log.info(f"STT WS: 转发 finish-task -> {finish_msg}")
                    await provider.send(finish_msg)
                else:
                    await provider.send(text)
        except Exception:
            pass

    async def provider_to_glasses():
        """provider → 眼镜：JSON 事件原样转发（全部事件全量打日志）。"""
        try:
            async for raw in provider:
                text = raw if isinstance(raw, str) else raw.decode()
                log.info(f"STT WS: provider 事件 -> {text}")
                await ws.send_text(text)
        except Exception:
            pass

    done, pending = await asyncio.wait(
        [asyncio.create_task(glasses_to_provider()),
         asyncio.create_task(provider_to_glasses())],
        return_when=asyncio.FIRST_COMPLETED,
    )
    for task in pending:
        task.cancel()
    try:
        await provider.close()
    except Exception:
        pass
    try:
        await ws.close()
    except Exception:
        pass
    log.info(f"STT WS: 中继结束 task={task_id}")
