/* ═══════════════════════════════════════════════════════════════════
   config.ts — Client configuration.

   Settings are persisted via @tauri-apps/plugin-fs to:
     Dev:  $RESOURCE/conf/settings.json  (target/debug/conf/settings.json)
     Prod: $RESOURCE/conf/settings.json  (<bundle_resources>/conf/settings.json)

   BaseDirectory.Resource is the closest cross-platform equivalent to
   Executable (which is Linux-only and returns "unknown path" on Windows).

   Ign Server runs at 127.0.0.1:7017 by default.
   ═══════════════════════════════════════════════════════════════════ */

import type { ClientSettings } from '../shared/models';

const SETTINGS_PATH = 'conf/settings.json';

export const DEFAULT_SETTINGS: ClientSettings = {
  server: { host: '127.0.0.1', port: 7017 },
  clientVersion: '1.0.0',
  theme: 'dark',
  setupCompleted: false,
  loginCompleted: false,
  username: '',
  authToken: '',
  password: '',
  rememberPassword: false,
  autoLogin: false,
  deviceName: '',
  deviceUuid: '',
  sttApiUrl: '',
  sttModel: '',
  sttKeyEnc: '',
};

let cached: ClientSettings = { ...DEFAULT_SETTINGS };

async function getFs() {
  return await import('@tauri-apps/plugin-fs');
}

/** Read settings from the local settings.json. Falls back to defaults. */
export async function readSettings(): Promise<ClientSettings> {
  try {
    const { readTextFile, exists, BaseDirectory } = await getFs();
    const fileExists = await exists(SETTINGS_PATH, { baseDir: BaseDirectory.Resource });
    if (fileExists) {
      const contents = await readTextFile(SETTINGS_PATH, { baseDir: BaseDirectory.Resource });
      const stored = JSON.parse(contents);
      cached = {
        ...DEFAULT_SETTINGS,
        server: stored.server ?? DEFAULT_SETTINGS.server,
        theme: stored.theme ?? DEFAULT_SETTINGS.theme,
        setupCompleted: stored.setupCompleted ?? false,
        loginCompleted: stored.loginCompleted ?? false,
        username: stored.username ?? '',
        authToken: stored.authToken ?? '',
        password: stored.password ?? '',
        rememberPassword: stored.rememberPassword ?? false,
        autoLogin: stored.autoLogin ?? false,
        deviceName: stored.deviceName ?? '',
        deviceUuid: stored.deviceUuid ?? '',
        sttApiUrl: stored.sttApiUrl ?? '',
        sttModel: stored.sttModel ?? '',
        sttKeyEnc: stored.sttKeyEnc ?? '',
      };
    } else {
      cached = { ...DEFAULT_SETTINGS };
    }
  } catch (err) {
    console.error('[config] readSettings failed:', err);
    cached = { ...DEFAULT_SETTINGS };
  }
  return cached;
}

/** Write settings to the local settings.json. */
export async function writeSettings(
  settings: Partial<Pick<ClientSettings,
    'server' | 'theme' | 'setupCompleted' |
    'loginCompleted' | 'username' | 'authToken' | 'password' |
    'rememberPassword' | 'autoLogin' | 'deviceName' | 'deviceUuid' |
    'sttApiUrl' | 'sttModel' | 'sttKeyEnc'
  >>,
): Promise<void> {
  const { writeTextFile, mkdir, BaseDirectory } = await getFs();
  // Ensure the conf directory exists
  try { await mkdir('conf', { baseDir: BaseDirectory.Resource }); } catch (e) { console.error('[config] mkdir failed:', e); }
  const merged = {
    ...cached,
    server: settings.server ?? cached.server,
    theme: settings.theme ?? cached.theme,
    setupCompleted: settings.setupCompleted ?? cached.setupCompleted,
    loginCompleted: settings.loginCompleted ?? cached.loginCompleted,
    username: settings.username ?? cached.username,
    authToken: settings.authToken ?? cached.authToken,
    password: settings.password ?? cached.password,
    rememberPassword: settings.rememberPassword ?? cached.rememberPassword,
    autoLogin: settings.autoLogin ?? cached.autoLogin,
    deviceName: settings.deviceName ?? cached.deviceName,
    deviceUuid: settings.deviceUuid ?? cached.deviceUuid,
    sttApiUrl: settings.sttApiUrl ?? cached.sttApiUrl,
    sttModel: settings.sttModel ?? cached.sttModel,
    sttKeyEnc: settings.sttKeyEnc ?? cached.sttKeyEnc,
  };
  const contents = JSON.stringify(merged, null, 2);
  await writeTextFile(SETTINGS_PATH, contents, { baseDir: BaseDirectory.Resource });
  cached = { ...cached, ...settings };
  console.log('[config] writeSettings OK →', SETTINGS_PATH);
}

/** Synchronous snapshot — returns cached or defaults. Call readSettings() first. */
export function getSettingsSync(): ClientSettings {
  return cached;
}

/** Build the base HTTP URL from settings. */
export function buildBaseUrl(settings?: ClientSettings): string {
  const cfg = settings ?? getSettingsSync();
  return `http://${cfg.server.host}:${cfg.server.port}`;
}

/** Build the base WS URL from settings. */
export function buildWsUrl(settings?: ClientSettings): string {
  const cfg = settings ?? getSettingsSync();
  return `ws://${cfg.server.host}:${cfg.server.port}`;
}
