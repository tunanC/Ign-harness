/* ═══════════════════════════════════════════════════════════════════
   dispatcher.ts — WS 消息分发器。

   协议: Server 每回合一个 JSON:
     { message?, tool_exec?, status?, ui? }

   分发:
     message   → ChatPanel (对话展示)
     tool_exec → invoke('shell_exec') → sendWs('tool_result')
     status    → 左下角状态栏
     ui        → WebviewWindow.create (未来)
   ═══════════════════════════════════════════════════════════════════ */

import { invoke } from '@tauri-apps/api/core';
import { onWs, sendWs, newMsgId } from './ws';

// ── Handler types ──────────────────────────────────────────────────

export type MessageSink = (msg: { role: 'assistant'; content: string }) => void;
export type StatusSink = (text: string | null) => void;

// ── Subscribers ────────────────────────────────────────────────────

const msgSinks = new Set<MessageSink>();
const statusSinks = new Set<StatusSink>();

export function onMessage(fn: MessageSink): () => void {
  msgSinks.add(fn);
  return () => { msgSinks.delete(fn); };
}

export function onStatus(fn: StatusSink): () => void {
  statusSinks.add(fn);
  return () => { statusSinks.delete(fn); };
}

// ── Tool execution helpers ─────────────────────────────────────────

type ToolExec = {
  call_id: string;
  tool?: string;
  params?: Record<string, unknown>;
  type?: string;
  items?: Array<{ tool: string; params: Record<string, unknown> }>;
};

async function executeTool(te: ToolExec, call_id: string) {
  try {
    // 整个 tool_exec 载荷交给 Rust——Rust 解析 type=parallel 自己决定单命令还是并行组。
    // 返回：单命令 {stdout,stderr,exit_code}；并行组 {type:"parallel",count,results:[{tool,params,result}...]}
    const outcome = (await invoke('shell_exec', { payload: te })) as Record<string, unknown>;
    const payload: Record<string, unknown> = { call_id };
    if (te.type === 'parallel') {
      Object.assign(payload, outcome);  // 并行：composite 展开进 payload（type/count/results 与 call_id 平级）
    } else {
      payload.result = outcome;         // 单命令：保持 result 字段
    }
    sendWs({
      msg_id: newMsgId(), type: 'tool_result', target: 'desktop',
      payload,
    });
  } catch (err) {
    sendWs({
      msg_id: newMsgId(), type: 'tool_result', target: 'desktop',
      payload: { call_id, result: { error: String(err) } },
    });
  }
}

// ── Start ──────────────────────────────────────────────────────────

let _started = false;

export function startDispatcher(): void {
  if (_started) return;
  _started = true;

  // Server push — one JSON per turn: { message?, tool_exec?, status?, ui? }
  onWs('push', (msg) => {
    const p = msg.payload as {
      message?: string;
      tool_exec?: {
        call_id: string;
        tool: string;
        params: Record<string, unknown>;
        type?: string;
        items?: Array<{ tool: string; params: Record<string, unknown> }>;
      };
      status?: string;
      ui?: Record<string, unknown>;
    };

    // message → ChatPanel
    if (p.message) {
      msgSinks.forEach((fn) => fn({ role: 'assistant', content: p.message }));
    }

    // status → status bar
    if (p.status !== undefined) {
      statusSinks.forEach((fn) => fn(p.status! || null));
    }

    // tool_exec → shell_exec：整个载荷给 Rust，由 Rust 判断单/并行 (fire-and-forget, result back via tool_result WS)
    if (p.tool_exec) {
      void executeTool(p.tool_exec, p.tool_exec.call_id);
    }

    // ui → future
    if (p.ui) {
      // TODO: WebviewWindow.create
    }
  });
}
