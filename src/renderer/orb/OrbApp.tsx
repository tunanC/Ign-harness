import { useState, useCallback, useRef, useEffect, useLayoutEffect } from 'react';
import { createPortal } from 'react-dom';
import { invoke } from '@tauri-apps/api/core';
import { emit } from '@tauri-apps/api/event';
import { register, unregister } from '@tauri-apps/plugin-global-shortcut';
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow';
import { currentMonitor } from '@tauri-apps/api/window';
import { PhysicalPosition, PhysicalSize } from '@tauri-apps/api/dpi';
import { OrbThree } from './OrbThree';

/* ═══════════════════════════════════════════════════════════════════
   OrbApp — Standalone floating orb on desktop.
   Pure circle. Hover → input expands above.
   Hotkey → listening mode + animation.
   ═══════════════════════════════════════════════════════════════════ */

const ORB_SIZE = 70;
const ORB_W = 440;
const ORB_H = 200;
const DOCK_W = 48;
const DOCK_H = 92;

/** Multimedia / speech-mouse keys that toggle listening mode */
const LISTENING_HOTKEYS = new Set([
  'AudioVolumeMute', 'LaunchApp2',
]);

export function OrbApp() {
  const [hovered, setHovered] = useState(false);
  const [listening, setListening] = useState(false);
  const [input, setInput] = useState('');
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const expanded = hovered || listening || !!input;

  // ── Dock state machine ────────────────────────────────────────
  const [dockSide, setDockSide] = useState<'none' | 'left' | 'right'>('none');
  const [fullyDocked, setFullyDocked] = useState(false);
  const [mouseOnOrb, setMouseOnOrb] = useState(false);
  const [mouseOnDock, setMouseOnDock] = useState(false);
  const dockTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const DOCK_DELAY = 2000;

  // Pass intended values as args to avoid stale state in timer closure
  const tryDockAfterSleep = useCallback(
    (_isOnOrb: boolean, _isOnDock: boolean, _side: string, _input: string) => {
      if (dockTimerRef.current) clearTimeout(dockTimerRef.current);
      dockTimerRef.current = setTimeout(() => {
        if (_side !== 'none' && !_isOnOrb && !_isOnDock && !_input.trim()) {
          getCurrentWebviewWindow().setSize(new PhysicalSize(DOCK_W * window.devicePixelRatio, DOCK_H * window.devicePixelRatio));
          setFullyDocked(true);
        }
      }, DOCK_DELAY);
    }, []);

  // Edge detection via window move (Rust handles physical boundary clamp)
  useEffect(() => {
    let wasAtEdge = false;
    let cancelled = false;
    let unlistenFn: (() => void) | null = null;
    const orbWin = getCurrentWebviewWindow();

    (async () => {
      const m = await currentMonitor();
      if (cancelled || !m) return;
      const monitorCache = { x: m.position.x, y: m.position.y, w: m.size.width, h: m.size.height };

      const unlisten = await orbWin.onMoved(({ payload: pos }) => {
        const { x: sx, y: sy, w: sw, h: sh } = monitorCache;
        const over_l = 30 * window.devicePixelRatio, over_r = 30 * window.devicePixelRatio;

        const atLeft = Math.abs(pos.x - sx + over_l) <= 1;
        const atRight = Math.abs(pos.x + ORB_W - (sx + sw - over_r)) <= 1;
        const atEdge = atLeft || atRight;

        if (atEdge !== wasAtEdge) {
          wasAtEdge = atEdge;
          const side = atLeft ? 'left' : atRight ? 'right' : 'none';
          setDockSide(side as 'none' | 'left' | 'right');
          setFullyDocked(false);
          if (!atEdge) {
            orbWin.setSize(new PhysicalSize(ORB_W * window.devicePixelRatio, ORB_H * window.devicePixelRatio));
          }
        }
      });

      if (cancelled) { unlisten(); } else { unlistenFn = unlisten; }
    })();

    return () => { cancelled = true; unlistenFn?.(); };
  }, []);

  // Sync CSS visibility
  useLayoutEffect(() => {
    const rootEl = document.getElementById('root');
    const dockEl = document.getElementById('root-dock');
    if (rootEl && dockEl) {
      rootEl.style.display = fullyDocked ? 'none' : '';
      dockEl.style.display = fullyDocked ? '' : 'none';
    }
  }, [fullyDocked]);

  const docked = fullyDocked;

  // ── Alt+F4 → exit app ────────────────────────────────────────
  useEffect(() => {
    const win = getCurrentWebviewWindow();
    const unlisten = win.onCloseRequested((event) => {
      event.preventDefault();
      invoke('exit_app');
    });
    return () => { unlisten.then((fn) => fn()); };
  }, []);

  // F12 → DevTools (must fire before hotkey handler)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'F12') {
        e.stopImmediatePropagation();
        getCurrentWebviewWindow().openDevTools();
      }
    };
    window.addEventListener('keydown', onKey, true); // capture phase
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);

  // ── Global shortcut: F8 push-to-talk (works regardless of window focus) ──
  useEffect(() => {
    let active = true;

    (async () => {
      try {
        await register('F8', (e) => {
          if (!active) return;
          setListening(e.state === 'Pressed');
        });
      } catch {
        await new Promise((r) => setTimeout(r, 200));
        try { await register('F8', (e) => { if (active) setListening(e.state === 'Pressed'); }); } catch { /* skip */ }
      }
    })();

    const onKeyDown = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape') {
        setHovered(false);
        setListening(false);
        setInput('');
      }
      if (LISTENING_HOTKEYS.has(e.key)) {
        e.preventDefault();
        setListening((prev) => !prev);
      }
    };
    window.addEventListener('keydown', onKeyDown);

    return () => {
      active = false;
      unregister('F8');
      window.removeEventListener('keydown', onKeyDown);
    };
  }, []);

  // ── Speech input placeholder ─────────────────────────────────────
  useEffect(() => {
    if (!listening) return;
  }, [listening]);

  // Send message to main window
  const send = useCallback(() => {
    const text = input.trim();
    if (!text) return;
    emit('orb:send-message', { text });
    setInput('');
    setListening(false);
    inputRef.current?.focus();
  }, [input]);

  useEffect(() => {
    if (!input && inputRef.current) {
      inputRef.current.style.height = 'auto';
    }
  }, [input]);

  const BAR_W = 8;
  const BAR_H = 48;

  // Dock portal — neon energy bar at screen edge
  const dockEl = document.getElementById('root-dock');
  const dockPortal = (docked && dockEl) ? createPortal(
    <>
      {/* Inline keyframes for flowing gradient */}
      <style>{`
        @keyframes dock-flow {
          0%   { background-position: 0% 0%; }
          100% { background-position: 0% 200%; }
        }
        @keyframes dock-pulse {
          0%, 100% { opacity: 0.7; }
          50%      { opacity: 1;   }
        }
      `}</style>
      <div
        // Dock bar: enter → undock immediately, reset states
        onMouseEnter={() => {
          setMouseOnDock(true);
          getCurrentWebviewWindow().setSize(new PhysicalSize(ORB_W * window.devicePixelRatio, ORB_H * window.devicePixelRatio));
          setFullyDocked(false);
          setMouseOnDock(false);
          setMouseOnOrb(true);
        }}
        onMouseLeave={() => { setMouseOnDock(false); }}
        style={{
        position: 'absolute',
        left: dockSide === 'left' ? 30 : 'auto',
        right: dockSide === 'right' ? 30 : 'auto',
        top: 65,  // orb circle center Y in the window
        transform: 'translateY(-50%)',
        width: BAR_W,
        height: BAR_H,
        borderRadius: 2,
        background: `linear-gradient(to bottom,
          var(--blob-2, #a855f7),
          var(--blob-1, #00e5ff) 40%,
          var(--blob-2, #a855f7) 70%,
          var(--blob-1, #00e5ff))`,
        backgroundSize: `100% 200%`,
        animation: 'dock-flow 2.5s linear infinite, dock-pulse 1.8s ease-in-out infinite',
        boxShadow: `
          0 0 8px  var(--accent-glow, rgba(0,229,255,0.22)),
          0 0 20px var(--accent2-glow, rgba(168,85,247,0.22)),
          0 0 36px rgba(0,229,255,0.08)
        `,
        pointerEvents: 'auto',
        cursor: 'pointer',
      }} />
    </>,
    dockEl,
  ) : null;

  return (
    <>
    {dockPortal}
    <style>{`
      .orb-input::placeholder { color: var(--glasses-placeholder); }
      .orb-input::-webkit-scrollbar { width: 6px; }
      .orb-input::-webkit-scrollbar-track { background: transparent; }
      .orb-input::-webkit-scrollbar-thumb { background: var(--glasses-scrollbar-thumb); border-radius: 10px; }
      .orb-input::-webkit-scrollbar-thumb:hover { background: var(--glasses-scrollbar-thumb-hover); }
      .orb-send-btn { background: var(--glasses-btn-bg); }
      .orb-send-btn:not(:disabled):hover { background: var(--glasses-btn-hover-bg); cursor: pointer; }
      .orb-send-btn:disabled { cursor: default; }
    `}</style>
    <div
      onMouseEnter={() => {
        if (dockTimerRef.current) { clearTimeout(dockTimerRef.current); dockTimerRef.current = null; }
        setHovered(true);
        setMouseOnOrb(true);
      }}
      onMouseLeave={() => {
        setHovered(false);
        setMouseOnOrb(false);
        if (!input.trim()) {
          tryDockAfterSleep(false, mouseOnDock, dockSide, input);
        }
      }}
      style={{
        position: 'relative',
        width: expanded ? ORB_SIZE + 16 + 280 : ORB_SIZE,
        minHeight: ORB_SIZE,
        pointerEvents: 'auto',
        transition: 'width 0.28s var(--ease-out)',
      }}>
      {/* Three.js vortex orb — top-left */}
      <div
        onClick={() => { setHovered(true); inputRef.current?.focus(); }}
        style={{
        WebkitAppRegion: 'drag',
        position: 'absolute',
        left: 0, top: 0,
        width: ORB_SIZE, height: ORB_SIZE, borderRadius: '100%',
        background: 'var(--orb-bg)',
        borderLeft: '1px solid var(--glasses-border)',
        borderTop: '1px solid var(--glasses-border)',
        borderRight: 'none',
        borderBottom: 'none',
        backdropFilter: 'blur(16px)',
        overflow: 'hidden',
        zIndex: 2,
        boxShadow: expanded
          ? 'var(--orb-glow-active)'
          : 'var(--orb-glow-idle)',
        transition: 'box-shadow 0.3s var(--ease-out)',
      } as React.CSSProperties}>
        <OrbThree
          size={ORB_SIZE}
          hovered={hovered || listening}
          listening={listening}
          onClick={() => {}}
          onMouseEnter={() => {}}
          onMouseLeave={() => {}}
        />
        <div style={{
          position: 'absolute', inset: 0, borderRadius: '50%',
          pointerEvents: 'none',
          boxShadow: 'var(--orb-rim-light)',
        }} />
      </div>

      {/* Input panel — from orb's right side */}
      <div style={{
        position: 'absolute',
        left: ORB_SIZE + 16,
        top: 12,
        width: expanded ? 280 : 0,
        transition: 'all 0.28s var(--ease-out)',
        opacity: expanded ? 1 : 0,
        pointerEvents: expanded ? 'auto' : 'none',
        zIndex: 1,
      }}>
        <div style={{
          WebkitAppRegion: 'no-drag',
          padding: 8, borderRadius: 12,
          background: 'var(--glasses-panel-bg)',
          borderLeft: '1px solid var(--glasses-border)',
          borderTop: '1px solid var(--glasses-border)',
          borderRight: 'none',
          borderBottom: 'none',
          boxShadow: 'var(--glasses-shadow)',
          backdropFilter: 'blur(16px)',
          display: 'flex', alignItems: 'flex-start', gap: 6,
          width: 280, boxSizing: 'border-box',
        } as React.CSSProperties}>
          <textarea
            ref={inputRef}
            className="orb-input"
            value={input}
            onChange={(e) => {
              setInput(e.target.value);
              const el = e.target;
              el.style.height = 'auto';
              el.style.height = Math.min(el.scrollHeight, 120) + 'px';
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
            }}
            onFocus={() => setHovered(true)}
            onBlur={() => { if (!input.trim() && !listening) setHovered(false); }}
            placeholder="Ask 小助手…"
            rows={1}
            style={{
              flex: 1, minWidth: 0,
              padding: '8px 10px 8px 24px', border: 'none', outline: 'none',
              background: 'transparent',
              color: 'var(--glasses-input-text)',
              fontFamily: 'var(--font-mono)', fontSize: 'var(--font-size-sm)',
              lineHeight: '1.4',
              resize: 'none', overflowY: 'auto',
            }}
          />
          <button
            onClick={send}
            disabled={!input.trim()}
            className="orb-send-btn"
            style={{
              width: 30, height: 30, borderRadius: '50%',
              borderLeft: '1px solid var(--glasses-border)',
              borderTop: 'none',
              borderRight: 'none',
              borderBottom: 'none',
              color: input.trim() ? 'var(--glasses-btn-text)' : 'var(--glasses-btn-disabled-text)',
              fontSize: 14, display: 'flex', alignItems: 'center', justifyContent: 'center',
              flexShrink: 0, alignSelf: 'flex-end',
            }}
          >→</button>
        </div>
      </div>
    </div>
    </>
  );
}
