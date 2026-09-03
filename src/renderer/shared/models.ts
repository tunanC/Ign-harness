/* ═══════════════════════════════════════════════════════════════════
   models.ts — Domain models, config shapes, and API transport types
   ═══════════════════════════════════════════════════════════════════ */

import type { ThemeId, LicenseSource } from './types';

// ── Client Config ──────────────────────────────────────────────────

export interface ServerConfig {
  host: string;
  port: number;
}

export interface ClientSettings {
  server: ServerConfig;
  clientVersion: string;
  theme: ThemeId;
  setupCompleted: boolean;
  loginCompleted: boolean;
  username: string;
  authToken: string;
  password: string;
  rememberPassword: boolean;
  autoLogin: boolean;
  /** 本设备在服务端的唯一名称（登录界面填写，落盘后 WS 重连沿用） */
  deviceName: string;
  /** 本设备 uuid（前端随机生成、不展示；WS 阶段辨识"同名是否同设备"用） */
  deviceUuid: string;
  /** STT 配置（本地保存；API Key 以加密形式存 sttKeyEnc，明文不落盘） */
  sttApiUrl: string;
  sttModel: string;
  sttKeyEnc: string;
}

// ── LLM Config ─────────────────────────────────────────────────────

export interface LLMConfig {
  provider: 'openai_compatible';
  apiUrl: string;
  apiKey: string;
  model: string;
}

/** 语音识别（STT）配置——与文本 LLM 同样的保存方式，存 Server 端 */
export interface SttConfig {
  apiUrl: string;
  apiKey: string;
  model: string;
}

// ── License ────────────────────────────────────────────────────────

export interface LicenseStatus {
  activated: boolean;
  source: LicenseSource;
  trial_days_remaining: number;
  trial_total_days: number;
  machine_code: string;
  licensee?: string;
  expire_date?: string;
  seats_total?: number;
  seats_used?: number;
}

// ── Settings Info (combined response) ──────────────────────────────

export interface SettingsInfo {
  llm: LLMConfig;
  stt: SttConfig;
  license: LicenseStatus;
}

// ── Health Check ───────────────────────────────────────────────────

export interface HealthStatus {
  server: 'ok' | 'error';
  llm: 'ok' | 'unconfigured' | 'error';
  license: 'active' | 'trial' | 'expired' | 'grace';
  version: string;
}

// ── API Response ───────────────────────────────────────────────────

export interface ApiResponse<T> {
  data: T;
  message?: string;
}

export interface ApiError {
  detail: string;
  error_code?: string;
}

// ── LLM Test Result ────────────────────────────────────────────────

export interface LLMTestResult {
  ok: boolean;
  model: string;
  latency_ms: number;
  error?: string;
}
