# Ign

**Cross-device personal AI — one brain on your Server, every device is its body.**

[简体中文](./README.zh-CN.md) | English

In one sentence: a single Server is the brain; your PC, glasses, phone, robots, and more are the hands and feet. Say a word on any device — the Server plans, dispatches tools to the right device for execution, and aggregates the results back.

- **Chat** in plain language, with multi-turn context
- **Plan-Execute (PE) engine** — the LLM plans a task, invokes capabilities one by one, aggregates results
- **Cross-device routing** — tools run on the device that fits them (glasses, PC, robots, …), not on the Server
- **Declarative capabilities** — add a folder = add a capability

Full feature list: [What it can do](#what-it-can-do)

> This repository is the official open-source demo code of Ign. The official release will be published through the official site under an independent product name; this repository name is only a demo codename, and this repository is not promised to stay in sync with the official release.

Today's AIs are trapped inside products. The AI in your chat app doesn't know the code you wrote; the AI in your editor doesn't know your schedule — they don't even know each other, and none of them knows all of you. Meanwhile, the devices around you keep multiplying: phone, watch, glasses, car, robots. The road of "stuffing an AI into every device" is doomed.

Ign answers with one sentence: take the AI out of the products, and put it into your own Server. **There is only one AI — it lives at your hub; all your devices are its body.**

> ⚠️ This is a demo, not a product. There is no security module, no execution trace, and no memory system. Please read the [honest list of what is missing](#whats-missing-the-honest-list) first.

> ⚠️ The code is currently in a rough state and exists purely to verify feasibility — it is a feasibility prototype, not production-quality.

## What it can do

- Natural-language chat (plain chat, with multi-turn context)
- **Plan-Execute (PE) engine**: the LLM breaks a task into a plan, invokes capabilities one by one, and aggregates the results
- **Cross-device routing**: tools do not execute on the Server — they are dispatched to the right client by device type (glasses, PC, robots, ...) and the results are sent back
- **Declarative capability protocol**: add a folder = add a capability (see below)
- Glasses simulator (`glasses/simulator` — open in a browser, login included)
- Speech recognition relay (the Server relays to an STT provider, bidirectional forwarding)

## Why it's designed this way

1. **Sessions follow you, not the device.** Conversation, context, and ongoing work all live on the Server — never inside a device. Glasses die mid-task? The session doesn't. Come back on another device and pick up where you left off.
2. **A folder is a capability.** No SDK integration to write — capabilities are declarative (a folder + an md + an entry function), and the LLM plans directly against the manifest scanned at startup. Add a folder and restart: one new capability. One day, one folder will be one distributable app.
3. **One protocol, both ends.** The same protocol reads files on the Server, snaps photos on the glasses, drives apps on the PC, and commands robots. The LLM never needs to care where a tool actually runs.
4. **The frontend touches no files.** The UI is a pure renderer — it reads nothing and writes nothing; all data flows through your Server. This is not a shortcut, it's a stance: the AI is the hub, not a plugin inside some app.

## Architecture

```
PC / Glasses / Phone / Robots /... (clients)
        │  HTTP + WebSocket
        ▼
   Ign Server (Python FastAPI + SQLite)
        │
        ├─ PE engine (plan → invoke capability → aggregate)
        ├─ Capability loader (scans the capabilities/ directory)
        └─ Client manager (online device registry, per-device routing)
```

The frontend (React + Tauri) only renders the UI and maintains the connection — it never reads or writes files directly; all data goes through the Server.

## Quick start

Prerequisites: Python 3.12+, Node 20+, pnpm.

**1. Start the Server** (repo root):

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r backend/requirements.txt
./deploy/dev/start-server.sh          # listens on 127.0.0.1:7017
```

On first launch the database is empty with no preset accounts: the username and password entered when a Client logs in are automatically registered as the first admin account.

**2. Start the desktop client** (repo root):

> ⚠️ The desktop client currently supports **Windows** only; macOS is not adapted yet.

```powershell
pnpm install
pnpm tauri dev
```

**3. Configure the LLM**: fill in the API URL and key in the settings window, then start chatting.

**Glasses simulator**: open `glasses/simulator/index.html` directly in a browser. If you want to try connecting smart glasses, you can use this scaffold as a reference to build your own glasses client — after login it goes online alongside the desktop client and appears in the device list.

## Capability protocol (declarative)

A capability is a folder under `capabilities/`, in five categories: `tool` / `hook` / `skill` / `agent` / `app`, layered by OS (`core/server/{windows,linux,darwin}` built-in, `extends/` for extensions).

```
capabilities/core/server/windows/tools/read_file/tool.py
```

A tool = a folder + a `run(params)` function. Example (excerpt — see `capabilities/core/server/windows/tools/read_file/tool.py` for the full file):

```python
async def run(params: dict) -> dict:
    """Read a file. params: {"path": str, "encoding"?: str, "lines"?: int}"""
    path: str = params["path"]
    ...
    return {"content": content, "path": path, "size": size, "truncated": truncated}
```

On startup the Server scans `capabilities/` to build the capability manifest, and the LLM plans and invokes against that manifest. **Add a folder, restart the Server, and it takes effect — dynamic scanning is not supported yet.**

(`hook` is loaded but not yet wired into the execution chain — see the honest list.)

## Directory structure

```
backend/          # Python backend (FastAPI + SQLite + PE engine)
capabilities/     # Capability directory (tool/hook/skill/agent/app, layered by OS)
src/              # React frontend (chat, settings, glasses Orb)
src-tauri/        # Tauri shell (window, tray)
glasses/          # Glasses simulator
deploy/           # Deployment scripts
```

## Where this is going

**This section is vision, not the current state — for what exists today, see the honest list right below.**

What Ign proves today is small: one sentence, and your devices work together on a task. But the problem it points at is much bigger:

- **An AI that knows you** — cross-device memory: whichever device you pick up, it remembers who you are and what you've said. A companion for life, not a Q&A box
- **Said once, done exactly once** — concurrency safety down to "execute at most once": a task you entrust is never executed twice
- **AI talking to AI** — Servers recognize and connect to one another; your AI delegates tasks to someone else's AI, the way people ask friends for help
- **Every new device is a new organ** — glasses, in-car systems, tomorrow's robots: plug into the hub, become part of the same AI

## What's missing (the honest list)

- **PE engine**: the full patented PE engine is not yet reflected in this project — the current PE is a generic implementation
- **Security module**: the demo has no sandbox and no permission control. Server-side tools execute directly on your machine — `write_file` can write to any path
- **Execution trace**: none. There is no record of what ran and why
- **Memory system**: nothing persists across sessions; it will not remember you
- **Context compression**: temporary context is not compressed yet. Tech enthusiasts, please be aware — protect your token usage (^_<)
- **Approval/permissions**: no second confirmation for high-risk actions. Hooks are the intended mechanism and the wiring is pre-reserved — just annotate the required hooks in each capability's md file and implement the corresponding hook code
- Production stability: no stress testing, no security review. Please use it on your LAN, or add security-related modules yourself

**Do not expose it to the public internet.** It listens on 127.0.0.1 by default. If you bind it to 0.0.0.0, add a security layer yourself first.

## Roadmap

- Concurrency safety for precise scenarios (execute at most once)
- Cross-device memory
- Execution trace
- Security sandbox + permission system

These four are the first footprints toward the official release (v1), which will be published through the official site under an independent product name.

## License

This repository is licensed under the **Ign Noncommercial License 1.0** (a modified version of the PolyForm Noncommercial License 1.0.0):

- **Free for noncommercial use**: personal research, experimentation, learning, private entertainment, hobby projects, and use by charitable, educational (public or private), public safety & health, and environmental organizations are all within the free license scope
- **No license for government, research institutions, and SOEs**: government bodies, agencies, departments, and institutions at any level, research organizations, and state-owned enterprises (including central and local SOEs) are granted no license of any kind under this license. Public universities and public charitable institutions are not subject to this restriction
- **Commercial use prohibited**: use by any commercial entity or for any commercial purpose is outside the scope of this license and requires a separate commercial license
- **No conversion mechanism**: this version is permanently subject to this license

See the `LICENSE` file in the repository for the full terms.

Note: the patent license attached to this license only covers uses within its permitted scope (i.e., noncommercial use); commercial use requires separate authorization. Some mechanisms of this project are patent-pending; commercial license agreements may include corresponding patent arrangements.

## FAQ

- **Why are Server and Client separate?** Because devices (glasses/phone/in-car systems/robots/...) have limited compute. A single Server does the thinking; devices only execute and interact.
- **Why do tools live on the Server?** Capabilities execute on the Server (reading/writing files, calling APIs). Those that must run on a device (camera on glasses, app control on the PC) are transmitted through the protocol's `tool_exec`, `action` fields — one protocol, different locations. `tool_exec`, `action` are controlled by the LLM and can push anything you can push.
