"""Device router — device name availability check.

GET /Ign/v1/devices/check-name?name=xxx — whether the name is taken
by another online device (login window calls this before connecting).
"""

from fastapi import APIRouter, Request

from core.logger import get_logger

log = get_logger("routers.devices")

router = APIRouter()


@router.get("/Ign/v1/devices/check-name")
def check_device_name(name: str, request: Request, exclude_uuid: str = ""):
    """设备名占用检查。空名视为占用。

    exclude_uuid：请求者自身设备的 uuid——自己旧连接（如应用强杀后
    60s 超时窗口内重启）占用的名字应放行，否则用户会被自己挡住。
    """
    client_manager = request.app.state.client_manager
    available = not client_manager.is_name_taken(name, exclude_uuid=exclude_uuid)
    return {"available": available}