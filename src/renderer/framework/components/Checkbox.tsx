import type { ReactNode } from 'react';

/**
 * Checkbox — Styled checkbox with label and optional description.
 *
 * The controlling logic (enable/disable, dependent fields) lives in the
 * parent component via the `disabled` and `onChange` props. Checkbox
 * itself is stateless.
 *
 * Usage:
 *   <Checkbox checked={rem} onChange={setRem}
 *     label="Remember Password" description="Save password locally" />
 *   <Checkbox checked={auto} onChange={setAuto} disabled={!rem}
 *     label="Auto Login" description="Requires Remember Password first" />
 */

export interface CheckboxProps {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  /** Optional secondary text below the label. */
  description?: string;
  disabled?: boolean;
}

export function Checkbox({ checked, onChange, label, description, disabled = false }: CheckboxProps) {
  return (
    <label
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        marginBottom: 8,
        fontSize: 'var(--font-size-sm)',
        fontFamily: 'var(--font-mono)',
        color: disabled ? 'var(--text-muted)' : 'var(--text-secondary)',
        cursor: disabled ? 'not-allowed' : 'pointer',
      }}
    >
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        style={{ accentColor: 'var(--accent)', width: 16, height: 16 }}
      />
      <div>
        <div style={{ color: disabled ? 'var(--text-muted)' : 'var(--text-primary)' }}>
          {label}
        </div>
        {description && (
          <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-muted)' }}>
            {description}
          </div>
        )}
      </div>
    </label>
  );
}
