"""FastAPI application factory.

Called by server.py on startup.  Registers all routers, CORS, and the
WebSocket endpoint with PE dispatch.

Start with:  uvicorn app:create_app --factory --host 0.0.0.0 --port 7017
"""

import asyncio
import platform
import uuid

from fastapi import FastAPI, WebSocket, Header
from fastapi.middleware.cors import CORSMiddleware

from database import init_db, get_connection, get_assistant_name
from core.ws_manager import ws_manager
from core.client_manager import ClientManager
from core.loader import CapabilityManager
from core.llm_client import LLMClient
from core.session_manager import SessionManager
from core.executor import Executor
from core.logger import get_logger
from core.persona import persona_manager
from core.proxies import ClientToolProxy

log = get_logger("app")

# Routers
from routers.health   import router as health_router
from routers.auth     import router as auth_router
from routers.settings import router as settings_router
from routers.license  import router as license_router
from routers.devices  import router as devices_router
from routers.speech   import router as speech_router

VALID_CLIENT_TYPES = {"desktop", "glasses", "robot", "autonomous-driving"}


def create_app() -> FastAPI:
    # ── Database bootstrap ───────────────────────────────────────
    init_db()

    # ── Persona: load assistant identity ─────────────────────────
    name_from_db = None
    try:
        conn = get_connection()
        try:
            name_from_db = get_assistant_name(conn)
        finally:
            conn.close()
    except Exception:
        pass
    persona_manager.load(conn_factory=get_connection, name_from_db=name_from_db)

    # ── Capability manager (shared — loaded once at startup) ─────
    server_os = platform.system().lower()
    capability_manager = CapabilityManager(server_os=server_os)
    capability_manager.scan_all()
    log.info(f"Capabilities loaded: "
          f"{len(capability_manager.tools)} tools, "
          f"{len(capability_manager.hooks)} hooks, "
          f"{len(capability_manager.skills)} skills, "
          f"{len(capability_manager.agents)} agents")

    # ── LLM client (shared — reads config from DB each call) ─────
    llm_client = LLMClient(get_connection)

    # ── Client manager (shared — tracks all online devices) ──────
    client_manager = ClientManager()

    # ── Session manager (shared — cross-device dispatch) ─────────
    session_manager = SessionManager(
        llm_client=llm_client,
        capability_manager=capability_manager,
        ws_manager=ws_manager,
        client_manager=client_manager,
        server_os=server_os,
    )

    # ── FastAPI instance ─────────────────────────────────────────
    app = FastAPI(title="Ign Server", version="2.0.0")
    # 共享状态：devices router 需要 client_manager 做设备名占用检查；
    # speech router 需要 llm_client 做语音转录
    app.state.client_manager = client_manager
    app.state.llm_client = llm_client

    # ── CORS — allow all origins for local/private use ───────────
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_methods=["*"],
        allow_headers=["*"],
    )

    # ── REST routers ─────────────────────────────────────────────
    app.include_router(health_router)
    app.include_router(auth_router)
    app.include_router(settings_router)
    app.include_router(license_router)
    app.include_router(devices_router)
    app.include_router(speech_router)

    # ── WebSocket endpoint ───────────────────────────────────────
    @app.websocket("/Ign/v1/ws")
    async def ws_endpoint(ws: WebSocket,
                          x_client_type: str = Header(alias="X-Client-Type", default=""),
                          x_client_os: str = Header(alias="X-Client-OS", default="unknown"),
                          x_device_uuid: str = Header(alias="X-Device-UUID", default="unknown"),
                          x_device_name: str = Header(alias="X-Device-Name", default="")):
        # Query params as fallback (WebView WebSocket can't set custom headers)
        qp = dict(ws.query_params) if hasattr(ws, 'query_params') and ws.query_params else {}
        x_client_type = x_client_type or qp.get("client_type", "")
        x_client_os = x_client_os if x_client_os != "unknown" else qp.get("client_os", "unknown")
        x_device_uuid = x_device_uuid if x_device_uuid != "unknown" else qp.get("device_uuid", "unknown")
        x_device_name = x_device_name or qp.get("device_name", "")
        # Validate client type header
        if x_client_type not in VALID_CLIENT_TYPES:
            await ws.close(code=4000, reason="Invalid or missing X-Client-Type")
            return

        client_os = x_client_os.lower()

        # ── Register with ClientManager ──────────────────────────
        # 重名校验主流程在登录界面（check-name API）；此处静默拒绝兜底，
        # 防绕过 REST 直连 WS 的同名连接（4001 → 客户端不重连）
        info = client_manager.register(
            ws=ws,
            device_uuid=x_device_uuid,
            device_type=x_client_type,
            client_os=client_os,
            device_name=x_device_name,
        )
        if info is None:
            await ws.accept()
            await ws.close(code=4001, reason="Device name already in use")
            return

        # Also register with ws_manager (low-level WS routing)
        await ws_manager.connect(ws, x_client_type,
                                client_os=client_os,
                                device_uuid=x_device_uuid)

        # ── Per-connection executor state ────────────────────────
        # (flow tracking is managed by SessionManager)

        async def handle_message(client_type: str, data: dict):
            msg_type = data.get("type", "")

            # ══════════════════════════════════════════════════════
            # chat_send — user sends a message
            # ══════════════════════════════════════════════════════
            if msg_type == "chat_send":
                log.info(f"chat_send received from {x_device_uuid}")
                messages = data.get("payload", {}).get("messages", [])
                if not messages:
                    log.info("chat_send: empty messages, ignored")
                    return
                goal = messages[-1].get("content", "")
                log.info(f"chat_send: goal={goal}")

                # PE 入口：一轮对话一个新 ctx_id（新 trace），上下文按 id 分桶隔离
                ctx_id = uuid.uuid4().hex[:12]
                executor = Executor(
                    llm_client=llm_client,
                    capability_manager=capability_manager,
                    ws_manager=ws_manager,
                    client_manager=client_manager,
                    source_device_uuid=x_device_uuid,
                    server_os=server_os,
                )

                # 环境信息注入上下文——设备事实由数据承载，不写死在能力 md 里
                executor._record_context("env", {
                    "server_os": server_os,
                    "source_device": {"type": x_client_type, "os": x_client_os},
                }, ctx_id)

                async def _run_entry() -> None:
                    try:
                        await executor._pe(goal, None, ctx_id)
                    except Exception as exc:
                        log.error(f"PE 异常: {exc}", exc_info=True)

                asyncio.create_task(_run_entry())

            # ══════════════════════════════════════════════════════
            # tool_result — ANY device can return tool results
            # ══════════════════════════════════════════════════════
            elif msg_type == "tool_result":
                payload = data.get("payload", {})
                call_id = payload.get("call_id", "")
                # 单命令带 result 字段；并行新协议 payload 直接携带 {type,count,results}（无 result 键）
                result = payload.get("result", payload)
                # 跨设备路由：全局查找对应的 ClientToolProxy
                ClientToolProxy.resolve_any(call_id, result)

            # ══════════════════════════════════════════════════════
            # signal — user control (abort, …)
            # ══════════════════════════════════════════════════════
            elif msg_type == "signal":
                signal_type = data.get("payload", {}).get("signal_type", "")
                if signal_type == "abort":
                    flow = session_manager.get_flow_for_device(x_device_uuid)
                    if flow and flow.executor.is_running:
                        flow.executor.abort()
                        await ws_manager.send(
                            ws, "chat_delta",
                            {"content": "已收到中断信号，正在收尾…"},
                        )

        async def handle_disconnect(client_type: str):
            # Abort any running flow from this device
            flow = session_manager.get_flow_for_device(x_device_uuid)
            if flow and flow.executor.is_running:
                flow.executor.abort()
            client_manager.unregister(x_device_uuid, ws=ws)

        await ws_manager.reader(ws, x_client_type,
                                on_message=handle_message,
                                on_disconnect=handle_disconnect)

    return app
