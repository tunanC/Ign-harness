"""Server-side file writing."""

import os
from pathlib import Path


async def run(params: dict) -> dict:
    """Write content to a file on the server filesystem.

    Args:
        params: {"path": str, "content": str, "encoding"?: str, "mode"?: str}

    Returns:
        {"path": str, "bytes_written": int, "mode": str}
    """
    path: str = params["path"]
    content: str = params["content"]
    encoding: str = params.get("encoding", "utf-8")
    mode: str = params.get("mode", "write")

    if not os.path.isabs(path):
        path = os.path.abspath(path)

    # Ensure parent directory exists
    Path(path).parent.mkdir(parents=True, exist_ok=True)

    write_mode = "a" if mode == "append" else "w"

    try:
        with open(path, write_mode, encoding=encoding) as f:
            bytes_written = f.write(content)

        return {
            "path": path,
            "bytes_written": bytes_written,
            "mode": mode,
        }
    except Exception as exc:
        return {
            "path": path,
            "bytes_written": 0,
            "mode": mode,
            "error": str(exc),
        }
