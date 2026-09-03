import { useCallback, useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { getCurrentWebviewWindow, WebviewWindow } from '@tauri-apps/api/webviewWindow';
import { listen } from '@tauri-apps/api/event';
import { ChatPanel } from '../panels/ChatPanel';
import { TitleBar } from '../framework/components/TitleBar';
import { connectWs, disconnectWs } from '../client/ws';
import { apiGet } from '../client/http';
import type { LicenseStatus } from '../shared/models';
import './App.css';

/* ═══════════════════════════════════════════════════════════════════
   App — Main window shell (Chat + License bar).
   Orb is a standalone desktop window.
   ═══════════════════════════════════════════════════════════════════ */

export function App() {
  const [license, setLicense] = useState<LicenseStatus | null>(null);
  const [clearKey, setClearKey] = useState(0);

  // ── Minimize: hide orb first, then minimize main ────────────
  const handleMinimize = useCallback(async () => {
    try { const orb = await WebviewWindow.getByLabel('orb'); if (orb) await orb.hide(); } catch {}
    await getCurrentWindow().minimize();
  }, []);

  // ── Close: hide main + orb to tray ──────────────────────────
  const hideToTray = useCallback(async () => {
    try { const orb = await WebviewWindow.getByLabel('orb'); if (orb) await orb.hide(); } catch {}
    await getCurrentWindow().hide();
  }, []);

  // ── Alt+F4 → exit app ────────────────────────────────────────
  useEffect(() => {
    const win = getCurrentWindow();
    const unlisten = win.onCloseRequested((event) => {
      event.preventDefault();
      invoke('exit_app');
    });
    return () => { unlisten.then((fn) => fn()); };
  }, []);

  // ── WebSocket + dispatcher ────────────────────────────────────
  useEffect(() => {
    connectWs();
    import('../client/dispatcher').then(({ startDispatcher }) => startDispatcher());
    return () => disconnectWs();
  }, []);

  // ── License status ─────────────────────────────────────────────
  useEffect(() => {
    apiGet<{ license: LicenseStatus }>('/settings/info')
      .then((info) => setLicense(info.license))
      .catch(() => { /* server not ready yet */ });
  }, []);

  // ── Orb cross-window events ────────────────────────────────────
  useEffect(() => {
    const unlisten = listen('orb:clear-chat', () => {
      setClearKey((k) => k + 1);
    });
    return () => { unlisten.then((fn) => fn()); };
  }, []);

  // ── DevTools ───────────────────────────────────────────────────
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'F12') getCurrentWebviewWindow().openDevTools();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <>
      <TitleBar variant="glasses" buttons={['close', 'minimize', 'settings']}
        onClose={hideToTray}
        onMinimize={handleMinimize}
      />
      <div className="app-shell" style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
        <ChatPanel clearKey={clearKey} />

        {/* ── License status bar ───────────────────────────────── */}
        {license && (
          <div style={{
            position: 'absolute', bottom: 0, left: 0, right: 0,
            height: 28, display: 'flex', alignItems: 'center',
            justifyContent: 'center', gap: 12,
            background: 'var(--bg-input)',
            borderTop: '1px solid var(--border-subtle)',
            fontFamily: 'var(--font-mono)', fontSize: 'var(--font-size-xs)',
            zIndex: 5,
          }}>
            <span style={{ color: 'var(--text-secondary)' }}>
              {license.source === 'enterprise' ? 'Enterprise' : 'Personal'}
              {license.activated ? ' · Activated' : ' · Inactive'}
            </span>
            {(() => {
              const trialDays = license.trial_days_remaining;
              const expireDate = license.expire_date;
              let remainingDays: number | null = null;
              if (trialDays != null) {
                remainingDays = trialDays;
              } else if (expireDate) {
                const ms = new Date(expireDate).getTime() - Date.now();
                remainingDays = Math.max(0, Math.ceil(ms / (1000 * 60 * 60 * 24)));
              }
              if (remainingDays == null) return null;
              const color = remainingDays > 7 ? 'var(--success)'
                          : remainingDays > 3 ? 'var(--warning)'
                          : 'var(--danger)';
              return (
                <span style={{ color }}>
                  {remainingDays} day{remainingDays !== 1 ? 's' : ''} remaining
                </span>
              );
            })()}
            {license.licensee && (
              <span style={{ color: 'var(--text-muted)' }}>{license.licensee}</span>
            )}
          </div>
        )}
      </div>
    </>
  );
}
