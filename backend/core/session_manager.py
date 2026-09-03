"""Session Manager — 跨设备消息分发 + 领域判断。

当一个 device 正在执行 PE flow 时，另一个 device 发来新命令：
  add  → inject 到当前 flow（下次 Plan 融入）
  redo → abort 当前 flow + 带旧 execution_log 开新 flow
  new  → 创建并行 PE flow

Usage:
    manager = SessionManager(llm_client, capability_manager, ws_manager,
                             client_manager, server_os)
    flow_id = await manager.dispatch(goal, source_device_uuid, messages)
"""

from __future__ import annotations

import asyncio
import uuid
from dataclasses import dataclass, field

from .client_manager import ClientManager
from .executor import Executor
from .loader import CapabilityManager
from .llm_client import LLMClient, LLMError
from .logger import get_logger

log = get_logger("core.session_manager")


def _new_id() -> str:
    return uuid.uuid4().hex[:12]


# ═══════════════════════════════════════════════════════════════════════
# Intent judge prompt
# ═══════════════════════════════════════════════════════════════════════

_INTENT_PROMPT = """你是一个任务调度器。根据当前运行中任务的状态和新命令，判断意图。

## 判断标准
- add: 新命令是某个运行中任务的**补充、扩展或细化**——融入该任务，一起规划。
- redo: 新命令是某个运行中任务的**修正、推翻或重定向**——中止旧任务，用新方向重来。
- new: 新命令是**全新独立任务**，与所有运行中任务无关——并行执行。

## 规则
1. 两个命令操作不同文件/不同应用 → new。
2. "继续"、"顺便"、"也" → add。
3. "不对"、"换个方式"、"不要了"、"算了" → redo。
4. 模糊情况下倾向于 new（允许并行）。
5. 如果新命令明确关联某个运行中任务，在 flow_id 字段中标明。
6. 只返回 JSON，不要 Markdown。

## 返回格式
{"intent": "add", "flow_id": "可选，关联的 flow 前缀"}
{"intent": "new"}"""


# ═══════════════════════════════════════════════════════════════════════
# Flow
# ═══════════════════════════════════════════════════════════════════════

@dataclass
class Flow:
    """一个运行中的 PE flow。"""
    id: str
    executor: Executor
    goal: str
    source_device: str
    task: asyncio.Task | None = None


# ═══════════════════════════════════════════════════════════════════════
# SessionManager
# ═══════════════════════════════════════════════════════════════════════

class SessionManager:
    """管理跨设备的多个并发 PE flow。"""

    def __init__(
        self,
        llm_client: LLMClient,
        capability_manager: CapabilityManager,
        ws_manager,
        client_manager: ClientManager,
        server_os: str,
    ):
        self._llm = llm_client
        self._capability = capability_manager
        self._ws_manager = ws_manager
        self._client_manager = client_manager
        self._server_os = server_os
        self._flows: dict[str, Flow] = {}

    # ── Public API ─────────────────────────────────────────────────

    def is_device_busy(self, device_uuid: str) -> bool:
        """检查指定设备是否有运行中的 flow 作为来源。"""
        return any(
            f.executor.is_running and f.source_device == device_uuid
            for f in self._flows.values()
        )

    def get_flow_for_device(self, device_uuid: str) -> Flow | None:
        """获取指定设备发起的当前运行中的 flow。"""
        for f in self._flows.values():
            if f.executor.is_running and f.source_device == device_uuid:
                return f
        return None

    async def dispatch(
        self,
        goal: str,
        source_device_uuid: str,
        messages: list[dict],
    ) -> str:
        """分发用户命令，返回 flow_id。"""
        running = [
            f for f in self._flows.values() if f.executor.is_running
        ]

        # 没有运行中任务 → 直接创建
        if not running:
            return await self._create_flow(goal, source_device_uuid, messages)

        # LLM 判断意图
        intent, target_flow_id = await self._judge_intent(goal, source_device_uuid, running)

        if intent == "add":
            flow = self._find_flow(target_flow_id, running)
            if flow:
                flow.executor.inject(goal)
                await self._push_to_device(source_device_uuid, "push",
                                           {"status": f"已并入任务: {flow.goal}"})
                return flow.id
            # fallback: new
            return await self._create_flow(goal, source_device_uuid, messages)

        elif intent == "redo":
            flow = self._find_flow(target_flow_id, running)
            if flow:
                await self._push_to_device(source_device_uuid, "push",
                                           {"status": "已中断当前任务，重新规划..."})
                # 快照 execution_log
                old_log = list(flow.executor._execution_log)
                flow.executor.abort()
                # 等待 task 结束
                if flow.task and not flow.task.done():
                    try:
                        await asyncio.wait_for(flow.task, timeout=10.0)
                    except (asyncio.TimeoutError, asyncio.CancelledError):
                        pass
                del self._flows[flow.id]
                return await self._create_flow(goal, source_device_uuid, messages,
                                                initial_log=old_log)
            # fallback: new
            return await self._create_flow(goal, source_device_uuid, messages)

        else:  # new
            return await self._create_flow(goal, source_device_uuid, messages)

    # ── Internal ───────────────────────────────────────────────────

    async def _judge_intent(
        self,
        goal: str,
        source_device: str,
        running: list[Flow],
    ) -> tuple[str, str | None]:
        """LLM 判断新命令意图。返回 (intent, target_flow_id | None)。"""

        # 构建运行中任务摘要
        running_text = ""
        for i, f in enumerate(running, 1):
            log_summary = f.executor._format_execution_log() or "刚启动"
            device_type = self._client_manager.get_info(f.source_device)
            dev_label = device_type.device_type if device_type else f.source_device
            running_text += (
                f"### 任务 {i} (flow: {f.id})\n"
                f"- 来源设备: {dev_label}\n"
                f"- 目标: {f.goal}\n"
                f"- 进度: {log_summary}\n\n"
            )

        user = (
            f"## 当前运行中任务\n{running_text or '(无)'}\n"
            f"## 新命令\n{goal}\n"
            f"来源设备: {source_device}"
        )

        try:
            raw = await self._llm.chat(
                [{"role": "user", "content": user}],
                system_prompt=_INTENT_PROMPT,
            )
        except LLMError:
            # LLM 挂了就默认 new
            return "new", None

        # 解析
        raw = raw.strip()
        if raw.startswith("```"):
            parts = raw.split("\n", 1)
            raw = parts[1] if len(parts) > 1 else ""
            if raw.endswith("```"):
                raw = raw[:-3]

        import json
        try:
            result = json.loads(raw)
            return result.get("intent", "new"), result.get("flow_id")
        except json.JSONDecodeError:
            raw_lower = raw.lower().strip('"').strip("'")
            if raw_lower in ("add", "redo", "new"):
                return raw_lower, None
            return "new", None

    def _find_flow(self, flow_id_prefix: str | None, running: list[Flow]) -> Flow | None:
        """根据前缀查找 flow。没找到返回第一个 running flow。"""
        if flow_id_prefix:
            for f in running:
                if f.id.startswith(flow_id_prefix):
                    return f
        # fallback: 返回 task 数最多的（最活跃的）
        return running[0] if running else None

    async def _create_flow(
        self,
        goal: str,
        source_device_uuid: str,
        messages: list[dict],
        initial_log: list[dict] | None = None,
    ) -> str:
        """创建一个 PE flow 并异步启动。"""
        flow_id = _new_id()
        executor = Executor(
            capability_manager=self._capability,
            llm_client=self._llm,
            ws_manager=self._ws_manager,
            client_manager=self._client_manager,
            source_device_uuid=source_device_uuid,
            server_os=self._server_os,
            initial_log=initial_log,
        )
        flow = Flow(id=flow_id, executor=executor, goal=goal,
                     source_device=source_device_uuid)
        self._flows[flow_id] = flow

        task = asyncio.create_task(self._run_flow(flow, goal, messages))
        flow.task = task
        return flow_id

    async def _run_flow(self, flow: Flow, goal: str, messages: list[dict]) -> None:
        """运行一个 flow 并在完成后清理。"""
        try:
            await flow.executor.run(goal, messages)
        except Exception as exc:
            log.error(f"flow {flow.id} error: {exc}")
        finally:
            self._flows.pop(flow.id, None)

    async def _push_to_device(self, device_uuid: str, msg_type: str, payload: dict) -> None:
        """推送消息到指定设备。"""
        ws = self._client_manager.get_ws(device_uuid=device_uuid)
        if ws is not None:
            await self._ws_manager.send(ws, msg_type, payload)
