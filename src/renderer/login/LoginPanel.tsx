import { useState, useEffect, useCallback } from 'react';
import { TechPanel, FormField, FormInput, FormRow, Checkbox } from '../framework';
import { getSettingsSync, readSettings, writeSettings } from '../client/config';
import { apiGet, apiPost } from '../client/http';
import { encryptPassword, decryptPassword } from '../client/crypto';
import '../panels/SettingsPanel.css';

/* ═══════════════════════════════════════════════════════════════════
   LoginPanel — Login form shown in the login window.
   Sections: Server Connection, Credentials, Remember / Auto Login
   ═══════════════════════════════════════════════════════════════════ */

export interface LoginPanelProps {
  onLoginSuccess: (host: string, port: string, username: string, password: string, authToken: string, assistantName: string) => void;
}

export function LoginPanel({ onLoginSuccess }: LoginPanelProps) {
  // ── Server connection ──────────────────────────────────────────
  const [serverHost, setServerHost] = useState('127.0.0.1');
  const [serverPort, setServerPort] = useState('7017');

  // ── Credentials ────────────────────────────────────────────────
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');

  // ── Device identity ────────────────────────────────────────────
  // 本设备在服务端的唯一名称：已落盘的沿用；首次启动生成随机默认名（促使用户改名）
  const [deviceName, setDeviceName] = useState('');

  // ── Login options ──────────────────────────────────────────────
  const [rememberPassword, setRememberPassword] = useState(false);
  const [autoLogin, setAutoLogin] = useState(false);

  // ── State ──────────────────────────────────────────────────────
  const [serverTesting, setServerTesting] = useState(false);
  const [serverResult, setServerResult] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  // ── Init: load saved settings ──────────────────────────────────
  useEffect(() => {
    void init();
  }, []);

  async function init() {
    try {
      const cfg = await readSettings();
      setServerHost(cfg.server.host);
      setServerPort(String(cfg.server.port));
      if (cfg.username) setUsername(cfg.username);

      // Device name: 已落盘的沿用；首次启动生成随机默认名（难看，促使用户改名）
      setDeviceName(
        cfg.deviceName
        || `device-${(crypto.randomUUID?.() ?? Date.now().toString(36)).slice(0, 8)}`,
      );

      // Decrypt stored password if present
      let plaintextPass = '';
      if (cfg.rememberPassword && cfg.password) {
        try {
          plaintextPass = await decryptPassword(cfg.password);
          setPassword(plaintextPass);
        } catch {
          // Corrupted or legacy plaintext — clear it
          setPassword('');
        }
      }

      setRememberPassword(cfg.rememberPassword);
      setAutoLogin(cfg.autoLogin);
      setReady(true);

      // If auto-login is enabled and we have credentials, auto-connect
      if (cfg.autoLogin && cfg.username && plaintextPass) {
        handleConnect(cfg, plaintextPass);
      }
    } catch (err) {
      console.error('[LoginPanel] init error:', err);
      setReady(true);
    }
  }

  // ── Test Connection — simple HTTP reachability check, no API endpoint called ──
  const handleTestConnection = useCallback(async () => {
    setServerTesting(true);
    setServerResult(null);
    setError(null);
    const base = `http://${serverHost}:${serverPort}`;
    try {
      // Abort after 5 seconds — a reachable server will respond quickly
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 5000);
      await fetch(base, { method: 'HEAD', signal: ctrl.signal });
      clearTimeout(timer);
      setServerResult('✓ Server reachable');
    } catch (err: any) {
      const msg = err?.name === 'AbortError' ? 'Connection timed out' : (err?.message ?? String(err));
      setServerResult(`✗ ${msg}`);
    } finally {
      setServerTesting(false);
    }
  }, [serverHost, serverPort]);

  // ── Connect ────────────────────────────────────────────────────
  // plaintextPass: override password from cfg (which is encrypted) during auto-login
  async function handleConnect(cfg?: ReturnType<typeof getSettingsSync>, plaintextPass?: string) {
    setConnecting(true);
    setError(null);

    const host = cfg ? cfg.server.host : serverHost;
    const port = cfg ? String(cfg.server.port) : serverPort;
    const user = cfg ? cfg.username : username;
    const pass = plaintextPass ?? (cfg ? cfg.password : password);
    // cfg means auto-login — use config values since React state hasn't updated yet
    const remPass = cfg ? cfg.rememberPassword : rememberPassword;
    const autoLog = cfg ? cfg.autoLogin : autoLogin;
    const device = (cfg ? cfg.deviceName : deviceName).trim();
    // 设备 uuid：已落盘的沿用，否则随机生成（不展示，登录成功后与 name 一起落盘）
    const deviceUuid = getSettingsSync().deviceUuid
      || (crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`);

    // Validate
    if (!host || !port) {
      setError('Please enter server host and port.');
      setConnecting(false);
      return;
    }
    if (!user || !pass) {
      setError('Please enter username and password.');
      setConnecting(false);
      return;
    }
    if (!device) {
      setError('Please name this device.');
      setConnecting(false);
      return;
    }

    // ── Step 1: persist config first so apiPost reads correct host/port ──
    await writeSettings({
      server: { host, port: Number(port) },
      username: user,
      password: remPass ? await encryptPassword(pass) : '',
      authToken: '',           // no token yet
      loginCompleted: false,
      rememberPassword: remPass,
      autoLogin: autoLog,
      setupCompleted: true,
      deviceName: device,
      deviceUuid,
    });

    // ── Step 1.5: check device name availability (before login) ──
    try {
      // 带上本机 uuid：自己旧连接（应用强杀后 60s 超时窗口内重启）占用的名字放行
      const check = await apiGet<{ available: boolean }>(
        `/devices/check-name?name=${encodeURIComponent(device)}&exclude_uuid=${encodeURIComponent(deviceUuid)}`,
      );
      if (!check.available) {
        setError(`Device name "${device}" is already in use by another online device. Please choose a different name.`);
        setConnecting(false);
        return;
      }
    } catch { /* server unreachable — the login API below will surface the error */ }

    // ── Step 2: call login API (reads baseUrl from cache, no override) ──
    let authToken = '';
    try {
      const result = await apiPost<{ access_token: string; username: string }>(
        '/auth/login',
        { username: user, password: pass },
      );
      authToken = result.access_token;
      console.log('[LoginPanel] auth OK → user:', result.username);
    } catch (err: any) {
      setError(err?.message ?? 'Authentication failed');
      setConnecting(false);
      return;
    }

    // ── Step 3: save the token ──────────────────────────────────────
    await writeSettings({
      authToken,
      loginCompleted: true,
    });

    // ── Step 4: fetch assistant name ────────────────────────────────
    let assistantName = '小助手';
    try {
      const info = await apiGet<{ name: string }>('/settings/assistant');
      assistantName = info.name || '小助手';
    } catch { /* use default */ }

    onLoginSuccess(host, port, user, pass, authToken, assistantName);
  }

  // ── Render ──────────────────────────────────────────────────────
  if (!ready) return null;

  const canConnect = serverHost.trim() && serverPort.trim() && username.trim() && password.trim() && deviceName.trim();

  return (
    <div className="settings-page">
      <div className="settings-container">

        {/* Header */}
        <div className="settings-header">
          <h1>Ign</h1>
          <p>Connect to your server</p>
        </div>

        {/* Server Connection */}
        <TechPanel title="Server Connection" variant="card" glow accent="pink">
          <FormRow>
            <div style={{ flex: 3 }}>
              <FormField label="Host">
                <FormInput type="text" value={serverHost}
                  onChange={e => { setServerHost(e.target.value); setServerResult(null); }}
                  placeholder="127.0.0.1" />
              </FormField>
            </div>
            <div style={{ flex: 1 }}>
              <FormField label="Port">
                <FormInput type="text" value={serverPort}
                  onChange={e => { setServerPort(e.target.value); setServerResult(null); }}
                  placeholder="7017" />
              </FormField>
            </div>
          </FormRow>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 10 }}>
            <button className="btn btn--sm" onClick={handleTestConnection} disabled={serverTesting || !serverHost.trim() || !serverPort.trim()}>
              {serverTesting ? 'Testing...' : 'Test Connection'}
            </button>
            {serverResult && (
              <span style={{
                fontSize: 'var(--font-size-xs)',
                fontFamily: 'var(--font-mono)',
                color: serverResult.startsWith('✓') ? 'var(--success)' : 'var(--danger)',
              }}>{serverResult}</span>
            )}
          </div>
        </TechPanel>

        {/* Device identity — 本设备在服务端的唯一名称 */}
        <TechPanel title="This Device" variant="card" glow accent="green">
          <FormField label="Device name">
            <FormInput type="text" value={deviceName}
              onChange={e => setDeviceName(e.target.value)}
              placeholder="e.g. 客厅电脑"
              autoComplete="off"
            />
            <div style={{
              fontSize: 'var(--font-size-xs)',
              fontFamily: 'var(--font-mono)',
              color: 'var(--text-muted)',
              marginTop: 4,
            }}>设备名不能重复——与其他在线设备同名将无法连接</div>
          </FormField>
        </TechPanel>

        {/* Credentials */}
        <TechPanel title="Credentials" variant="card" glow accent="cyan">
          <FormField label="Username">
            <FormInput type="text" value={username}
              onChange={e => setUsername(e.target.value)}
              placeholder="Enter username"
              autoComplete="username" />
          </FormField>
          <FormField label="Password" last>
            <FormInput type="password" value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder="Enter password"
              autoComplete="current-password"
            />
          </FormField>
        </TechPanel>

        {/* Login Options */}
        <TechPanel title="Options" variant="card" glow accent="purple">
          <Checkbox
            checked={rememberPassword}
            onChange={(v: boolean) => { setRememberPassword(v); if (!v) setAutoLogin(false); }}
            label="Remember password"
          />
          <Checkbox
            checked={autoLogin}
            onChange={setAutoLogin}
            disabled={!rememberPassword}
            label="Auto login on startup"
          />
        </TechPanel>

        {/* Error banner */}
        {error && (
          <div className="error-banner" style={{
            marginBottom: 16, padding: '10px 16px',
            border: '1px solid var(--danger)',
            borderRadius: 'var(--radius-md)',
            color: 'var(--danger)',
            fontSize: 'var(--font-size-sm)',
            fontFamily: 'var(--font-mono)',
            background: 'rgba(255, 77, 106, 0.08)',
          }}>{error}</div>
        )}

        {/* Footer */}
        <div className="settings-footer">
          <button
            className="btn btn--primary"
            onClick={() => handleConnect()}
            disabled={connecting || !canConnect}
            style={{ width: '100%' }}
          >
            {connecting ? 'Connecting...' : 'Connect'}
          </button>
        </div>

      </div>
    </div>
  );
}
