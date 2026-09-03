# Ign Server 部署流程

以下为通用部署步骤，不同平台按对应方式执行。

---

## 1. 设置环境变量

| 变量 | 说明 | 示例值 |
|---|---|---|
| `IGN_DATA_DIR` | 数据目录（存放 app.db） | `./deploy/dev/data`（相对）或绝对路径 |
| `PYTHONPATH` | Python 模块搜索路径 | `./backend`（指向项目 backend 目录） |

**Windows (PowerShell):**
```powershell
$env:IGN_DATA_DIR = ".\deploy\dev\data"
$env:PYTHONPATH = ".\backend"
```

**Linux / macOS (Bash):**
```bash
export IGN_DATA_DIR="./deploy/dev/data"
export PYTHONPATH="./backend"
```

## 2. 创建数据目录

确保 `IGN_DATA_DIR` 指向的目录存在（首次部署需手动创建，后续 Server 启动时也会自动创建）。

- 目录为空时，Server 首次启动会自动创建 `app.db`
- 目录中已有 `app.db` 则保留已有数据

## 3. 安装 Python 依赖

```bash
python -m venv .venv
source .venv/bin/activate      # Linux/Mac
# 或
.venv\Scripts\Activate.ps1      # Windows PowerShell

pip install -r backend/requirements.txt
```

## 4. 启动 Server

在项目根目录执行：

```bash
cd backend && python server.py
```

默认监听 `http://127.0.0.1:7017`。

---

## 清理重建

若需完全重置数据库：

1. 停止 Server
2. 删除数据目录下的 `app.db`、`app.db-wal`、`app.db-shm`
3. 重新启动 Server，自动生成新的 `app.db`

---

## 目录结构参考

```
deploy/
├── DEPLOY.md          # 本文件
├── deploy.py          # 通用部署脚本
├── windows/
│   └── deploy.ps1     # Windows 部署脚本
└── dev/
    ├── data/           # 开发数据目录
    │   └── .gitignore
    └── start-server.sh # 开发启动脚本（参考用）
```
