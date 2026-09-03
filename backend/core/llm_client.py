"""LLM client — thin wrapper around the OpenAI Python SDK.

Reads api_url / api_key / model from the SQLite settings table on every
call so that live config changes take effect immediately.

Usage:
    client = LLMClient(get_connection)
    response = await client.chat(messages, system_prompt="You are…")
"""

from __future__ import annotations

import json
import sqlite3
from typing import Callable

from openai import AsyncOpenAI


class LLMClient:
    """OpenAI-compatible chat-completion client."""

    def __init__(self, get_connection: Callable[[], sqlite3.Connection]):
        self._get_connection = get_connection

    # ── Public API ─────────────────────────────────────────────────

    async def chat(self, messages: list[dict], system_prompt: str = "") -> str:
        """Send a chat completion request and return the assistant text.

        Args:
            messages: [{"role": "user", "content": "…"}, …]
            system_prompt: optional system-level instruction

        Returns:
            The model's text response (expected to be valid JSON per our prompts).
        """
        cfg = self._read_config()
        client = AsyncOpenAI(
            base_url=cfg["api_url"].rstrip("/") + "/v1",
            api_key=cfg["api_key"],
        )

        full_messages: list[dict] = []
        if system_prompt:
            full_messages.append({"role": "system", "content": system_prompt})
        full_messages.extend(messages)

        try:
            response = await client.chat.completions.create(
                model=cfg["model"],
                messages=full_messages,
                temperature=0.3,
            )
            return response.choices[0].message.content or ""
        except Exception as exc:
            raise LLMError(f"LLM 调用失败: {exc}") from exc

    async def transcribe(self, audio_bytes: bytes, filename: str = "audio.webm") -> str:
        """语音转文字——经 OpenAI 兼容的 /v1/audio/transcriptions 接口。

        配置读取顺序：settings 表的独立 `stt` 键（api_url/api_key/model，
        与 llm 同样的保存方式）；未配置时回退 llm 键（model 取 llm.stt_model，
        缺省 "whisper-1"）。provider 不支持音频转录时抛出 LLMError，
        由调用方给用户可读提示。
        """
        cfg = self._read_stt_config()
        client = AsyncOpenAI(
            base_url=cfg["api_url"].rstrip("/") + "/v1",
            api_key=cfg["api_key"],
        )
        try:
            response = await client.audio.transcriptions.create(
                model=cfg["model"],
                file=(filename, audio_bytes),
            )
            return (response.text or "").strip()
        except Exception as exc:
            raise LLMError(f"语音识别调用失败（provider 可能不支持音频转录）: {exc}") from exc

    # ── Internal ───────────────────────────────────────────────────

    def _read_config(self) -> dict:
        """Read current LLM config from the database."""
        conn = self._get_connection()
        try:
            row = conn.execute(
                "SELECT value FROM settings WHERE key = 'llm'"
            ).fetchone()
            if row is None:
                raise LLMError(
                    "LLM 未配置，请先在 Settings 中设置 API URL / Key / Model"
                )
            return json.loads(row["value"])
        finally:
            conn.close()

    def _read_stt_config(self) -> dict:
        """Read STT config from the database.

        优先独立 stt 键；缺失或字段不全时回退 llm 键（model 取
        llm.stt_model 或 "whisper-1"）。
        """
        conn = self._get_connection()
        try:
            row = conn.execute(
                "SELECT value FROM settings WHERE key = 'stt'"
            ).fetchone()
            if row is not None:
                cfg = json.loads(row["value"])
                if cfg.get("api_url") and cfg.get("api_key"):
                    return {
                        "api_url": cfg["api_url"],
                        "api_key": cfg["api_key"],
                        "model": cfg.get("model") or "whisper-1",
                    }

            row = conn.execute(
                "SELECT value FROM settings WHERE key = 'llm'"
            ).fetchone()
            if row is None:
                raise LLMError(
                    "LLM 未配置，请先在 Settings 中设置 API URL / Key / Model"
                )
            cfg = json.loads(row["value"])
            return {
                "api_url": cfg["api_url"],
                "api_key": cfg["api_key"],
                "model": cfg.get("stt_model") or "whisper-1",
            }
        finally:
            conn.close()


class LLMError(Exception):
    """Raised when the LLM call fails."""
    pass
