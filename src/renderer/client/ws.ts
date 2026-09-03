/* ═══════════════════════════════════════════════════════════════════
   ws.ts — WebSocket client for Ign Server.

   Wire format: { msg_id, type, target, payload }

   Device identity passed via query params (WebView WS API can't set
   custom headers on the upgrade handshake).

   连接逻辑:
     connectWs → 清理旧连接 → 建新连接 → onopen 启心跳
     心跳: 每30s发ping → 设60s倒计时 → 收到pong刷新倒计时
     超时: 60s无pong → close(3001) → onclose → scheduleReconnect
     重连: 指数退避 1s/2s/4s/8s/16s/30s... 无上限
   ═══════════════════════════════════════════════════════════════════ */

import { buildWsUrl, getSettingsSync } from './config';

// ── Envelope ──────────────────────────────────────────────────────

export interface WsEnvelope {
  msg_id: string;
  type: string;
  target: string;
  payload: Record<string, unknown>;
}

export type MessageHandler = (msg: WsEnvelope) => void;

// ── Config ────────────────────────────────────────────────────────

const HEARTBEAT_INTERVAL = 30_000;   // ping interval
const HEARTBEAT_TIMEOUT  = 60_000;   // pong timeout (close if exceeded)
const RECONNECT_BASE     = 1_000;    // first reconnect delay
const RECONNECT_CAP      = 30_000;   // max reconnect delay

// ── Device identity ───────────────────────────────────────────────

/** 设备 uuid：登录时随机生成并落盘 settings.json，连接时直接读取。
    兜底随机生成（正常流程到不了这里——登录成功必然已落盘）。 */
function deviceUUID(): string {
  try {
    const uuid = getSettingsSync().deviceUuid?.trim();
    if (uuid) return uuid;
  } catch { /* fall through */ }
  return crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function deviceOS(): string {
  const p = navigator.platform?.toLowerCase() || '';
  if (p.includes('win')) return 'windows';
  if (p.includes('mac')) return 'darwin';
  if (p.includes('linux')) return 'linux';
  return 'unknown';
}

/** 设备名：优先 settings.json 落盘值（登录界面填写，重连沿用）；
    无则用随机 uuid 兜底（保证唯一，促使用户去登录界面改）。 */
function deviceName(): string {
  try {
    const name = getSettingsSync().deviceName?.trim();
    if (name) return name;
  } catch { /* fall through */ }
  return `device-${(crypto.randomUUID?.() ?? Date.now().toString(36)).slice(0, 8)}`;
}

// ── State ─────────────────────────────────────────────────────────

let ws: WebSocket | null = null;
let retries = 0;
let hbTimer: ReturnType<typeof setInterval> | null = null;
let hbTimeout: ReturnType<typeof setTimeout> | null = null;
const handlers = new Map<string, Set<MessageHandler>>();
let onConnectCb: (() => void) | null = null;
let onDisconnectCb: (() => void) | null = null;

// ── Public API ────────────────────────────────────────────────────

export function connectWs(): void {
  // 1. 清理旧连接，确保全局只有一个 WebSocket
  teardown();

  // 2. 建新连接
  const url = `${buildWsUrl()}/Ign/v1/ws`
    + `?client_type=desktop`
    + `&client_os=${deviceOS()}`
    + `&device_uuid=${deviceUUID()}`
    + `&device_name=${encodeURIComponent(deviceName())}`;

  console.log(`[ws] connecting (attempt ${retries + 1})`);
  try {
    ws = new WebSocket(url);
  } catch (err) {
    console.error('[ws] new WebSocket failed:', err);
    scheduleReconnect();
    return;
  }

  ws.onopen = () => {
    console.log('[ws] connected');
    retries = 0;
    startHeartbeat();
    onConnectCb?.();
  };

  ws.onmessage = (e) => {
    try {
      const msg: WsEnvelope = JSON.parse(e.data as string);
      if (msg.type === 'pong') {
        refreshHbTimeout();  // 收到 pong → 刷新倒计时
        return;
      }
      handlers.get(msg.type)?.forEach((fn) => fn(msg));
      handlers.get('*')?.forEach((fn) => fn(msg));
    } catch { /* ignore malformed */ }
  };

  ws.onclose = (e) => {
    console.log(`[ws] closed code=${e.code} wasClean=${e.wasClean}`);
    stopHeartbeat();
    onDisconnectCb?.();
    ws = null;
    // 4001 = 设备名被其他在线设备占用——重连必被再拒，不重试，等用户改名后重启连接
    if (e.code !== 1000 && e.code !== 4001) scheduleReconnect();
  };

  ws.onerror = () => {
    // onclose will fire after this, handle there
  };
}

export function sendWs(msg: WsEnvelope): void {
  if (ws?.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(msg));
  }
}

export function onWs(type: string, fn: MessageHandler): () => void {
  if (!handlers.has(type)) handlers.set(type, new Set());
  handlers.get(type)!.add(fn);
  return () => handlers.get(type)?.delete(fn);
}

export function isConnected(): boolean {
  return ws?.readyState === WebSocket.OPEN;
}

export function onConnect(fn: () => void) { onConnectCb = fn; }
export function onDisconnect(fn: () => void) { onDisconnectCb = fn; }

export function disconnectWs(): void {
  teardown();
  ws?.close(1000);
  ws = null;
}

// ── Helpers ───────────────────────────────────────────────────────

export function newMsgId(): string {
  return (crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36)}`)
    .replace(/-/g, '').slice(0, 12);
}

/** 彻底清理旧连接：停心跳 + 切断回调 + 关 socket */
function teardown(): void {
  stopHeartbeat();
  if (ws) {
    ws.onclose = null;   // 阻止旧 onclose 触发 scheduleReconnect
    ws.onerror = null;
    ws.onopen = null;
    ws.onmessage = null;
    // 只关 OPEN 状态的连接，CONNECTING 的直接丢弃（强行 close 会触发 1006）
    if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CLOSING) {
      ws.close(1000);
    }
    ws = null;
  }
}

// ── Heartbeat ─────────────────────────────────────────────────────

function startHeartbeat(): void {
  stopHeartbeat();  // 防僵尸定时器
  hbTimer = setInterval(() => {
    sendWs({ msg_id: newMsgId(), type: 'ping', target: 'desktop', payload: {} });
  }, HEARTBEAT_INTERVAL);
  refreshHbTimeout();  // 启动第一轮倒计时
}

function stopHeartbeat(): void {
  if (hbTimer) { clearInterval(hbTimer); hbTimer = null; }
  if (hbTimeout) { clearTimeout(hbTimeout); hbTimeout = null; }
}

/** 重置心跳超时倒计时：每次收到 pong 或发 ping 后调用 */
function refreshHbTimeout(): void {
  if (hbTimeout) clearTimeout(hbTimeout);
  hbTimeout = setTimeout(() => {
    console.warn('[ws] heartbeat timeout, closing');
    ws?.close(3001);
  }, HEARTBEAT_TIMEOUT);
}

// ── Reconnect ─────────────────────────────────────────────────────

function scheduleReconnect(): void {
  // 指数退避: 1s → 2s → 4s → 8s → 16s → 30s → 30s... (无上限)
  const delay = Math.min(RECONNECT_BASE * Math.pow(2, retries), RECONNECT_CAP);
  console.log(`[ws] reconnect #${retries + 1} in ${delay}ms`);
  retries++;
  setTimeout(connectWs, delay);
}
