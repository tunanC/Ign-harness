"""Capability loader — scans the capabilities/ directory at startup and
builds an in-memory index of all tools, hooks, skills and agents.

Usage:
    manager = CapabilityManager(server_os="windows", client_os="windows")
    manager.scan_all()
    tools = manager.tools   # dict[str, ToolDef]
    hooks = manager.hooks   # dict[str, HookDef]
    summary = manager.get_capability_list_for_llm()  # flat text for S-phase
"""

from __future__ import annotations

import importlib.util
import os
import sys
from pathlib import Path
from typing import Any

from .models import HookDef, ParamDef, SkillDef, AgentDef, ToolDef
from .logger import get_logger

log = get_logger("core.loader")

# ── Helpers ────────────────────────────────────────────────────────────

_CAPABILITIES_ROOT = Path(__file__).resolve().parent.parent.parent / "capabilities"


def _parse_frontmatter(md_text: str) -> tuple[dict[str, Any], str]:
    """Extract YAML-like frontmatter from a markdown file.

    Returns (frontmatter_dict, body_markdown).
    If no frontmatter is found the dict is empty and body is the full text.
    """
    if not md_text.startswith("---"):
        return {}, md_text
    parts = md_text.split("---", 2)
    if len(parts) < 3:
        return {}, md_text
    return _parse_yaml_lite(parts[1].strip()), parts[2].strip()


def _parse_yaml_lite(text: str) -> dict[str, Any]:
    """Minimal YAML-like parser — handles scalars and simple lists-of-dicts.

    Only used for capability frontmatter, which has a very constrained shape:
        key: scalar
        params:
          - name: x
            type: string
            required: true
            description: ...
    """
    result: dict[str, Any] = {}
    params_list: list[dict] | None = None   # non-None means "inside params: list"
    current_item: dict | None = None

    lines = text.splitlines()
    i = 0
    while i < len(lines):
        line = lines[i].rstrip()
        if not line:
            i += 1
            continue

        # ── Top-level key: value ──
        if not line.startswith((" ", "-", "\t")):
            colon = line.find(":")
            if colon == -1:
                i += 1
                continue
            key = line[:colon].strip()
            value = line[colon + 1:].strip()

            if value:
                result[key] = _coerce(value)
                i += 1
            elif key == "params":
                # Start of param list — parse indented items
                params_list = []
                current_item = None
                i += 1
                while i < len(lines):
                    sub = lines[i].rstrip()
                    stripped = sub.lstrip()
                    if not stripped:
                        i += 1
                        continue
                    if stripped.startswith("- "):
                        # New list item
                        if current_item:
                            params_list.append(current_item)
                        current_item = {}
                        inner = stripped[2:].strip()
                        if ":" in inner:
                            k, _, v = inner.partition(":")
                            current_item[k.strip()] = _coerce(v.strip())
                        i += 1
                    elif sub.startswith(("  ", "\t")) and current_item is not None and ":" in sub:
                        k, _, v = stripped.partition(":")
                        current_item[k.strip()] = _coerce(v.strip())
                        i += 1
                    else:
                        # No longer inside params list
                        break
                if current_item:
                    params_list.append(current_item)
                result["params"] = params_list
            else:
                i += 1
        else:
            i += 1

    return result


def _coerce(value: str) -> str | bool | int:
    """Coerce a YAML scalar string to the appropriate Python type."""
    v = value.strip()
    if v.lower() == "true":
        return True
    if v.lower() == "false":
        return False
    if v.isdigit():
        return int(v)
    return v


def _load_module(module_path: str, name: str) -> Any:
    """Dynamically import a Python module by filesystem path."""
    spec = importlib.util.spec_from_file_location(name, module_path)
    if spec is None or spec.loader is None:
        raise ImportError(f"Cannot load module: {module_path}")
    mod = importlib.util.module_from_spec(spec)
    sys.modules[name] = mod
    spec.loader.exec_module(mod)
    return mod


def _build_name(segments: list[str]) -> str:
    """Join segments with ':' to form a capability name."""
    return ":".join(segments)


# ── Scanner ────────────────────────────────────────────────────────────

class CapabilityManager:
    """In-memory index of all capabilities loaded from the filesystem.

    Loads ALL capabilities regardless of OS — capability names already
    encode device:os (e.g. client:desktop:windows:bash), so the LLM
    selects the right one via the S-phase routing.
    """

    def __init__(self, server_os: str):
        self.server_os = server_os.lower()

        self.tools: dict[str, ToolDef] = {}
        self.hooks: dict[str, HookDef] = {}
        self.skills: dict[str, SkillDef] = {}
        self.agents: dict[str, AgentDef] = {}

    # ── Public API ─────────────────────────────────────────────────

    def scan_all(self) -> None:
        """Walk the capabilities/ tree and load everything into memory."""
        if not _CAPABILITIES_ROOT.is_dir():
            log.warning(f"capabilities directory not found: {_CAPABILITIES_ROOT}")
            return

        for scope_dir in sorted(_CAPABILITIES_ROOT.iterdir()):
            if not scope_dir.is_dir():
                continue
            scope = scope_dir.name  # "core" | "extends"

            # Server-side capabilities (grouped by OS)
            server_dir = scope_dir / "server"
            if server_dir.is_dir():
                for os_dir in sorted(server_dir.iterdir()):
                    if os_dir.is_dir():
                        self._scan_directory(os_dir, scope, "server", os_dir.name)

            # Client-side capabilities (grouped by device type, then OS)
            client_dir = scope_dir / "client"
            if client_dir.is_dir():
                for device_dir in sorted(client_dir.iterdir()):
                    if device_dir.is_dir():
                        for os_dir in sorted(device_dir.iterdir()):
                            if os_dir.is_dir():
                                self._scan_directory(os_dir, scope, "client", os_dir.name, device=device_dir.name)

    def get_capability_list_for_llm(self) -> str:
        """Build a flat text summary for the S-phase system prompt."""
        lines: list[str] = []

        def _append_section(title: str, items: dict):
            if not items:
                return
            lines.append(f"### {title}")
            for name, obj in sorted(items.items()):
                lines.append(f"- **{name}**: {obj.description}")
            lines.append("")

        _append_section("Tools", self.tools)
        _append_section("Hooks", self.hooks)
        _append_section("Skills", self.skills)
        _append_section("Agents", self.agents)

        return "\n".join(lines).strip() if lines else "(没有可用能力)"

    # ── Internal scanners ──────────────────────────────────────────

    def _scan_directory(self, root: Path, scope: str, location: str, os_name: str,
                        device: str | None = None) -> None:
        """Recursively scan a type directory for capability definitions."""
        for cap_type in ("tools", "hooks", "skills", "agents", "apps"):
            type_dir = root / cap_type
            if not type_dir.is_dir():
                continue
            for cap_dir in sorted(type_dir.iterdir()):
                if not cap_dir.is_dir():
                    continue
                self._load_capability(cap_dir, scope, location, cap_type.rstrip("s"), os_name, device)

    def _load_capability(self, cap_dir: Path, scope: str, location: str,
                         cap_type: str, os_name: str, device: str | None) -> None:
        """Load a single capability from its directory."""
        md_file = cap_dir / f"{cap_type}.md"
        py_file = cap_dir / f"{cap_type}.py"

        if not md_file.is_file():
            return  # skip — every capability MUST have a definition file

        md_text = md_file.read_text(encoding="utf-8")
        fm, body = _parse_frontmatter(md_text)
        description = fm.get("description", "")

        # Build the canonical name
        if location == "server":
            name = _build_name(["server", os_name, cap_dir.name])
        else:
            # client:device:os:name
            name = _build_name(["client", device or "unknown", os_name, cap_dir.name])

        module_path = str(py_file) if py_file.is_file() else None

        # Dispatch to the right constructor
        if cap_type == "tool":
            params_raw: list[dict] = fm.get("params", [])
            params = [
                ParamDef(
                    name=p.get("name", ""),
                    type=p.get("type", "string"),
                    required=p.get("required", True),
                    description=p.get("description", ""),
                )
                for p in params_raw
            ]
            self.tools[name] = ToolDef(
                name=name,
                scope=scope,
                execution_location=location,
                os=os_name,
                device=device,
                description=description,
                md_content=body,
                params=params,
                module_path=module_path,
            )

        elif cap_type == "hook":
            self.hooks[name] = HookDef(
                name=name,
                scope=scope,
                description=description,
                md_content=body,
                module_path=module_path,
            )

        elif cap_type == "skill":
            self.skills[name] = SkillDef(
                name=name,
                scope=scope,
                description=description,
                md_content=body,
            )

        elif cap_type == "agent":
            self.agents[name] = AgentDef(
                name=name,
                scope=scope,
                description=description,
                identity=fm.get("identity", ""),
                md_content=body,
            )
