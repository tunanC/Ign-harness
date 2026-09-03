import { useState, useRef, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';

/**
 * Select — Custom dropdown with portal-based popup.
 *
 * Accepts arbitrary options; the developer controls what happens on change.
 *
 * Usage:
 *   <Select
 *     options={[{ id: 'a', label: 'Option A' }, { id: 'b', label: 'Option B' }]}
 *     value={selected}
 *     onChange={(id) => setSelected(id)}
 *   />
 */

export interface SelectOption {
  id: string;
  label: string;
}

export interface SelectProps {
  options: SelectOption[];
  value: string;
  onChange: (id: string) => void;
  placeholder?: string;
}

export function Select({ options, value, onChange, placeholder }: SelectProps) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ x: 0, y: 0, w: 0 });
  const triggerRef = useRef<HTMLDivElement>(null);
  const popupRef = useRef<HTMLDivElement>(null);

  // Click outside → close
  useEffect(() => {
    if (!open) return;
    const fn = (e: MouseEvent) => {
      const t = e.target as Node;
      if (triggerRef.current?.contains(t) || popupRef.current?.contains(t)) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', fn);
    return () => document.removeEventListener('mousedown', fn);
  }, [open]);

  const toggle = useCallback(() => {
    if (!open && triggerRef.current) {
      const r = triggerRef.current.getBoundingClientRect();
      setPos({ x: r.left, y: r.bottom + 4, w: r.width });
    }
    setOpen((o) => !o);
  }, [open]);

  const current = options.find((o) => o.id === value);

  return (
    <div ref={triggerRef} style={{ cursor: 'pointer', userSelect: 'none' }}>
      {/* Trigger */}
      <div
        className="form-input"
        onClick={toggle}
        style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        }}
      >
        <span style={{ color: current ? undefined : 'var(--text-muted)' }}>
          {current?.label ?? placeholder ?? value}
        </span>
        <span style={{
          transform: open ? 'rotate(180deg)' : 'rotate(0deg)',
          transition: 'transform 150ms var(--ease-out)',
          fontSize: 10, opacity: 0.5,
        }}>▼</span>
      </div>

      {/* Dropdown via portal */}
      {open && createPortal(
        <div ref={popupRef} style={{
          position: 'fixed',
          left: pos.x,
          top: pos.y,
          width: pos.w,
          background: 'var(--bg-card)',
          border: '1px solid var(--border-default)',
          borderRadius: 'var(--radius-sm)',
          overflow: 'hidden',
          zIndex: 99999,
          boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
          backdropFilter: 'blur(8px)',
        }}>
          {options.map((opt) => (
            <div
              key={opt.id}
              onClick={() => { onChange(opt.id); setOpen(false); }}
              style={{
                padding: '8px 12px',
                fontFamily: 'var(--font-mono)',
                fontSize: 'var(--font-size-sm)',
                color: opt.id === value ? 'var(--accent)' : 'var(--text-primary)',
                background: opt.id === value ? 'var(--bg-hover)' : 'transparent',
                transition: 'background 100ms var(--ease-out)',
                cursor: 'pointer',
              }}
              onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--bg-hover)'; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = opt.id === value ? 'var(--bg-hover)' : 'transparent'; }}
            >
              {opt.label}
            </div>
          ))}
        </div>,
        document.body,
      )}
    </div>
  );
}
