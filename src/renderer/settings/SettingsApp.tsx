import { useEffect, useMemo } from 'react';
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow';
import { SettingsPanel } from '../panels/SettingsPanel';
import { TitleBar, type WinRef } from '../framework/components/TitleBar';

/* ═══════════════════════════════════════════════════════════════════
   SettingsApp — Settings window entry (opened from Main window).
   No longer the first-launch screen; login handles that now.
   ═══════════════════════════════════════════════════════════════════ */

export function SettingsApp() {
  const closeWins = useMemo<WinRef[]>(() => [getCurrentWebviewWindow()], []);

  // F12 → DevTools
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'F12') getCurrentWebviewWindow().openDevTools();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <>
      <TitleBar variant="solid" buttons={['close']} closeWindows={closeWins} />
      <SettingsPanel />
    </>
  );
}
