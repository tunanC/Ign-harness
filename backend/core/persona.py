from __future__ import annotations

"""Assistant persona manager — loads identity from persona.md and keeps
the assistant name in sync with the database.

Usage:
    from core.persona import persona_manager
    persona_manager.load()                      # called once at startup
    text = persona_manager.get_persona_text()   # for PE system prompt
    name = persona_manager.name                 # current assistant name
    persona_manager.set_name("新名字")           # updates DB + memory
"""

from .logger import get_logger

log = get_logger("core.persona")

from pathlib import Path

PERSONA_MD = Path(__file__).resolve().parent.parent / "persona.md"


class PersonaManager:
    """Singleton that holds the assistant persona and mutable name."""

    def __init__(self):
        self._template: str = ""
        self.name: str = "小助手"
        self._conn_factory = None  # callable → sqlite3.Connection

    # ── Startup ─────────────────────────────────────────────────────

    def load(self, conn_factory=None, name_from_db: str | None = None) -> None:
        """Call once at startup. Loads persona.md and resolves the name."""
        self._conn_factory = conn_factory

        if PERSONA_MD.is_file():
            self._template = PERSONA_MD.read_text(encoding="utf-8")

        if name_from_db:
            self.name = name_from_db

        log.info(f"loaded ({len(self._template)} chars), name={self.name}")

    # ── Public ───────────────────────────────────────────────────────

    def get_persona_text(self) -> str:
        """Return the full persona text with {name} substituted."""
        if not self._template:
            return f"你是 {self.name}，一个私人智能助手。"
        return self._template.replace("{name}", self.name)

    def set_name(self, new_name: str) -> None:
        """Update the assistant name in memory + database."""
        self.name = new_name
        if self._conn_factory:
            conn = self._conn_factory()
            try:
                import json
                conn.execute(
                    "INSERT OR REPLACE INTO settings (key, value) VALUES ('assistant_name', ?)",
                    (json.dumps(new_name),),
                )
                conn.commit()
            finally:
                conn.close()


# ── Singleton ────────────────────────────────────────────────────────

persona_manager = PersonaManager()
