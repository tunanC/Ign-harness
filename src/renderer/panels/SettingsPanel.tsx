import { useState, useEffect, useCallback } from 'react';
import { TechPanel, HintIcon, Select, FormField, FormInput, FormRow, Checkbox, ToggleGroup } from '../framework';
import { apiGet, apiPost, ApiError } from '../client/http';
import { readSettings, writeSettings } from '../client/config';
import { encryptPassword, decryptPassword } from '../client/crypto';
import { DEFAULT_THEME, THEME_OPTIONS, type ThemeId, type LicenseSource } from '../shared/types';
import type { SettingsInfo, LicenseStatus, LLMTestResult } from '../shared/models';
import './SettingsPanel.css';

/* ═══════════════════════════════════════════════════════════════════
   SettingsPanel — 3-tab settings page opened from Main window.

   Tab 1 — Credentials:        username, password (masked, modifiable)
   Tab 2 — Basic Config:       LLM, License, Assistant, Theme, Voice
   Tab 3 — Login Settings:     Auto login, Remember password toggles
   ═══════════════════════════════════════════════════════════════════ */

type TabId = 'connection' | 'basic' | 'login';

const TABS: { id: TabId; label: string }[] = [
  { id: 'connection', label: 'Account' },
  { id: 'basic', label: 'Basic' },
  { id: 'login', label: 'Login' },
];

export function SettingsPanel() {
  // ── Tab state ──────────────────────────────────────────────────
  const [activeTab, setActiveTab] = useState<TabId>('connection');

  // ── Connection fields ──────────────────────────────────────────
  const [username, setUsername] = useState('');
  const [storedPassword, setStoredPassword] = useState('');          // masked display only
  const [oldPassword, setOldPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [editingConnection, setEditingConnection] = useState(false);

  // ── LLM config ─────────────────────────────────────────────────
  const [llmApiUrl, setLlmApiUrl] = useState('');
  const [llmApiKey, setLlmApiKey] = useState('');
  const [llmModel, setLlmModel] = useState('');

  // ── STT config（语音识别 LLM，与文本 LLM 分开配置，存 Server 端） ──
  const [sttApiUrl, setSttApiUrl] = useState('');
  const [sttApiKey, setSttApiKey] = useState('');
  const [sttModel, setSttModel] = useState('');

  // ── License ────────────────────────────────────────────────────
  const [license, setLicense] = useState<LicenseStatus | null>(null);
  const [licenseMode, setLicenseMode] = useState<'personal' | 'enterprise'>('personal');
  const [licenseKey, setLicenseKey] = useState('');
  const [enterpriseUrl, setEnterpriseUrl] = useState('');
  const [machineCode, setMachineCode] = useState<string | null>(null);

  // ── Assistant / Theme ──────────────────────────────────────────
  const [assistantName, setAssistantName] = useState('小助手');
  const [appTheme, setAppTheme] = useState(() => {
    const saved = localStorage.getItem('ign-theme');
    return saved === 'dark' || saved === 'light' ? saved : DEFAULT_THEME;
  });

  // ── Login settings ─────────────────────────────────────────────
  const [autoLogin, setAutoLogin] = useState(false);
  const [rememberPassword, setRememberPassword] = useState(false);

  // ── Test states ────────────────────────────────────────────────
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<LLMTestResult | null>(null);

  // ── Global ─────────────────────────────────────────────────────
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // ── Sync theme to DOM + cross-window localStorage ─────────────
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', appTheme);
    localStorage.setItem('ign-theme', appTheme);
  }, [appTheme]);

  // ── Init ───────────────────────────────────────────────────────
  useEffect(() => { void init(); }, []);

  async function init() {
    setLoading(true);
    setError(null);

    try {
      const cfg = await readSettings();
      setUsername(cfg.username);
      setStoredPassword(cfg.password);
      setAppTheme(cfg.theme);
      setAutoLogin(cfg.autoLogin);
      setRememberPassword(cfg.rememberPassword);

      // STT 配置：本地优先（API Key 加密落盘，用时解密），缺失字段再从 Server 回填
      setSttApiUrl(cfg.sttApiUrl);
      setSttModel(cfg.sttModel);
      if (cfg.sttKeyEnc) {
        try { setSttApiKey(await decryptPassword(cfg.sttKeyEnc)); } catch { /* 解密失败则留空 */ }
      }

      // Load assistant name from URL param (passed by login) or server
      const params = new URLSearchParams(window.location.search);
      const nameFromUrl = params.get('assistant');
      if (nameFromUrl) {
        setAssistantName(nameFromUrl);
        // Clean up URL so refresh doesn't re-read stale param
        window.history.replaceState({}, '', window.location.pathname);
      } else {
        // Fetch from server as fallback (e.g. settings opened directly)
        try {
          const info = await apiGet<{ name: string }>('/settings/assistant');
          if (info.name) setAssistantName(info.name);
        } catch { /* use default */ }
      }

      // Fetch remote state if server reachable
      const base = `http://${cfg.server.host}:${cfg.server.port}`;
      try {
        const info = await apiGet<SettingsInfo>('/settings/info');
        if (info.llm) {
          setLlmApiUrl(info.llm.apiUrl ?? '');
          setLlmApiKey(info.llm.apiKey ?? '');
          setLlmModel(info.llm.model ?? '');
        }
        if (info.stt) {
          if (!cfg.sttApiUrl) setSttApiUrl(info.stt.apiUrl ?? '');
          if (!cfg.sttModel) setSttModel(info.stt.model ?? '');
          if (!cfg.sttKeyEnc) setSttApiKey(info.stt.apiKey ?? '');
        }
        if (info.license) setLicense(info.license);
      } catch { /* remote not available */ }
    } catch (err) {
      setError('Failed to load settings');
      console.error(err);
    } finally {
      setLoading(false);
    }
  }

  // ── Save Account ────────────────────────────────────────────────
  const handleSaveConnection = useCallback(async () => {
    setSaving(true);
    setError(null);
    try {
      // Always send all fields — backend handles all validation
      await apiPost('/auth/account', {
        name: username,
        oldpasswd: oldPassword,
        newpasswd: newPassword,
      });

      // Server accepted — persist locally
      const finalPassword = newPassword || storedPassword;
      await writeSettings({
        username,
        password: rememberPassword ? await encryptPassword(finalPassword) : '',
      });
      setStoredPassword(finalPassword);
      setOldPassword('');
      setNewPassword('');
      setEditingConnection(false);
    } catch (err: any) {
      // Username is always saved locally even on backend failure
      await writeSettings({ username });
      setError(err?.message ?? 'Failed to update account');
    } finally {
      setSaving(false);
    }
  }, [username, storedPassword, oldPassword, newPassword, rememberPassword]);

  // ── Save Basic Config ──────────────────────────────────────────
  const handleSaveBasic = useCallback(async () => {
    setSaving(true);
    setError(null);
    try {
      // STT 配置本地保存：API Key 加密后落盘（settings.json），明文不进文件
      const sttKeyEnc = sttApiKey ? await encryptPassword(sttApiKey) : '';
      await writeSettings({ theme: appTheme, sttApiUrl, sttModel, sttKeyEnc });
      // Sync to server (best-effort)
      try {
        await apiPost('/settings/assistant', { name: assistantName });
        await apiPost('/settings', {
          llm: {
            provider: 'openai_compatible' as const,
            api_url: llmApiUrl,
            api_key: llmApiKey,
            model: llmModel,
          },
          stt: {
            api_url: sttApiUrl,
            api_key: sttApiKey,
            model: sttModel,
          },
          license: {
            source: licenseMode,
            ...(licenseMode === 'personal'
              ? { license_key: licenseKey }
              : { license_server_url: enterpriseUrl }),
          },
        });
      } catch { /* non-fatal */ }
    } catch (err: any) {
      setError(err?.message ?? 'Failed to save basic settings');
    } finally {
      setSaving(false);
    }
  }, [appTheme, llmApiUrl, llmApiKey, llmModel, sttApiUrl, sttApiKey, sttModel, licenseMode, licenseKey, enterpriseUrl]);

  // ── Save Login Settings ────────────────────────────────────────
  const handleSaveLogin = useCallback(async () => {
    setSaving(true);
    setError(null);
    try {
      await writeSettings({ autoLogin, rememberPassword });
    } catch (err: any) {
      setError(err?.message ?? 'Failed to save login settings');
    } finally {
      setSaving(false);
    }
  }, [autoLogin, rememberPassword]);

  // ── Test LLM connection ────────────────────────────────────────
  const handleTest = useCallback(async () => {
    setTesting(true);
    setTestResult(null);
    try {
      await apiPost('/settings/text_llm', {
        provider: 'openai_compatible',
        api_url: llmApiUrl,
        api_key: llmApiKey,
        model: llmModel,
      });
      const status = await apiGet<{ ok: boolean; model?: string; latency_ms?: number; error?: string }>('/settings/text_llm/status');
      setTestResult({
        ok: status.ok,
        model: status.model ?? llmModel,
        latency_ms: status.latency_ms ?? 0,
        error: status.error,
      });
    } catch (err) {
      if (err instanceof ApiError) {
        setTestResult({ ok: false, model: llmModel, latency_ms: 0, error: err.message });
      } else {
        setTestResult({ ok: false, model: llmModel, latency_ms: 0, error: String(err) });
      }
    } finally {
      setTesting(false);
    }
  }, [llmApiUrl, llmApiKey, llmModel]);

  // ── Helpers ────────────────────────────────────────────────────
  const llmReady = !!(llmApiUrl && llmApiKey && llmModel);
  const passwordDisplay = storedPassword ? '•'.repeat(Math.min(storedPassword.length, 12)) : '(not set)';

  // ── Loading ────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="settings-page">
        <div style={{ color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)' }}>Loading...</div>
      </div>
    );
  }

  // ── Render ─────────────────────────────────────────────────────
  return (
    <div className="settings-page">
      <div className="settings-container">

        {/* Header */}
        <div className="settings-header">
          <h1>Ign</h1>
          <p>Configuration</p>
        </div>

        {/* Tab Bar */}
        <div style={{ marginBottom: 12 }}>
          <ToggleGroup options={TABS} value={activeTab} onChange={(id) => setActiveTab(id as TabId)} />
        </div>

        {/* ════════════ Tab 1: Connection Config ════════════ */}
        {activeTab === 'connection' && (
          <>
            <TechPanel title="Credentials" variant="card" glow accent="cyan">
              {editingConnection ? (
                <>
                  <FormField label="Username">
                    <FormInput type="text" value={username}
                      onChange={e => setUsername(e.target.value)} placeholder="Enter username" />
                  </FormField>
                  <FormField label="Old Password">
                    <FormInput type="password" value={oldPassword}
                      onChange={e => setOldPassword(e.target.value)} placeholder="Current password" />
                  </FormField>
                  <FormField label="New Password" last>
                    <FormInput type="password" value={newPassword}
                      onChange={e => setNewPassword(e.target.value)} placeholder="New password (leave blank to keep)" />
                  </FormField>
                </>
              ) : (
                <div className="info-readonly">
                  <div className="info-row"><span className="info-label">Username</span><span className="info-value">{username || '(not set)'}</span></div>
                  <div className="info-row"><span className="info-label">Password</span><span className="info-value">{passwordDisplay}</span></div>
                </div>
              )}
            </TechPanel>

            {/* Error */}
            {error && <div className="error-banner">{error}</div>}

            {/* Footer */}
            <div className="settings-footer">
              {editingConnection ? (
                <>
                  <button className="btn" onClick={() => { setEditingConnection(false); setOldPassword(''); setNewPassword(''); setError(null); }}>Cancel</button>
                  <button className="btn btn--primary" onClick={handleSaveConnection} disabled={saving}>
                    {saving ? 'Saving...' : 'Save'}
                  </button>
                </>
              ) : (
                <button className="btn btn--primary" onClick={() => setEditingConnection(true)}>Modify</button>
              )}
            </div>
          </>
        )}

        {/* ════════════ Tab 2: Basic Config ════════════ */}
        {activeTab === 'basic' && (
          <>
            {/* LLM Configuration */}
            <TechPanel title="LLM Configuration" variant="card" glow accent="purple">
              <FormField label="API URL">
                <FormInput type="text" value={llmApiUrl}
                  onChange={e => setLlmApiUrl(e.target.value)} placeholder="https://api.openai.com/v1" />
              </FormField>
              <FormRow>
                <FormField label="API Key">
                  <FormInput type="password" value={llmApiKey}
                    onChange={e => setLlmApiKey(e.target.value)} placeholder="sk-..." />
                </FormField>
                <FormField label="Model">
                  <FormInput type="text" value={llmModel}
                    onChange={e => setLlmModel(e.target.value)} placeholder="e.g. gpt-4o" />
                </FormField>
              </FormRow>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <button className="btn btn--sm" onClick={handleTest} disabled={testing}>
                  {testing ? 'Testing...' : 'Test Connection'}
                </button>
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--font-size-xs)', minWidth: 160 }}>
                  {testing ? (
                    <span style={{ color: 'var(--text-muted)' }}>Testing…</span>
                  ) : testResult ? (
                    testResult.ok
                      ? <span style={{ color: 'var(--success)' }}>✓ {testResult.latency_ms}ms</span>
                      : <span style={{ color: 'var(--danger)' }}>✗ {testResult.error ?? 'Failed'}</span>
                  ) : (
                    <span style={{ color: 'var(--text-muted)' }}>—</span>
                  )}
                </span>
              </div>
            </TechPanel>

            {/* STT / 语音识别（与文本 LLM 分开配置，同样保存在 Server 端） */}
            <TechPanel title="Speech Recognition (STT)" variant="card" glow accent="green">
              <FormField label="API URL">
                <FormInput type="text" value={sttApiUrl}
                  onChange={e => setSttApiUrl(e.target.value)} placeholder="https://api.openai.com" />
              </FormField>
              <FormRow>
                <FormField label="API Key">
                  <FormInput type="password" value={sttApiKey}
                    onChange={e => setSttApiKey(e.target.value)} placeholder="sk-..." />
                </FormField>
                <FormField label="Model">
                  <FormInput type="text" value={sttModel}
                    onChange={e => setSttModel(e.target.value)} placeholder="e.g. whisper-1" />
                </FormField>
              </FormRow>
              <div style={{ marginTop: 10, fontSize: 'var(--font-size-xs)', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
                API Key 本地加密保存（settings.json），同时同步到 Server
              </div>
            </TechPanel>

            {/* License */}
            <TechPanel title="License" variant="card" glow accent="blue">
              <div style={{ marginBottom: 12 }}>
                <ToggleGroup
                  options={[
                    { id: 'personal', label: 'Personal', color: 'var(--accent)', textColor: '#050510' },
                    { id: 'enterprise', label: 'Enterprise', color: 'var(--accent2)', textColor: '#fff' },
                  ]}
                  value={licenseMode} onChange={(id) => setLicenseMode(id as LicenseSource)}
                />
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                <div className="machine-code" style={{ flex: 1, cursor: 'pointer', userSelect: 'all' }}
                  title="Click to copy"
                  onClick={() => {
                    const code = machineCode ?? license?.machine_code;
                    if (code) navigator.clipboard.writeText(code);
                  }}>
                  Machine Code: {machineCode ?? license?.machine_code ?? 'MACH-XXXX-XXXX'}
                </div>
                {!machineCode && !license?.machine_code && (
                  <HintIcon variant="solid" message="Test the server connection to fetch the machine code." />
                )}
              </div>

              {licenseMode === 'personal' ? (
                <FormField label="License Key">
                  <FormInput type="text" value={licenseKey}
                    onChange={e => setLicenseKey(e.target.value)} placeholder="Paste your license key..." />
                </FormField>
              ) : (
                <FormField label="License Server URL">
                  <FormInput type="text" value={enterpriseUrl}
                    onChange={e => setEnterpriseUrl(e.target.value)} placeholder="https://license.your-company.com" />
                </FormField>
              )}
            </TechPanel>

            {/* Assistant */}
            <TechPanel title="Assistant" variant="card" glow accent="cyan">
              <FormField label="Name">
                <FormInput type="text" value={assistantName}
                  onChange={e => setAssistantName(e.target.value)} placeholder="小助手" />
              </FormField>
            </TechPanel>

            {/* Theme */}
            <TechPanel title="Appearance" variant="card" glow accent="yellow">
              <FormField label="Theme" last>
                <Select options={THEME_OPTIONS} value={appTheme} onChange={(t) => { setAppTheme(t as ThemeId); writeSettings({ theme: t }); }} />
              </FormField>
            </TechPanel>

            {/* Voice Input */}
            <TechPanel title="Voice Input" variant="card" glow accent="green">
              <FormField label="Push-to-Talk Hotkey">
                  <div style={{
                    display: 'flex', alignItems: 'center', gap: 8,
                    padding: '8px 12px', background: 'var(--bg-input)',
                    borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-default)',
                  }}>
                    <kbd style={{
                      fontFamily: 'var(--font-mono)', fontSize: 'var(--font-size-sm)',
                      color: 'var(--text-primary)', background: 'rgba(255,255,255,0.1)',
                      padding: '2px 8px', borderRadius: 4, border: '1px solid var(--border-default)',
                    }}>F8</kbd>
                    <span style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
                      Hold to speak. Customization coming soon.
                    </span>
                  </div>
              </FormField>
            </TechPanel>

            {error && <div className="error-banner">{error}</div>}

            <div className="settings-footer">
              <span className="hint">{llmReady ? 'Ready' : 'Configure LLM to start'}</span>
              <button className="btn btn--primary" onClick={handleSaveBasic} disabled={saving}>
                {saving ? 'Saving...' : 'Save'}
              </button>
            </div>
          </>
        )}

        {/* ════════════ Tab 3: Login Settings ════════════ */}
        {activeTab === 'login' && (
          <>
            <TechPanel title="Login Settings" variant="card" glow accent="purple">
              <Checkbox
                checked={rememberPassword}
                onChange={(v: boolean) => { setRememberPassword(v); if (!v) setAutoLogin(false); }}
                label="Remember Password"
                description="Save password locally for next login"
              />
              <Checkbox
                checked={autoLogin}
                onChange={setAutoLogin}
                disabled={!rememberPassword}
                label="Auto Login"
                description={rememberPassword ? 'Automatically connect on app startup' : 'Requires "Remember Password" first'}
              />
            </TechPanel>

            {error && <div className="error-banner">{error}</div>}

            <div className="settings-footer">
              <button className="btn btn--primary" onClick={handleSaveLogin} disabled={saving}>
                {saving ? 'Saving...' : 'Save'}
              </button>
            </div>
          </>
        )}

      </div>
    </div>
  );
}
