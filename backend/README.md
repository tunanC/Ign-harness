# Ign Server

私人智能助手后端服务。

## 快速开始（开发）

```powershell
# 首次：创建虚拟环境并安装依赖（在项目根目录执行）
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r backend/requirements.txt

# 之后每次启动：

```

Server 监听 `127.0.0.1:7017`，数据文件在 `deploy/dev/data/app.db`。

自定义端口：`python server.py --port 8080`
绑定所有网卡：`python server.py --host 0.0.0.0`

## 首次启动

Server 启动后数据库为空，无预设账号。首次通过 Client 连接时，用户输入的用户名和密码会自动注册为管理员账号。

（后续可通过 Client 设置页修改用户名和密码）

## API 概览

| 端点 | 说明 |
|------|------|
| `GET /health` | 健康检查 |
| `POST /Ign/v1/auth/login` | 登录，返回 JWT access_token |
| `POST /Ign/v1/auth/account` | 修改用户名/密码（需认证） |
| `GET /Ign/v1/settings/info` | 获取 LLM 配置 + License 状态 |
| `POST /Ign/v1/settings` | 保存设置 |
| `POST /Ign/v1/settings/test-llm` | 测试 LLM 连接 |
| `GET /Ign/v1/license/status` | License 状态 |
| `POST /Ign/v1/license/activate` | 激活 License（一期 mock） |
| `WS /Ign/v1/ws` | WebSocket（需 Header `X-Client-Type`） |

## 项目结构

```
backend/
├── server.py           # CLI 入口
├── app.py              # FastAPI 工厂
├── database.py          # SQLite + 认证
├── middleware/auth.py   # JWT 验证
├── routers/            # REST 路由
├── core/               # 核心模块（PE Engine、SessionManager 等）
└── data/               # SQLite 数据文件（自动生成）
```
