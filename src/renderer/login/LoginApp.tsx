import { useCallback, useEffect, useMemo } from 'react';
import { getCurrentWebviewWindow, WebviewWindow } from '@tauri-apps/api/webviewWindow';
import { currentMonitor } from '@tauri-apps/api/window';
import { PhysicalPosition } from '@tauri-apps/api/dpi';
import { LoginPanel } from './LoginPanel';
import { TitleBar, type WinRef } from '../framework/components/TitleBar';
import { readSettings, writeSettings } from '../client/config';

/* ═══════════════════════════════════════════════════════════════════
   LoginApp — Login window entry point (bootstrap window).
   Shows on every app launch. After successful authentication,
   creates Main + Orb + Settings windows, then closes itself.
   All window creation lives here in the frontend, not in lib.rs.
   ═══════════════════════════════════════════════════════════════════ */

/** Wait for a newly created WebviewWindow to be ready. */
async function waitForWindow(win: WebviewWindow): Promise<void> {
  return new Promise((resolve, reject) => {
    win.once('tauri://created', () => resolve());
    win.once('tauri://error', (e: unknown) => reject(new Error(String((e as { payload?: unknown })?.payload || e))));
  });
}

export function LoginApp() {
  const closeWins = useMemo<WinRef[]>(() => [getCurrentWebviewWindow()], []);

  // Apply saved theme on mount (before first paint)
  useEffect(() => {
    (async () => {
      try {
        const cfg = await readSettings();
        document.documentElement.setAttribute('data-theme', cfg.theme);
      } catch { /* use default (dark) */ }
    })();
  }, []);

  // F12 → DevTools
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'F12') getCurrentWebviewWindow().openDevTools();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const handleLoginSuccess = useCallback(async (
    _host: string, _port: string, _username: string, _password: string, _authToken: string,
    assistantName: string,
  ) => {
    const loginWin = getCurrentWebviewWindow();

    // ── Create & show Main window ────────────────────────────────
    const mainWin = new WebviewWindow('main', {
      url: 'app/index.html',
      title: 'Ign',
      width: 580,
      height: 420,
      minWidth: 400,
      minHeight: 300,
      decorations: false,
      transparent: true,
      shadow: false,
      visible: false,
      center: true,
      maximizable: false,
    });
    await waitForWindow(mainWin);
    await mainWin.show();
    await mainWin.setFocus();

    // ── Create & show Orb window ─────────────────────────────────
    const orbWin = new WebviewWindow('orb', {
      url: 'orb/index.html',
      title: 'Orb',
      width: 440,
      height: 200,
      decorations: false,
      shadow: false,
      resizable: false,
      transparent: true,
      skipTaskbar: true,
      visible: false,
    });
    await waitForWindow(orbWin);

    // Position orb at bottom-left of primary monitor
    try {
      const monitor = await currentMonitor();
      if (monitor) {
        const sf = monitor.scaleFactor;
        const margin = 40 * sf;
        const orbH = 200 * sf;  // ORB_H in physical pixels
        const x = monitor.position.x + margin;
        const y = monitor.position.y + monitor.size.height - orbH - margin;
        await orbWin.setPosition(new PhysicalPosition(x, y));
      }
    } catch { /* skip positioning if monitor info unavailable */ }

    await orbWin.show();
    await orbWin.setAlwaysOnTop(true);

    // ── Pre-create Settings window (hidden, shown on demand) ─────
    new WebviewWindow('settings', {
      url: `settings/index.html?assistant=${encodeURIComponent(assistantName)}`,
      title: 'Ign — Settings',
      width: 700,
      height: 780,
      minWidth: 580,
      minHeight: 660,
      decorations: false,
      transparent: true,
      shadow: false,
      skipTaskbar: true,
      visible: false,
      center: true,
    });

    // ── Close login window ───────────────────────────────────────
    await loginWin.close();
  }, []);

  return (
    <>
      <TitleBar variant="solid" buttons={['close']} closeWindows={closeWins} />
      <LoginPanel onLoginSuccess={handleLoginSuccess} />
    </>
  );
}
