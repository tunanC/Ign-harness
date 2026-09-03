"""Logger — 写入固定日志文件，与 uvicorn access 日志分离。

开发环境: deploy/dev/log.log
生产环境: <项目根>/log/ign.log

Usage:
    from core.logger import get_logger
    log = get_logger("core.executor")
    log.info("step 1: plan for ...")
    log.error("LLM 调用失败", exc_info=True)
"""

import logging
import os
import re
import sys
from pathlib import Path

_LOG_FILE: str | None = None
_root_configured = False

# ── 敏感信息脱敏 ─────────────────────────────────────────────────────
# key 名含以下关键词的 JSON 字段值、以及 sk- 开头的 API key，一律打码
_SENSITIVE_KEY_RE = re.compile(
    r'(["\'](?:api[_-]?key|apikey|secret|token|password|passwd|access[_-]?key|'
    r'private[_-]?key|credential|auth[_-]?token)["\']\s*[:=]\s*["\'])([^"\']{6,})(["\'])',
    re.IGNORECASE,
)
_SK_PREFIX_RE = re.compile(r'\bsk-[A-Za-z0-9_-]{10,}\b')


def redact(text: str) -> str:
    """把日志文本中的敏感信息打码。"""
    text = _SENSITIVE_KEY_RE.sub(r'\1***REDACTED***\3', text)
    text = _SK_PREFIX_RE.sub('sk-***REDACTED***', text)
    return text


class _RedactFilter(logging.Filter):
    def filter(self, record: logging.LogRecord) -> bool:
        try:
            record.msg = redact(str(record.msg))
            if record.args:
                args = list(record.args)
                for i, a in enumerate(args):
                    if isinstance(a, str):
                        args[i] = redact(a)
                record.args = tuple(args)
        except Exception:
            pass
        return True


def _resolve_log_file() -> str:
    """确定日志文件路径，确保目录存在。"""
    global _LOG_FILE
    if _LOG_FILE:
        return _LOG_FILE

    # 项目根目录
    project_root = Path(__file__).resolve().parent.parent.parent

    # 检测是否为开发环境（deploy/dev 目录存在）
    dev_data = project_root / "deploy" / "dev"
    if dev_data.is_dir():
        log_dir = dev_data
        log_name = "log.log"
    else:
        # 生产环境
        log_dir = project_root / "log"
        log_name = "ign.log"

    log_dir.mkdir(parents=True, exist_ok=True)
    _LOG_FILE = str(log_dir / log_name)
    return _LOG_FILE


def _ensure_configured():
    global _root_configured
    if _root_configured:
        return
    _root_configured = True

    # 强制 Python I/O 使用 UTF-8
    os.environ.setdefault("PYTHONIOENCODING", "utf-8")

    log_file = _resolve_log_file()

    # 根 logger
    root = logging.getLogger("ign")
    root.setLevel(logging.DEBUG)
    root.propagate = False  # 不往 uvicorn 的 handler 传播
    root.addFilter(_RedactFilter())  # 所有日志过脱敏

    # 文件 handler（全量 DEBUG）
    fh = logging.FileHandler(log_file, encoding="utf-8")
    fh.setLevel(logging.DEBUG)
    fh.setFormatter(logging.Formatter(
        "%(asctime)s [%(levelname)-5s] %(name)s: %(message)s",
        datefmt="%Y-%m-%d %H:%M:%S",
    ))
    root.addHandler(fh)

    # 控制台 handler（INFO 及以上）
    # Windows 控制台默认 GBK，遇到特殊字符会崩溃 → 换成 utf-8 容错
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass
    ch = logging.StreamHandler(sys.stdout)
    ch.setLevel(logging.INFO)
    ch.setFormatter(logging.Formatter(
        "[%(levelname)-5s] %(name)s: %(message)s",
    ))
    root.addHandler(ch)

    root.info(f"日志文件: {log_file}")


def get_logger(name: str) -> logging.Logger:
    """获取 ign 命名空间下的 logger。

    name 格式: "模块.文件名"，如 "core.executor", "routers.auth", "app"
    """
    _ensure_configured()
    return logging.getLogger(f"ign.{name}")
