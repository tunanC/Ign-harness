#!/usr/bin/env bash
# Ign Server — Dev launcher
# Run from project root:  ./deploy/dev/start-server.sh

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

export IGN_DATA_DIR="$SCRIPT_DIR/data"
export PYTHONPATH="$PROJECT_ROOT/backend"
export PYTHONIOENCODING=utf-8

# Ensure data dir exists
mkdir -p "$IGN_DATA_DIR"

echo -e "\033[36mData dir: $IGN_DATA_DIR\033[0m"
echo -e "\033[32mStarting on http://127.0.0.1:7017\033[0m"

source "$PROJECT_ROOT/.venv/Scripts/activate" 2>/dev/null || source "$PROJECT_ROOT/.venv/bin/activate" 2>/dev/null
cd "$PROJECT_ROOT/backend" || exit 1
python server.py 2>&1 | tee "$SCRIPT_DIR/server.log"
