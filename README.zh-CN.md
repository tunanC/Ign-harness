# Ign

简体中文 | [English](./README.md)

跨设备个人 AI 助手（**demo**）。

一句话：一个 Server 当大脑，PC、眼镜、手机当手脚。在任意一台设备上说一句话，Server 负责规划，把工具分发到对应设备执行，结果回传汇总。

> ⚠️ 当前是 demo，不是产品。安全模块完全没有，执行追溯（trace）没有，记忆系统没有。请先读[当前没有的](#当前没有的诚实清单)。

> 📌 本仓库是 **Ign** 官方开源演示代码。正式版发布时使用独立产品名，本仓库名仅为开源演示代号。正式版通过官网发布：**（暂无）**。本仓库不承诺与正式版同步更新，请以官网正式版发布为准。

## 能跑什么

- 自然语言对话（纯聊天，也支持多轮上下文）
- **规划-执行（PE）引擎**：LLM 把任务拆成计划，逐项调用能力，汇总结果
- **跨设备路由**：工具不在 Server 上执行，按设备类型分发到对应客户端（如眼镜、PC），结果回传
- **声明式能力协议**：加一个文件夹 = 加一个能力（见下文）
- 眼镜模拟器（`glasses/simulator`，浏览器打开，含登录）
- 语音识别中继（Server 中转 STT provider，双向转发）

## 架构

```
PC / 眼镜 / 手机（客户端）
        │  HTTP + WebSocket
        ▼
   Ign Server（Python FastAPI + SQLite）
        │
        ├─ PE 引擎（规划 → 调用能力 → 汇总）
        ├─ 能力加载器（扫描 capabilities/ 目录）
        └─ 客户端管理（在线设备注册、按设备路由）
```

前端（React + Tauri）只负责界面和连接，不直接读写文件——所有数据都走 Server。

## 快速开始

前置：Python 3.12+、Node 20+、pnpm。

**1. 启动 Server**（仓库根目录）：

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r backend/requirements.txt
./deploy/dev/start-server.sh          # 监听 127.0.0.1:7017
```

首次启动数据库为空、无预设账号：Client 登录时输入的用户名和密码会自动注册为第一个管理员账号。

**2. 启动桌面客户端**（仓库根目录）：

```powershell
pnpm install
pnpm tauri dev
```

**3. 配置 LLM**：在设置窗口里填 API 地址和密钥，然后就可以对话。

**眼镜模拟器**：浏览器直接打开 `glasses/simulator/index.html`，想拿智能眼镜接入试玩的，可以直接参考这个脚手架自己补充眼镜客户端，登录后和桌面端一起在线，会出现在设备列表里。

## 能力协议（声明式）

能力就是 `capabilities/` 目录下的文件夹，共五类：`tool` / `hook` / `skill` / `agent` / `app`，按 OS 分层（`core/server/{windows,linux,darwin}` 内置，`extends/` 扩展）。

```
capabilities/core/server/windows/tools/read_file/tool.py
```

一个工具 = 一个文件夹 + 一个 `run(params)` 函数。示例（节选，完整见 `capabilities/core/server/windows/tools/read_file/tool.py`）：

```python
async def run(params: dict) -> dict:
    """读文件。params: {"path": str, "encoding"?: str, "lines"?: int}"""
    path: str = params["path"]
    ...
    return {"content": content, "path": path, "size": size, "truncated": truncated}
```

Server 启动时扫描 `capabilities/` 生成能力清单，LLM 按清单规划并调用。**加一个文件夹，重启 Server 即生效，暂不支持动态扫描。**

（hook 已实现加载，但还没有接入执行链，见诚实清单。）

## 目录结构

```
backend/          # Python 后端（FastAPI + SQLite + PE 引擎）
capabilities/     # 能力目录（tool/hook/skill/agent/app，按 OS 分层）
src/              # React 前端（对话、设置、眼镜 Orb）
src-tauri/        # Tauri 壳（窗口、托盘）
glasses/          # 眼镜模拟器
deploy/           # 部署脚本
```

## 当前没有的（诚实清单）

- **PE 引擎**：完整的PE引擎专利暂时没在项目中体现，目前的pe是通用写法
- **安全模块**：demo没有沙箱，没有权限控制。服务端工具直接在你机器上执行，`write_file` 能写任何路径
- **执行追溯（trace）**：没有。跑了什么、为什么跑，无账可查
- **记忆系统**：跨会话记不住东西，也记不住你是谁
- **上下文压缩**：临时上下文暂时没有做压缩，请技术爱好者们悉知，保护好自己的token用量(^_<)
- **审批/权限**：高危动作没有二次确认，可以使用hook做，已留预埋点，只需要在各能力的md文件中标注需要的hook，并实现对应hook代码即可
- 生产稳定性：没做过压力测试，没经过任何安全评审，请在局域网内玩，后续正式版本会有安全相关的模块

**不要把它暴露到公网。** 它默认监听 127.0.0.1，如果改成 0.0.0.0 对外，请先自己补上安全层。

## Roadmap

- 精确场景下的并发安全（至多执行一次）
- 跨设备记忆
- 执行追溯（trace）
- 安全沙箱 + 权限体系

## License

本仓库以 **Ign Noncommercial License 1.0**（基于 PolyForm Noncommercial License 1.0.0 修改）授权：

- **非商业使用免费**：个人研究、实验、学习、私人娱乐、业余项目，以及公益、教育（不论公办民办）、公共安全卫生、环保等机构的使用，都在免费许可范围内
- **政府、科研机构、国央企零授权**：任何级别的政府机关、部门、机构，科研机构，以及国有企业（含央企、地方国企），均不获得本许可证的任何授权，必须购买官方企业版——公立高校与公办公益机构不受此限制
- **商业使用禁止**：任何商业机构、任何商业目的的使用均不在本许可证范围内，必须另行获得商业授权
- **无期限转换机制**：本版本永久适用本许可证

完整条款见仓库内 `LICENSE` 文件。

注意：本许可证附带的专利授权仅覆盖其许可范围内的使用（即非商业使用）；商业使用需另行获得授权。本项目部分机制已申请专利，商业授权协议可包含相应的专利安排。

## FAQ

- **为什么 Server 和 Client 分离？** 因为设备（眼镜/手机/车机）算力有限，统一由一个 Server 思考，设备只负责执行和交互。
- **为什么工具写在 Server ？** 能力在 Server 上执行（读写文件、调 API），有些必须在设备上执行（眼镜拍照、PC 上的应用操作）会通过协议的tool_exec,action字段进行传输，协议统一、位置不同，tool_exec,action由llm控制，可推送任何你能推送的东西。