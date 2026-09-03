import { useCallback } from 'react';
import { WebviewWindow } from '@tauri-apps/api/webviewWindow';
import { ActionDot } from './ActionDot';

type Variant = 'solid' | 'glasses';
type TitleBarButton = 'close' | 'minimize' | 'maximize' | 'settings';

/** Minimal window shape — satisfied by both Window and WebviewWindow. */
export interface WinRef {
  close(): Promise<void>;
  minimize(): Promise<void>;
  toggleMaximize(): Promise<void>;
}

interface Props {
  variant?: Variant;
  /** Enable drag-to-move on the title bar. Default true. */
  draggable?: boolean;
  /** Buttons to show (in order). Default empty — no buttons. */
  buttons?: TitleBarButton[];
  /** Windows to close when close button is clicked. */
  closeWindows?: WinRef[];
  /** Windows to minimize when minimize button is clicked. */
  minimizeWindows?: WinRef[];
  /** Windows to toggle-maximize when maximize button is clicked. */
  maximizeWindows?: WinRef[];
  /** Custom close handler. If provided, overrides closeWindows. */
  onClose?: () => void | Promise<void>;
  /** Custom minimize handler. If provided, overrides minimizeWindows. */
  onMinimize?: () => void | Promise<void>;
  /** Custom maximize handler. If provided, overrides maximizeWindows. */
  onMaximize?: () => void | Promise<void>;
  /** Custom settings handler. If not provided, defaults to opening the "settings" window. */
  onSettings?: () => void | Promise<void>;
}

const DOT_SPEC: Record<TitleBarButton, { color: 'red' | 'yellow' | 'green' | 'purple'; label: string }> = {
  close:     { color: 'red',    label: 'Close' },
  minimize:  { color: 'yellow', label: 'Minimize' },
  maximize:  { color: 'green',  label: 'Maximize' },
  settings:  { color: 'purple', label: 'Settings' },
};

/** Apply an async action to every window in the list. */
async function forWindows(windows: WinRef[], action: (win: WinRef) => Promise<void>) {
  for (const win of windows) {
    await action(win);
  }
}

export function TitleBar({ variant = 'solid', draggable = true, buttons = [], closeWindows, minimizeWindows, maximizeWindows, onClose, onMinimize, onMaximize, onSettings }: Props) {
  const isGlasses = variant === 'glasses';

  const handleClose = useCallback(async () => {
    if (onClose) {
      await onClose();
    } else if (closeWindows && closeWindows.length > 0) {
      await forWindows(closeWindows, (w) => w.close());
    }
  }, [closeWindows, onClose]);

  const handleMinimize = useCallback(async () => {
    if (onMinimize) {
      await onMinimize();
    } else if (minimizeWindows && minimizeWindows.length > 0) {
      await forWindows(minimizeWindows, (w) => w.minimize());
    }
  }, [minimizeWindows, onMinimize]);

  const handleMaximize = useCallback(async () => {
    if (onMaximize) {
      await onMaximize();
    } else if (maximizeWindows && maximizeWindows.length > 0) {
      await forWindows(maximizeWindows, (w) => w.toggleMaximize());
    }
  }, [maximizeWindows, onMaximize]);

  const handleSettings = useCallback(async () => {
    if (onSettings) {
      await onSettings();
    } else {
      let settingsWin = await WebviewWindow.getByLabel('settings');
      if (!settingsWin) {
        // Create on demand if not pre-created by login flow
        const win = new WebviewWindow('settings', {
          url: 'settings/index.html',
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
        await new Promise<void>((resolve, reject) => {
          win.once('tauri://created', () => resolve());
          win.once('tauri://error', (e: unknown) => reject(new Error(String((e as { payload?: unknown })?.payload || e))));
        });
        settingsWin = win;
      }
      await settingsWin.unminimize();
      await settingsWin.show();
      await settingsWin.setFocus();
      await settingsWin.setAlwaysOnTop(true);
    }
  }, [onSettings]);

  const handlers: Record<TitleBarButton, () => void> = {
    close: handleClose,
    minimize: handleMinimize,
    maximize: handleMaximize,
    settings: handleSettings,
  };

  return (
    <div style={{
      display: 'flex', alignItems: 'center',
      height: 34, flexShrink: 0,
      padding: '0 12px', userSelect: 'none',
      WebkitAppRegion: draggable ? 'drag' : 'no-drag',
    }}>
      <div style={{ display: 'flex', gap: 9, WebkitAppRegion: 'no-drag' }}>
        {buttons.map(btn => {
          const spec = DOT_SPEC[btn];
          // settings dot only available in glasses variant
          if (btn === 'settings' && !isGlasses) return null;
          return (
            <ActionDot key={btn} color={spec.color} label={spec.label}
              variant={variant} onClick={handlers[btn]} />
          );
        })}
      </div>
      <span style={{
        flex: 1, textAlign: 'center', fontSize: 'var(--font-size-xs)',
        fontFamily: 'var(--font-mono)', color: 'var(--text-muted)',
        letterSpacing: '0.08em', pointerEvents: 'none',
      }}>Ign</span>
      {/* Spacer to balance button width on the left → keeps text centered */}
      <div style={{ width: buttons.length > 0 ? buttons.length * 33 : 0 }} />
    </div>
  );
}
