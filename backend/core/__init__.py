"""Ign Core — SPMP engine, capability system, tool / hook execution."""

from .models import ToolDef, HookDef, SkillDef, AgentDef, ParamDef
from .loader import CapabilityManager
from .llm_client import LLMClient, LLMError
from .hook_executor import HookExecutor
from .proxies import ToolProxy, ServerToolProxy, ClientToolProxy
from .client_manager import ClientManager, ClientInfo, ClientRelation
from .executor import Executor
