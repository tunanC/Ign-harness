"""WebSocket connection manager.

Maintains a pool of connected clients keyed by client_type.
Handles message envelope (msg_id / type / target / payload) routing,
heartbeat ping/pong, and disconnect cleanup.

All business on a single WS path  /Ign/v1/ws , routed by `type` field:
  - chat_send    → user sends a message → SPMP executor starts
  - tool_exec    → server requests tool execution on client
  - tool_result  → client returns tool execution result
  - signal       → user abort / control signals
  - chat_delta / chat_response → server pushes text to UI
  - executor_ready → server signals ready for next message
"""

import json
import time
import asyncio
from dataclasses import dataclass, field
from fastapi import WebSocket, WebSocketDisconnect

from .logger import get_logger

log = get_logger("core.ws_manager")

HEARTBEAT_INTERVAL = 30   # seconds — client sends ping, server replies pong
HEARTBEAT_TIMEOUT  = 60   # seconds — if no ping within this window, disconnect


@dataclass
class ClientSocket:
    """A single connected client."""
    ws: WebSocket
    client_type: str
    client_os: str = "unknown"
    device_uuid: str = "unknown"
    last_ping: float = field(default_factory=time.time)


class WSManager:
    """Singleton-style manager for all WebSocket connections."""

    def __init__(self):
        # client_type → list of ClientSocket
        self._clients: dict[str, list[ClientSocket]] = {}

    # ── connection lifecycle ──────────────────────────────────────

    async def connect(self, ws: WebSocket, client_type: str,
                     client_os: str = "unknown", device_uuid: str = "unknown"):
        # 同一设备已有连接时，先关掉旧的（防重连堆积）
        existing = self._find_by_device(device_uuid)
        if existing:
            log.info(f"closing stale connection for {device_uuid}...")
            try:
                await existing.ws.close(code=1000)
            except Exception:
                pass
            self._remove(existing.ws)

        await ws.accept()
        cs = ClientSocket(ws=ws, client_type=client_type,
                         client_os=client_os, device_uuid=device_uuid)
        self._clients.setdefault(client_type, []).append(cs)
        log.info(f"+ {client_type}/{client_os}/{device_uuid}...  "
              f"(total {sum(len(v) for v in self._clients.values())})")

    def disconnect(self, ws: WebSocket):
        self._remove(ws)

    def _find_by_device(self, device_uuid: str) -> ClientSocket | None:
        """查找同 device_uuid 的已有连接（用于重连时踢旧连接）。"""
        for lst in self._clients.values():
            for cs in lst:
                if cs.device_uuid == device_uuid:
                    return cs
        return None

    def _remove(self, ws: WebSocket) -> None:
        for ctype, lst in list(self._clients.items()):
            self._clients[ctype] = [c for c in lst if c.ws is not ws]
            if not self._clients[ctype]:
                del self._clients[ctype]
        log.info(f"- disconnected  (total {sum(len(v) for v in self._clients.values())})")

    # ── send / broadcast ──────────────────────────────────────────

    async def send(self, ws: WebSocket, msg_type: str, payload: dict,
                  target: str = "desktop", msg_id: str | None = None):
        """Send a single message to one client."""
        try:
            await ws.send_json({
                "msg_id": msg_id or _new_id(),
                "type": msg_type,
                "target": target,
                "payload": payload,
            })
        except Exception:
            self.disconnect(ws)

    async def broadcast(self, msg_type: str, payload: dict,
                        target: str = "desktop", client_type: str | None = None):
        """Broadcast to all clients, or filtered by client_type."""
        targets: list[ClientSocket] = []
        if client_type:
            targets = self._clients.get(client_type, [])
        else:
            for lst in self._clients.values():
                targets.extend(lst)

        for cs in targets:
            await self.send(cs.ws, msg_type, payload, target=target)

    # ── message reader (per-connection loop) ──────────────────────

    async def reader(self, ws: WebSocket, client_type: str,
                     on_message: callable = None,
                     on_disconnect: callable = None):
        """Run in a background task per connection.

        Reads incoming frames, handles ping/pong internally,
        dispatches other messages to on_message(client_type, data).
        """
        try:
            while True:
                raw = await asyncio.wait_for(
                    ws.receive_text(),
                    timeout=HEARTBEAT_TIMEOUT,
                )
                data = json.loads(raw)
                msg_type = data.get("type", "")

                # ── heartbeat ──
                if msg_type == "ping":
                    await ws.send_json({"type": "pong"})
                    # Update last_ping on the stored ClientSocket
                    for cs in self._clients.get(client_type, []):
                        if cs.ws is ws:
                            cs.last_ping = time.time()
                    continue

                # ── dispatch to caller ──
                if on_message:
                    await on_message(client_type, data)

        except WebSocketDisconnect as e:
            log.info(f"reader: WebSocketDisconnect code={e.code}")
        except asyncio.TimeoutError:
            log.info("reader: timeout (no message for 60s)")
        except Exception as e:
            log.info(f"reader: unexpected {type(e).__name__}: {e}")
        finally:
            self.disconnect(ws)
            if on_disconnect:
                await on_disconnect(client_type)


# ── helpers ────────────────────────────────────────────────────────

def _new_id() -> str:
    import uuid
    return uuid.uuid4().hex[:12]


# Global singleton
ws_manager = WSManager()
