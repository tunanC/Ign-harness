"""PE Executor — Plan → Execute 纯递归引擎。

_pe(goal, branch_input, ctx_id):
    Plan：LLM 看上下文 → 返回 DAG 节点列表 / reply / 不返回
    tool 节点：读 md 生成命令 → exec → 结果递归 _pe
    skill/agent 节点：读 md 生成子目标 → 递归 _pe（branch_input = 子目标）
"""

from __future__ import annotations

import asyncio
import json
import uuid
from datetime import datetime
from typing import Any

from .llm_client import LLMError
from .logger import get_logger
from .proxies import ClientToolProxy, ServerToolProxy

log = get_logger("core.executor")

# 临时共享上下文：按 ctx_id 分桶（一轮 trace 一个新 id）——done/plan 不跨轮共享
_SHARED_CONTEXTS: dict[str, list[dict]] = {}


def _now() -> str:
    return datetime.now().strftime("%Y-%m-%d %H:%M:%S")


def _new_id() -> str:
    return uuid.uuid4().hex[:12]


def _short_name(full_name: str) -> str:
    """从完整能力名提取短名。例: client:desktop:windows:bash → bash"""
    return full_name.rsplit(":", 1)[-1]


# ═══════════════════════════════════════════════════════════════════════
# Prompts
# ═══════════════════════════════════════════════════════════════════════

_PLAN_PROMPT = """你是一个任务规划助手。根据用户目标、可用能力和共享上下文，决定下一步动作。

## 规则
1. plan 只产出单层节点列表。
2. type ∈ {tool, skill, agent}。
3. 同一批节点会被并行执行——只把互不干扰的操作放进同一批。
4. **只返回 JSON**，不要 Markdown 代码块，不要解释。
5. **自己解决问题，不问用户**：你是助手，不是客服。用户描述不精确、文件名写错、路径写错、名词写错、有错别字、工具执行失败，都先自己想办法。每轮 plan 前先看共享上下文，以及父级执行结果，分析上次为什么失败，调整策略再试。穷尽你能想到的所有手段之后，才允许回复用户。
6. **不读敏感文件**：除非用户明确要求，不要读取含密钥/凭证的文件（config.json、.env、credentials、私钥等）。分析代码只读源码和文档。
7. 如果共享上下文里已有 type 为 `reply.done` 的条目，说明任务已结束——直接返回 {} 静默结束，不要继续规划、不要回复。
8. **能力选择看设备**：能力名编码了执行端、设备类型、系统（client:glasses:yodaos…、client:desktop:macOS…、server:Centos…）。选择 client 能力前先看"在线设备"清单与"用户当前设备"——对应类型的设备在线才能选它的能力。用户没有特别指明设备时，选择适合用户当前设备的工具；用户指明了设备时，在"在线设备"清单中按**设备名**找对应设备（用户说话用设备名，不用 id），选该设备的工具；用户只指明设备类型（如"电脑"）时，选该类型任一在线设备的工具。本阶段只选工具名，具体哪台设备由读工具说明阶段确定。server: 能力任何时刻可用。

## 返回格式

**需要执行任务**（本分支下一步要执行的节点，会并行执行）:
{"nodes": [{"type": "tool", "name": "完整能力名", "goal": "具体目标"}]}

**阶段性回复用户**（任务未完成，告诉用户进展）:
{"reply": "你的友好回复"}

**任务结束**（总目标完成，或穷尽手段仍未完成——给用户最终总结。done 标志系统据此标记上下文完成）:
{"reply": "最终总结", "done": true}

**信息不足或无需动作**（本分支静默结束）:
{}"""


_PARAMS_PROMPT = """你是一个工具调用助手。根据工具的接口定义和执行目标，生成调用参数。

## 规则
1. 从接口定义确认必填和可选参数。
2. 参考"已执行步骤"来填充参数值。
3. 如果目标可分解为多个**独立互不依赖**的只读操作（如同时查看不同目录、不同文件），使用 parallel 格式。写入操作不要放入 parallel。
4. 单个调用在 data 内返回 JSON 对象，key 为参数名。
5. **只返回 JSON**，不要 Markdown。
6. tool 节点需声明 pre_hooks——从能力说明中的"强制 hooks"里选择，不要凭空编造。
7. 如果"本次操作目标"里已经包含具体完整的命令，直接原样提取为 command 参数——不要重新设计、不要改写、不要增删任何部分（包括 `2>/dev/null` 这类重定向）。
8. short_name 是工具的短名——从能力说明的"本工具短名"声明中原样照抄，禁止编造或改写。params 里只放接口定义的参数。所有 item 都是同一个工具。
9. 确定执行设备：根据本工具内容与用户是否指明设备，确定适合的执行设备——exec_device 与"本工具完整名称"中的设备类型一致；用户指明了设备名时，从"在线设备"清单中取**名称匹配**的设备的名称；没有指明时，使用用户自己设备的名称；server 工具的 exec_device 填 "server"。display_device 通常是发起任务的设备（见"用户当前设备"段）的名称，须在"在线设备"清单中。
10. 最外层固定三个平级字段：exec_device、display_device、data，exec_device、display_device字段是在线设备的名称（从"在线设备"清单的"名称"字段照抄，发起设备的名称见"用户当前设备"段），具有唯一标识性，可附带可选 message 字段——本次执行过程中要展示给用户的话（如告诉用户正在哪台设备上做什么），无话可说则省略；不允许其他顶层字段。

## 返回格式
### 单个: {"exec_device": "客厅电脑", "display_device": "眼镜", "message": "正在你的电脑上执行命令", "data": {"short_name": "bash", "params": {"command": "dir"}, "pre_hooks": ["server:windows:audit-log"]}}
### 并行: {"exec_device": "客厅电脑", "display_device": "眼镜", "message": "正在你的电脑上并行查看目录", "data": {"type": "parallel", "short_name": "bash", "items": [{"params": {"command": "dir"}, "pre_hooks": ["server:windows:audit-log"]}]}}"""


class Executor:
    """PE 执行器。"""

    def __init__(
        self,
        llm_client,
        capability_manager,
        ws_manager,
        client_manager,
        source_device_uuid: str,
        server_os: str,
    ):
        self.llm = llm_client
        self.capability = capability_manager
        self.ws_manager = ws_manager
        self.client_manager = client_manager
        self.source_device_uuid = source_device_uuid
        self.server_os = server_os
        self._display_ws = None  # 展示设备 WS（reply/status 推送目标，None=发起设备）

        self._server_proxy = ServerToolProxy()
        self._client_proxy = ClientToolProxy(ws_manager, client_manager)

    # ── 公共方法 ────────────────────────────────────────────────

    def _read_md(self, name: str) -> str | None:
        """按能力名读取 md 正文。tool / skill / agent 通用。"""
        for group in (self.capability.tools, self.capability.skills, self.capability.agents):
            cap = group.get(name)
            if cap is not None:
                return cap.md_content
        return None

    def _record_context(self, type_: str, content: Any, ctx_id: str) -> None:
        """记录上下文条目到本 trace 的桶（按 ctx_id 隔离）。"""
        _SHARED_CONTEXTS.setdefault(ctx_id, []).append(
            {"time": _now(), "type": type_, "content": content})

    def _is_done(self, ctx_id: str) -> bool:
        """本 trace 是否已结束（自己桶里有 reply.done 条目）——不跨轮共享。"""
        return any(e.get("type") == "reply.done"
                   for e in _SHARED_CONTEXTS.get(ctx_id, []))

    @staticmethod
    def _parse_json(raw: str) -> dict | None:
        """解析 LLM 返回的 JSON，容忍 markdown 代码块包裹。"""
        text = raw.strip()
        if text.startswith("```"):
            parts = text.split("\n", 1)
            text = parts[1] if len(parts) > 1 else ""
            if text.endswith("```"):
                text = text[:-3]
            text = text.strip()
        try:
            return json.loads(text)
        except json.JSONDecodeError:
            return None

    async def _ask_llm_with_md(
        self,
        md: str,
        node_goal: str,
        goal: str,
        system_prompt: str,
        online_devices: str = "",
        full_name: str = "",
        source_device: str = "",
    ) -> str:
        """公共方法：把 md + 目标送给 LLM，返回原始文本。"""
        try:
            content = f"## 能力说明\n{md}\n\n"
            if full_name:
                content += f"## 本工具完整名称\n{full_name}\n\n"
            content += (
                f"## 本次操作目标\n{node_goal}\n\n"
                f"## 本分支目标\n{goal}"
            )
            if online_devices:
                content += f"\n\n## 在线设备\n{online_devices}"
            if source_device:
                content += f"\n\n## 用户当前设备\n{source_device}"
            return await self.llm.chat(
                [{"role": "user", "content": content}],
                system_prompt=system_prompt,
            )
        except LLMError as exc:
            log.error(f"LLM 调用异常: {exc}")
            await self._send_push(message="数据异常")
            return ""

    # ── WS 推送 ─────────────────────────────────────────────────

    def _source_ws(self):
        return self.client_manager.get_ws(device_uuid=self.source_device_uuid)

    def _source_device_text(self) -> str:
        """用户当前设备信息（发起任务的设备）：设备类型、设备系统、设备名。"""
        info = self.client_manager.get_info(self.source_device_uuid)
        if info is not None:
            return f"- **{info.device_type}** ({info.client_os}): 名称={info.device_name}"
        return "(发起设备不在线)"

    async def _send_to_source(self, msg_type: str, payload: dict) -> None:
        ws = self._source_ws()
        if ws is not None:
            await self.ws_manager.send(ws, msg_type, payload)

    async def _send_push(
        self,
        *,
        message: str | None = None,
        tool_exec: dict | None = None,
        status: str | None = None,
        ui: dict | None = None,
        to_ws=None,
    ) -> None:
        """一回合一个 JSON：{message?, tool_exec?, status?, ui?}，四通道。to_ws=None 时推发起设备。"""
        payload: dict[str, Any] = {}
        if message is not None:
            payload["message"] = message
        if tool_exec is not None:
            payload["tool_exec"] = tool_exec
        if status is not None:
            payload["status"] = status
        if ui is not None:
            payload["ui"] = ui
        log.info(f"WS push: {json.dumps(payload, ensure_ascii=False)}")
        ws = to_ws if to_ws is not None else self._source_ws()
        if ws is not None:
            await self.ws_manager.send(ws, "push", payload)

    # ── 设备解析（exec/display 分推） ────────────────────────────

    @staticmethod
    def _device_type_of(tool_name: str) -> str | None:
        """从完整能力名提取设备类型段。例: client:desktop:windows:bash → desktop"""
        parts = tool_name.split(":")
        return parts[1] if len(parts) >= 3 else None

    def _resolve_exec_ws(self, tool_name: str, declared_device: str | None):
        """解析执行设备 WS。declared_device 是设备名（LLM 从"在线设备"清单的"名称"字段取的）。

        1. 名称在线且类型与名称设备段一致 → 用之
        2. 名称不在线 / 类型矛盾 / 缺失 → 按名称路由（该类型在线设备取其一）
        3. 均无 → None（调用方报错供 LLM 重规划）
        """
        name_device = self._device_type_of(tool_name)
        if declared_device:
            info = self.client_manager.get_info_by_name(declared_device)
            if info is not None:
                if name_device and info.device_type != name_device:
                    log.info(f"exec_device({declared_device})类型({info.device_type})"
                             f"与名称设备段({name_device})不一致——按名称纠正")
                else:
                    return info.ws
            else:
                log.info(f"exec_device({declared_device})不在线或不存在——回退名称路由")
        if name_device:
            return self.client_manager.get_ws(device_type=name_device)
        return None

    def _resolve_display_ws(self, declared_device: str | None):
        """解析展示设备 WS：声明的设备名在线则用之，否则回退发起设备。同时记录 self._display_ws 供 reply 使用。"""
        if declared_device:
            info = self.client_manager.get_info_by_name(declared_device)
            if info is not None:
                self._display_ws = info.ws
                return info.ws
        ws = self._source_ws()
        self._display_ws = ws
        return ws

    # ── PE 递归骨架 ─────────────────────────────────────────────

    async def _pe(self, goal: str, branch_input: Any, ctx_id: str) -> None:
        """Plan → Execute 递归（根分支包装）。

        根分支（branch_input=None）= 一轮新 trace：无论哪种方式结束
        （reply / 静默结束 / 异常），收尾时清空临时共享上下文——
        新一轮对话用新 id，不与上一轮的 plan/done 共用上下文。
        子分支结束不清——任务还在跑，上下文要留给父分支继续用。
        """
        try:
            await self._pe_branch(goal, branch_input, ctx_id)
        finally:
            if branch_input is None:
                log.info(f"本轮 trace 结束 — 移除上下文桶 ctx={ctx_id}")
                _SHARED_CONTEXTS.pop(ctx_id, None)

    async def _pe_branch(self, goal: str, branch_input: Any, ctx_id: str) -> None:
        """Plan → Execute 递归主体。

        Args:
            goal: 本分支目标
            branch_input: 工具结果 dict / skill·agent 生成的子目标 str / 首轮 None
            ctx_id: 上下文编号
        """
        # 任务已结束——不再规划（本 trace 的 done，子分支静默中止）
        if self._is_done(ctx_id):
            return

        # 1. Plan：调 LLM
        log.info(f"_pe 进入: goal='{goal}' branch_input={type(branch_input).__name__} ctx={ctx_id}")
        result = await self._plan(goal, branch_input, ctx_id)

        # 2. 返回判断
        if result is None:
            log.info("plan 无返回 — 分支静默结束")
            return

        if "reply" in result:
            # 回复用户（done 标志后续处理）
            log.info(f"plan 返回 reply (done={result.get('done')})")
            await self._send_reply(result["reply"], done=bool(result.get("done")), ctx_id=ctx_id)
            return

        # 3. DAG 节点：判断 tool / skill / agent
        nodes = result.get("nodes") or []
        if not nodes:
            log.warning(f"plan 返回未知格式（keys={list(result.keys())}）— 分支静默结束")
            return
        for node in nodes:
            node_type = node.get("type", "")
            log.info(f"节点: type={node_type} name={node.get('name', '')} goal={node.get('goal', '')}")

            if node_type == "tool":
                # 读 md 生成命令 → exec → 结果递归 _pe
                tool_result = await self._run_tool(node, goal, ctx_id)
                if tool_result is not None:
                    await self._pe_branch(goal, tool_result, ctx_id)

            elif node_type in ("skill", "agent"):
                # 读 md 生成子目标 → 递归 _pe（branch_input = 子目标）
                subgoal = await self._run_skill_or_agent(node, goal, ctx_id)
                if subgoal is not None:
                    await self._pe_branch(subgoal, subgoal, ctx_id)

    # ── 三个阶段（占位，逐步补） ────────────────────────────────

    async def _plan(self, goal: str, branch_input: Any, ctx_id: str) -> dict | None:
        """Plan 阶段：LLM 看目标 + 可用能力 + 共享上下文 + 当前分支输入。"""
        cap_text = self.capability.get_capability_list_for_llm()
        system = f"## 可用能力\n{cap_text}\n\n{_PLAN_PROMPT}"

        if isinstance(branch_input, dict):
            branch_text = json.dumps(branch_input, ensure_ascii=False)
        elif branch_input:
            branch_text = str(branch_input)
        else:
            branch_text = "（首轮，无）"

        devices = self.client_manager.get_device_summary()
        source_device = self._source_device_text()
        user = (
            f"## 用户目标\n{goal}\n\n"
            f"## 在线设备\n{devices}\n\n"
            f"## 用户当前设备\n{source_device}\n\n"
            f"## 共享上下文\n{json.dumps(_SHARED_CONTEXTS.get(ctx_id, []), ensure_ascii=False)}\n\n"
            f"## 当前分支输入\n{branch_text}"
        )

        try:
            raw = await self.llm.chat(
                [{"role": "user", "content": user}],
                system_prompt=system,
            )
        except LLMError as exc:
            log.error(f"LLM 调用异常: {exc}")
            await self._send_push(message="数据异常")
            return None
        log.info(f"LLM 返回 (len={len(raw)}): {raw}")
        self._record_context("plan", raw, ctx_id)
        result = self._parse_json(raw)
        if result is None:
            log.warning(f"plan JSON 解析失败: {raw}")
        return result

    async def _run_tool(self, node: dict, goal: str, ctx_id: str) -> dict | None:
        """tool 节点：1. 读 md 生成命令 → 2. exec → 3. 返回结果。"""
        name = node.get("name", "")
        node_goal = node.get("goal", "")

        # 1. 读 md → 生成命令
        md = self._read_md(name)
        if md is None:
            log.info(f"未知工具: {name}")
            return None
        if self._is_done(ctx_id):
            # 任务已结束——不再生成命令
            return None
        raw = await self._ask_llm_with_md(
            md, node_goal, goal,
            system_prompt=_PARAMS_PROMPT,
            online_devices=self.client_manager.get_device_summary(),
            full_name=name,
            source_device=self._source_device_text(),
        )
        log.info(f"命令生成: {raw}")
        params = self._parse_json(raw)
        if params is None:
            return None
        if not params:
            # LLM 按提示词规则返回 {}——任务已结束，静默跳过
            return None

        # 外层 {exec_device, display_device, data, message?}；
        exec_device = params.get("exec_device")
        display_device = params.get("display_device")
        message = params.get("message")
        if "data" not in params:
            log.warning(f"参数生成缺少 data 字段（LLM 未按外层包装返回）: {raw}")
            return None
        params = params["data"]
        if not isinstance(params, dict):
            return None

        # 新协议：short_name 由 LLM 从 md 短名声明照抄（缺失时从节点全名兜底）
        short_name = params.get("short_name") or _short_name(name)

        if params.get("type") == "parallel" and "items" in params:
            # 并行格式：同一工具拆多条命令。items 不带 tool 字段——工具由节点名决定
            items = params.get("items") or []
            for it in items:
                it.pop("pre_hooks", None)  # TODO: 用 HookExecutor 执行 pre_hooks
            self._record_context("command", {short_name: params}, ctx_id)

            # 2. exec tool
            if self._is_done(ctx_id):
                # 任务已结束——不再执行/推送
                return None
            result = await self._execute_parallel_tool(
                name, short_name, items, node_goal,
                exec_device=exec_device, display_device=display_device, message=message,
            )
        else:
            # 单命令：参数收在 params 键里，pre_hooks 在顶层（执行处先留白）
            pre_hooks = params.pop("pre_hooks", [])  # TODO: 用 HookExecutor 执行 pre_hooks
            inner = params.get("params")
            if not isinstance(inner, dict):
                return None
            self._record_context("command", {short_name: inner}, ctx_id)

            # 2. exec tool
            if self._is_done(ctx_id):
                # 任务已结束——不再执行/推送
                return None
            # client 走 WS 推送，server 直接执行
            tool_def = self.capability.tools.get(name)
            call_id = _new_id()
            if tool_def.execution_location == "client":
                exec_ws = self._resolve_exec_ws(name, exec_device)
                display_ws = self._resolve_display_ws(display_device)
                log.info(f"推送工具到 client: {short_name} (call_id={call_id}, exec={exec_device}, display={display_device})")
                if exec_ws is None:
                    result = {"error": f"执行设备不在线或无法解析: {exec_device or name}"}
                else:
                    self._client_proxy.register_pending(call_id)
                    tool_exec = {"call_id": call_id, "tool": short_name, "params": inner}
                    status_text = f"执行 {short_name} — {node_goal}"
                    if exec_ws is display_ws:
                        # 执行与展示同设备——一条 JSON（原形状，含 message）
                        await self._send_push(
                            status=status_text,
                            tool_exec=tool_exec,
                            message=message,
                            to_ws=exec_ws,
                        )
                    else:
                        # 异设备分推：exec 收 status+tool_exec，display 收 status+message
                        # （未来 ui/应用字段两条都带）
                        await self._send_push(
                            status=status_text,
                            tool_exec=tool_exec,
                            to_ws=exec_ws,
                        )
                        await self._send_push(
                            status=status_text,
                            message=message,
                            to_ws=display_ws,
                        )
                    result = await self._client_proxy.wait_and_get_result(call_id)
            else:
                log.info(f"server 执行工具: {short_name}")
                display_ws = self._resolve_display_ws(display_device)
                await self._send_push(
                    status=f"执行 {short_name} — {node_goal}",
                    message=message,
                    to_ws=display_ws,
                )
                result = await self._server_proxy.execute(tool_def, inner, call_id)
        log.info(f"tool result: {json.dumps(result, ensure_ascii=False)}")
        self._record_context("tool_result", result, ctx_id)

        # 3. 返回结果，由 _pe 递归
        return result

    async def _execute_parallel_tool(
        self,
        name: str,
        short_name: str,
        items: list[dict],
        goal: str,
        exec_device: str | None = None,
        display_device: str | None = None,
        message: str | None = None,
    ) -> dict:
        """并行执行一组命令（parallel 格式，全部属于同一个工具）。

        工具由节点名决定（items 不带 tool 字段）：client 工具批量推送，client 在 Rust 侧
        按 items 顺序组装结果数组（type=parallel composite），server 直接并入；
        server 工具用 gather 并发执行（run 是真 async），按 items 顺序收结果。
        整体作为一条 tool_result 进上下文。
        """
        if not items:
            return {"error": "并行组为空"}

        tool_def = self.capability.tools.get(name)
        if tool_def is None:
            return {"error": f"未知工具: {name}"}

        if tool_def.execution_location == "client":
            # Client 工具批量发送（走 push 协议，type=parallel，items 的 tool 由服务端统一填短名）
            exec_ws = self._resolve_exec_ws(name, exec_device)
            display_ws = self._resolve_display_ws(display_device)
            if exec_ws is None:
                return {"error": f"执行设备不在线或无法解析: {exec_device or name}"}
            call_id = _new_id()
            self._client_proxy.register_pending(call_id)
            tool_exec = {
                "call_id": call_id,
                "type": "parallel",
                "items": [
                    {"tool": short_name, "params": it.get("params", {})}
                    for it in items
                ],
            }
            status_text = f"并行执行 {len(items)} 个工具 — {goal}"
            if exec_ws is display_ws:
                # 执行与展示同设备——一条 JSON（原形状，含 message）
                await self._send_push(
                    status=status_text,
                    tool_exec=tool_exec,
                    message=message,
                    to_ws=exec_ws,
                )
            else:
                # 异设备分推：exec 收 status+tool_exec，display 收 status+message
                await self._send_push(
                    status=status_text,
                    tool_exec=tool_exec,
                    to_ws=exec_ws,
                )
                await self._send_push(
                    status=status_text,
                    message=message,
                    to_ws=display_ws,
                )
            batch = await self._client_proxy.wait_and_get_result(call_id)
            # 新协议：client 在 Rust 侧组装好 {type,count,results:[{tool,params,result}...]}（与 items 对齐）
            # server 不再逐条重包，直接并入结果组
            if isinstance(batch, dict) and isinstance(batch.get("results"), list):
                results = list(batch["results"])
            else:
                results = [{"error": "并行结果格式异常", "raw": batch}]
        else:
            # Server 工具并发执行，按 items 顺序收结果
            display_ws = self._resolve_display_ws(display_device)
            await self._send_push(
                status=f"并行执行 {len(items)} 个工具 — {goal}",
                message=message,
                to_ws=display_ws,
            )
            execs = await asyncio.gather(*[
                self._server_proxy.execute(tool_def, it.get("params", {}), _new_id())
                for it in items
            ])
            results = [
                {"tool": short_name, "params": it.get("params", {}), "result": res}
                for it, res in zip(items, execs)
            ]

        return {"type": "parallel", "count": len(items), "results": results}

    async def _run_skill_or_agent(self, node: dict, goal: str, ctx_id: str) -> str | None:
        """skill/agent 节点：1. 读 md 生成子目标 → 2. 返回子目标。"""
        name = node.get("name", "")
        node_goal = node.get("goal", "")

        # 1. 读 md → 生成子目标
        md = self._read_md(name)
        if md is None:
            log.info(f"未知 skill/agent: {name}")
            return None
        if self._is_done(ctx_id):
            # 任务已结束——不再生成子目标
            return None
        raw = await self._ask_llm_with_md(
            md, node_goal, goal,
            system_prompt="你是任务分解助手。根据能力说明生成具体可执行的子目标。只返回子目标文本。",  # TODO: 正式提示词
        )
        subgoal = raw.strip()
        log.info(f"子目标生成: {subgoal}")
        if not subgoal or subgoal == "{}":
            # LLM 按提示词规则返回 {}——任务已结束，静默跳过
            return None
        self._record_context("subgoal", subgoal, ctx_id)
        return subgoal

    async def _send_reply(self, text: str, done: bool, ctx_id: str) -> None:
        """回复用户。done=True 时以 reply.done 类型写入本 trace 上下文（任务结束标记）。"""
        self._record_context("reply.done" if done else "reply", text, ctx_id)
        await self._send_push(message=text, to_ws=self._display_ws)
        log.info(f"reply (done={done}): {text}")
