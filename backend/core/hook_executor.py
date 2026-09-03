"""Hook executor — dynamically loads hook.py modules and calls run().

Hooks are deterministic validation / audit steps. They do NOT involve LLM
reasoning.  An LLM selects which hooks to include in a plan; the hooks
themselves execute with simple pass / fail logic.

Usage:
    executor = HookExecutor()
    result = await executor.execute(hook_def, context)
    # result = {"pass": True, "message": ""}
"""

from __future__ import annotations

from .models import HookDef
from .loader import _load_module


class HookExecutor:
    """Executes a single hook by loading its hook.py and calling run()."""

    async def execute(self, hook_def: HookDef, context: dict) -> dict:
        """Run the hook.

        Args:
            hook_def: the hook definition (name, module_path, …)
            context: arbitrary dict passed to hook.run() —
                     typically {"goal": str, "tool_name": str, …}

        Returns:
            {"pass": bool, "message": str}
        """
        if hook_def.module_path is None:
            # No hook.py — treat as always-pass (definition-only hook)
            return {"pass": True, "message": ""}

        try:
            mod = _load_module(hook_def.module_path, hook_def.name)
            result = await mod.run(context)
            return result
        except Exception as exc:
            return {"pass": False, "message": f"Hook 执行异常: {exc}"}
