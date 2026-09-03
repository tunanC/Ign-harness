"""Data models for capabilities — ToolDef, HookDef, SkillDef, AgentDef.

These are plain data structures. No behaviour, no I/O — just what the loader
produces and what the executor / hook-executor consumes.
"""

from dataclasses import dataclass, field


# ── Parameter definition (for tool params schema) ──────────────────────

@dataclass
class ParamDef:
    name: str
    type: str          # "string" | "integer" | "boolean" | "object"
    required: bool = True
    description: str = ""


# ── Capability definitions ─────────────────────────────────────────────

@dataclass
class ToolDef:
    """A single tool — server-side or client-side."""
    name: str                             # "server:windows:bash" / "client:desktop:windows:bash"
    scope: str                            # "core" | "extends"
    execution_location: str               # "server" | "client"
    os: str                               # "windows" | "centos" | …
    device: str | None = None             # "desktop" | "glasses" | …  (None for server tools)
    description: str = ""
    md_content: str = ""                  # full markdown body (for LLM context expansion)
    params: list[ParamDef] = field(default_factory=list)
    module_path: str | None = None        # path to tool.py  (None for client tools)
    default_pre_hooks: list[str] = field(default_factory=list)
    default_post_hooks: list[str] = field(default_factory=list)


@dataclass
class HookDef:
    """A hook — pre- or post-execution check."""
    name: str                             # "server:windows:permission-check"
    scope: str
    description: str = ""
    md_content: str = ""
    module_path: str | None = None        # path to hook.py


@dataclass
class SkillDef:
    """A named skill that bundles tools, hooks and sub-skills."""
    name: str                             # "server:windows:code-review"
    scope: str
    description: str = ""
    md_content: str = ""
    default_tools: list[str] = field(default_factory=list)
    default_pre_hooks: list[str] = field(default_factory=list)
    default_post_hooks: list[str] = field(default_factory=list)
    default_skills: list[str] = field(default_factory=list)


@dataclass
class AgentDef:
    """An agent — like a skill but with identity / persona."""
    name: str
    scope: str
    description: str = ""
    identity: str = ""
    md_content: str = ""
    default_tools: list[str] = field(default_factory=list)
    default_pre_hooks: list[str] = field(default_factory=list)
    default_post_hooks: list[str] = field(default_factory=list)
    default_skills: list[str] = field(default_factory=list)
