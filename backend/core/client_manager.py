"""Client Manager — 管理所有在线客户端及其关系。

Phase 1（当前）：个人设备，共享记忆，心跳保活。
未来扩展：whitelist（server→server 高权限指令）、registered（RBAC 注册）、social（对等社交）。

Usage:
    manager = ClientManager()
    manager.register(ws, device_uuid, device_type, client_os)
    ws = manager.get_ws(device_type="desktop")
    manager.unregister(device_uuid)
"""

from __future__ import annotations

import time
from dataclasses import dataclass, field
from enum import Enum

from fastapi import WebSocket

from .logger import get_logger

log = get_logger("core.client_manager")


HEARTBEAT_TIMEOUT = 90  # seconds — no ping within this window → 标记离线


class ClientRelation(str, Enum):
    """客户端与当前 Server 的关系类型。"""
    personal = "personal"        # Phase 1: 用户个人设备

    # ── 未来扩展 ──────────────────────────────────────────────
    # whitelist  = "whitelist"   # Phase 2: 本 Server 信任的远程 Server（高→低发指令）
    # registered = "registered"  # Phase 3: 本 Server 注册到的上级 Server（低→高，RBAC）
    # social     = "social"      # Phase 4: Server 间对等社交关系


@dataclass
class ClientInfo:
    """单个在线客户端的信息。"""
    device_uuid: str
    device_type: str          # "desktop" | "glasses" | "robot" | "autonomous-driving"
    client_os: str
    ws: WebSocket
    device_name: str = ""     # 设备名（用户说话用名称指代设备，不用 id；在线设备间唯一）
    relation: ClientRelation = ClientRelation.personal
    last_heartbeat: float = field(default_factory=time.time)
    online: bool = True
    metadata: dict = field(default_factory=dict)  # 扩展位: rbac_role, permissions, ...


class ClientManager:
    """管理所有已连接客户端。

    device_uuid 是唯一标识——同一设备断线重连后 uuid 不变。
    """

    def __init__(self):
        self._clients: dict[str, ClientInfo] = {}  # device_uuid → ClientInfo

    # ── Registration ────────────────────────────────────────────

    def register(
        self,
        ws: WebSocket,
        device_uuid: str,
        device_type: str,
        client_os: str,
        device_name: str = "",
        relation: ClientRelation = ClientRelation.personal,
    ) -> ClientInfo | None:
        """注册一个客户端连接。同 uuid 重连时覆盖旧连接。

        设备名唯一性：名称已被其他在线设备占用时拒绝注册（返回 None）。
        客户端未提供名称时用设备类型 + uuid 前缀兜底（基本唯一）。
        """
        # 如果已有同 uuid 的旧连接，先清理
        if device_uuid in self._clients:
            log.info(f"reconnect {device_type}/{device_uuid}")

        device_name = (device_name or "").strip() or f"{device_type}-{device_uuid[:8]}"
        if self.is_name_taken(device_name, exclude_uuid=device_uuid):
            log.warning(f"设备名冲突: '{device_name}' 已被其他在线设备占用，拒绝注册 {device_uuid}")
            return None

        info = ClientInfo(
            device_uuid=device_uuid,
            device_type=device_type,
            client_os=client_os,
            ws=ws,
            relation=relation,
            device_name=device_name,
        )
        self._clients[device_uuid] = info
        log.info(f"+ {device_type}/{client_os}/{device_uuid} '{device_name}' "
              f"({len(self._clients)} online)")
        return info

    def is_name_taken(self, name: str, exclude_uuid: str = "") -> bool:
        """设备名是否已被其他在线设备占用（空名视为占用）。"""
        name = (name or "").strip()
        if not name:
            return True
        for uid, info in self._clients.items():
            if uid != exclude_uuid and info.device_name == name:
                return True
        return False

    def unregister(self, device_uuid: str, ws: WebSocket | None = None) -> None:
        """注销一个客户端连接。ws 参数用于防止旧连接误删新连接。"""
        info = self._clients.get(device_uuid)
        if info is None:
            return
        if ws is not None and info.ws is not ws:
            return  # 旧连接已被新连接替换，跳过
        self._clients.pop(device_uuid)
        log.info(f"- {info.device_type}/{device_uuid} "
              f"({len(self._clients)} online)")

    # ── Heartbeat ───────────────────────────────────────────────

    def heartbeat(self, device_uuid: str) -> None:
        """更新心跳时间戳。"""
        info = self._clients.get(device_uuid)
        if info:
            info.last_heartbeat = time.time()
            info.online = True

    # ── Lookup ──────────────────────────────────────────────────

    def get_ws(
        self,
        *,
        device_type: str | None = None,
        device_uuid: str | None = None,
    ) -> WebSocket | None:
        """查找目标设备的 WebSocket。

        device_type 和 device_uuid 二选一。
        多个同类型设备在线时返回第一个匹配。
        """
        if device_uuid:
            info = self._clients.get(device_uuid)
            return info.ws if info and info.online else None

        if device_type:
            for info in self._clients.values():
                if info.device_type == device_type and info.online:
                    return info.ws
        return None

    def get_info(self, device_uuid: str) -> ClientInfo | None:
        """获取客户端完整信息。"""
        return self._clients.get(device_uuid)

    def get_info_by_name(self, name: str) -> ClientInfo | None:
        """按设备名查在线设备（名称在线唯一——LLM 用名称指代设备）。"""
        name = (name or "").strip()
        if not name:
            return None
        for info in self._clients.values():
            if info.device_name == name and info.online:
                return info
        return None

    def get_online_devices(self) -> list[ClientInfo]:
        """列出所有在线设备。"""
        return [info for info in self._clients.values() if info.online]

    def get_device_summary(self) -> str:
        """生成设备摘要，给 plan / 参数生成 prompt 用。

        每项字段：设备类型、设备系统、id（查 WS 连接用）、设备名（用户说话用）。
        设备断线即从注册表移除，故清单里只有在线设备。
        """
        online = self.get_online_devices()
        if not online:
            return "(无在线设备)"
        lines = []
        for info in online:
            lines.append(
                f"- **{info.device_type}** ({info.client_os}): id={info.device_uuid}, 名称={info.device_name}"
            )
        return "\n".join(lines)

    @property
    def online_count(self) -> int:
        return sum(1 for info in self._clients.values() if info.online)
