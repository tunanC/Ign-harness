"""
跨平台部署脚本（公共逻辑）

职责:
  在用户指定的安装目录下创建运行时目录结构，初始化数据库。

  具体平台逻辑（路径检测、权限等）由各平台 wrapper 处理：
    Windows: deploy/windows/deploy.ps1
    Linux:   deploy/linux/deploy.sh     (未来)
    机器人:  deploy/robot/deploy.sh     (未来)

用法:
  python deploy/deploy.py --data-dir <安装目录>

幂等:
  重复执行安全，已存在的数据不会被覆盖。
"""

import argparse
import logging
import os
import sys

# 让 deploy.py 能 import backend 下的模块
_BACKEND_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "backend")
if _BACKEND_DIR not in sys.path:
    sys.path.insert(0, _BACKEND_DIR)

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [deploy] %(levelname)s: %(message)s",
)
logger = logging.getLogger("deploy")


def main():
    parser = argparse.ArgumentParser(
        description="FreedomUI Platform — 跨平台部署"
    )
    parser.add_argument(
        "--data-dir", required=True,
        help="用户选择的安装目录（e.g. D:\\MyPlatform, /opt/platform）",
    )
    parser.add_argument(
        "--version", default="0.1.0",
        help="版本号",
    )
    args = parser.parse_args()

    data_dir = os.path.abspath(args.data_dir)
    logger.info(f"部署目标: {data_dir}  (v{args.version})")

    # 1. 创建运行时目录结构
    _create_directory_structure(data_dir)

    # 2. 写入平台配置文件
    _write_platform_config(data_dir, args.version)

    # 3. 初始化数据库
    os.environ["CAPABILITY_RUNTIME_DIR"] = data_dir
    from database import init_db
    init_db()

    logger.info(f"部署完成 — {data_dir}")


def _create_directory_structure(data_dir: str):
    """创建运行时所需的全部目录"""
    dirs = [
        os.path.join(data_dir, "data"),
        os.path.join(data_dir, "data", "embeddings"),
        os.path.join(data_dir, "data", "logs"),
        os.path.join(data_dir, "data", "sessions"),
    ]
    for d in dirs:
        os.makedirs(d, exist_ok=True)
    logger.info(f"目录结构已创建 ({len(dirs)} 个)")


def _write_platform_config(data_dir: str, version: str):
    """写入跨平台配置文件（替代 Windows 注册表）"""
    import yaml
    from datetime import datetime

    config = {
        "version": version,
        "installDate": datetime.now().isoformat(),
        "dataDir": os.path.join(data_dir, "data"),
    }
    config_path = os.path.join(data_dir, "data", "platform.yaml")
    with open(config_path, "w", encoding="utf-8") as f:
        yaml.dump(config, f, allow_unicode=True, default_flow_style=False)
    logger.info(f"平台配置已写入: {config_path}")


if __name__ == "__main__":
    main()
