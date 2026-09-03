"""Server-side file reading."""

import os


async def run(params: dict) -> dict:
    """Read a file from the server filesystem.

    Args:
        params: {"path": str, "encoding"?: str, "lines"?: int}

    Returns:
        {"content": str, "path": str, "size": int, "truncated": bool}
    """
    path: str = params["path"]
    encoding: str = params.get("encoding", "utf-8")
    max_lines: int | None = params.get("lines")

    if not os.path.isabs(path):
        path = os.path.abspath(path)

    if not os.path.isfile(path):
        return {
            "content": "",
            "path": path,
            "size": 0,
            "error": f"文件不存在: {path}",
        }

    size = os.path.getsize(path)

    # Binary file detection — return hex preview
    if _is_binary(path):
        with open(path, "rb") as f:
            data = f.read(1024)
        return {
            "content": data.hex(),
            "path": path,
            "size": size,
            "binary": True,
            "truncated": size > 1024,
        }

    try:
        with open(path, "r", encoding=encoding, errors="replace") as f:
            if max_lines is not None:
                lines = []
                for i, line in enumerate(f):
                    if i >= max_lines:
                        break
                    lines.append(line)
                content = "".join(lines)
                truncated = len(lines) < sum(1 for _ in open(path, "r", encoding=encoding, errors="replace"))
            else:
                content = f.read()
                truncated = len(content) > 10000

        return {
            "content": content[:10000],
            "path": path,
            "size": size,
            "truncated": truncated,
        }
    except Exception as exc:
        return {
            "content": "",
            "path": path,
            "size": size,
            "error": str(exc),
        }


def _is_binary(path: str) -> bool:
    """Heuristic: check if file starts with a null byte or is a known binary extension."""
    binary_extensions = {".exe", ".dll", ".so", ".bin", ".dat", ".db", ".pyc", ".pyd", ".class", ".jar"}
    ext = os.path.splitext(path)[1].lower()
    if ext in binary_extensions:
        return True
    try:
        with open(path, "rb") as f:
            chunk = f.read(512)
        return b"\x00" in chunk
    except Exception:
        return False
