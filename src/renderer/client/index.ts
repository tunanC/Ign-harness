/* ═══════════════════════════════════════════════════════════════════
   client/index.ts — Communication layer barrel export
   ═══════════════════════════════════════════════════════════════════ */

export { readSettings, buildBaseUrl, buildWsUrl, getSettingsSync } from './config';
export { apiGet, apiPost, ApiError } from './http';
export { connectWs, disconnectWs, sendWs, onWs, onConnect, onDisconnect, newMsgId, isConnected } from './ws';
export { startDispatcher, onMessage, onStatus } from './dispatcher';
