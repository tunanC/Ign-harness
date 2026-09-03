"""Ign Server — CLI entry point.

Usage:
    python server.py                  # default port 7017
    python server.py --port 8080      # custom port
    python server.py --host 0.0.0.0   # bind to all interfaces
"""

import argparse
import uvicorn

from core.logger import get_logger

log = get_logger("server")


def main():
    parser = argparse.ArgumentParser(description="Ign Server")
    parser.add_argument("--host", default="127.0.0.1", help="Bind address")
    parser.add_argument("--port", type=int, default=7017, help="Listen port")
    args = parser.parse_args()

    log.info(f"Ign Server starting on {args.host}:{args.port}")
    uvicorn.run(
        "app:create_app",
        host=args.host,
        port=args.port,
        factory=True,
        log_level="info",
    )


if __name__ == "__main__":
    main()
