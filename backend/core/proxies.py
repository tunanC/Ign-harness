"""Tool execution proxies — abstract the transport layer so the Executor
doesn't care whether a tool runs on the server or on a remote client.

                   ┌──────────────────────┐
                   │      Executor        │
                   │  proxy.execute(...)  │
                   └──────┬───────────────┘
                          │
              ┌───────────┴───────────┐
              ▼                       ▼
       ServerToolProxy          ClientToolProxy
       (import→run())      (ClientManager→WS→Tauri→WS)
"""

from __future__ import annotations

import asyncio
from abc import ABC, abstractmethod

from .models import ToolDef
from .loader import _load_module


class ToolProxy(ABC):
    """Abstract base for tool execution."""

    @abstractmethod
    async def execute(self, tool_def: ToolDef, params: dict, call_id: str) -> dict:
        """Execute the tool and return its result dict."""
        ...


# ── Server-side proxy ──────────────────────────────────────────────

class ServerToolProxy(ToolProxy):
    """Import tool.py and call run() directly in-process."""

    async def execute(self, tool_def: ToolDef, params: dict, call_id: str) -> dict:
        if tool_def.module_path is None:
            return {"error": f"服务端工具 {tool_def.name} 缺少 tool.py"}
        mod = _load_module(tool_def.module_path, tool_def.name)
        return await mod.run(params)


# ── Client-side proxy ──────────────────────────────────────────────

class ClientToolProxy(ToolProxy):
    """Push tool_exec over WebSocket to the correct device.

    Uses ClientManager to resolve the target device's WS based on the
    tool name (which encodes device_type, e.g. client:desktop:...).

    Class-level _global_pending allows ANY WS handler to resolve a
    tool_result — even from a different device than the one that
    initiated the chat session.
    """

    _global_pending: dict[str, "ClientToolProxy"] = {}  # call_id → proxy

    def __init__(self, ws_manager, client_manager):
        self._ws_manager = ws_manager
        self._client_manager = client_manager
        self._pending: dict[str, asyncio.Event] = {}
        self._results: dict[str, dict] = {}

    def _resolve_ws(self, tool_name: str):
        """从工具名中提取 device_type，在 ClientManager 中查找 WS。

        工具名格式: client:<device_type>:<os>:<name>
        例如: client:desktop:windows:bash → device_type = "desktop"
        """
        parts = tool_name.split(":")
        if len(parts) >= 2:
            device_type = parts[1]  # "desktop" | "glasses" | ...
            ws = self._client_manager.get_ws(device_type=device_type)
            if ws is not None:
                return ws

        # Fallback: 返回任意在线设备的 WS
        online = self._client_manager.get_online_devices()
        return online[0].ws if online else None

    async def execute(self, tool_def: ToolDef, params: dict, call_id: str) -> dict:
        ws = self._resolve_ws(tool_def.name)
        if ws is None:
            return {"error": f"没有在线设备可以执行 {tool_def.name}"}

        event = asyncio.Event()
        self._pending[call_id] = event
        ClientToolProxy._global_pending[call_id] = self

        await self._ws_manager.send(
            ws,
            msg_type="tool_exec",
            payload={
                "call_id": call_id,
                "tool": tool_def.name,
                "params": params,
            },
        )

        await event.wait()

        result = self._results.pop(call_id, {"error": "工具结果丢失"})
        del self._pending[call_id]
        return result

    async def execute_parallel(self, items: list[dict], call_id: str) -> dict:
        """Send a parallel group to the frontend. 每个 item 单独路由到对应设备。

        如果 parallel 组的 items 跨多个设备，目前取第一个 item 的设备作为主目标。
        未来可以按设备分组并行发送。
        """
        if not items:
            return {"error": "并行组为空"}

        # 取第一个 item 的设备作为主目标
        first_tool = items[0].get("tool", "")
        ws = self._resolve_ws(first_tool)
        if ws is None:
            return {"error": f"没有在线设备可以执行并行组"}

        event = asyncio.Event()
        self._pending[call_id] = event
        ClientToolProxy._global_pending[call_id] = self

        await self._ws_manager.send(
            ws,
            msg_type="tool_exec",
            payload={
                "call_id": call_id,
                "type": "parallel",
                "items": items,
            },
        )

        await event.wait()

        result = self._results.pop(call_id, {"error": "并行执行结果丢失"})
        del self._pending[call_id]
        return result

    def register_pending(self, call_id: str) -> asyncio.Event:
        """注册一个待处理的工具调用（不发送 WS——由调用方负责推送）。"""
        event = asyncio.Event()
        self._pending[call_id] = event
        ClientToolProxy._global_pending[call_id] = self
        return event

    async def wait_and_get_result(self, call_id: str) -> dict:
        """等待工具结果返回。"""
        event = self._pending.get(call_id)
        if event:
            await event.wait()
        result = self._results.pop(call_id, {"error": "工具结果丢失"})
        del self._pending[call_id]
        return result

    def resolve(self, call_id: str, result: dict) -> None:
        """Called by WS message handler when tool_result arrives."""
        self._results[call_id] = result
        ClientToolProxy._global_pending.pop(call_id, None)
        event = self._pending.get(call_id)
        if event:
            event.set()

    @classmethod
    def resolve_any(cls, call_id: str, result: dict) -> bool:
        """任意 WS handler 都可以调用来回传工具执行结果。

        跨设备场景：眼镜发指令 → 桌面执行工具 → 桌面 WS 回传结果。
        Returns True if a matching pending call was found.
        """
        proxy = cls._global_pending.get(call_id)
        if proxy is not None:
            proxy.resolve(call_id, result)
            return True
        return False

    def abort_all(self) -> None:
        """Wake all pending waits — used during executor abort."""
        for call_id in list(self._pending.keys()):
            self._results.setdefault(call_id, {"error": "已中断"})
            ClientToolProxy._global_pending.pop(call_id, None)
            self._pending[call_id].set()
