"""Permission check hook — placeholder for future ACL integration."""


async def run(context: dict) -> dict:
    """Validate permission for the pending action.

    Args:
        context: {"goal": str, "tool_name": str, "params": dict, "execution_log": list}

    Returns:
        {"pass": bool, "message": str}
    """
    # Phase 2 placeholder — always pass
    return {"pass": True, "message": ""}
