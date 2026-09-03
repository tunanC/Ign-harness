import { useState, useCallback } from 'react';
import './OrbPanel.css';

/* ═══════════════════════════════════════════════════════════════════
   OrbPanel — Floating action orb with radial tool menu.
   ═══════════════════════════════════════════════════════════════════ */

interface OrbAction {
  key: string;
  icon: string;
  label: string;
  action: () => void;
}

export interface OrbPanelProps {
  onClearChat?: () => void;
}

export function OrbPanel({ onClearChat }: OrbPanelProps) {
  const [open, setOpen] = useState(false);

  const handleToggle = useCallback(() => {
    setOpen((v) => !v);
  }, []);

  const handleAction = useCallback(
    (action: () => void) => {
      setOpen(false);
      action();
    },
    [],
  );

  const actions: OrbAction[] = [
    {
      key: 'clear',
      icon: '✕',
      label: 'Clear Chat',
      action: () => onClearChat?.(),
    },
    // TODO: add more orb actions (new session, export, screenshot, etc.)
  ];

  return (
    <div className="orb-panel">
      {/* Radial menu */}
      {open && (
        <>
          <div className="orb-backdrop" onClick={() => setOpen(false)} />
          <div className="orb-menu">
            {actions.map((a, i) => (
              <button
                key={a.key}
                className="orb-menu__item"
                style={{ animationDelay: `${i * 0.04}s` }}
                onClick={() => handleAction(a.action)}
                title={a.label}
              >
                <span className="orb-menu__icon">{a.icon}</span>
                <span className="orb-menu__label">{a.label}</span>
              </button>
            ))}
          </div>
        </>
      )}

      {/* Main orb button */}
      <button
        className={`orb-btn ${open ? 'orb-btn--active' : ''}`}
        onClick={handleToggle}
        title="Actions"
      >
        <span className="orb-btn__icon">{open ? '✕' : '◆'}</span>
      </button>
    </div>
  );
}
