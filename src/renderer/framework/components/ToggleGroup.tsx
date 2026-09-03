/**
 * ToggleGroup — Horizontal segmented button group.
 *
 * Each option can have its own active color (for license-style usage)
 * or share the default accent (for tab-bar usage).
 *
 * Usage:
 *   // Tab bar — all options use default accent
 *   <ToggleGroup
 *     options={[{ id: 'a', label: 'Tab A' }, { id: 'b', label: 'Tab B' }]}
 *     value={active} onChange={setActive}
 *   />
 *
 *   // License selector — each option has its own color
 *   <ToggleGroup
 *     options={[
 *       { id: 'personal', label: 'Personal', color: 'var(--accent)', textColor: '#050510' },
 *       { id: 'enterprise', label: 'Enterprise', color: 'var(--accent2)', textColor: '#fff' },
 *     ]}
 *     value={mode} onChange={setMode}
 *   />
 */

export interface ToggleOption {
  id: string;
  label: string;
  /** Background color when active (default: var(--accent)) */
  color?: string;
  /** Text color when active (default: white for dark, dark for light) */
  textColor?: string;
}

export interface ToggleGroupProps {
  options: ToggleOption[];
  value: string;
  onChange: (id: string) => void;
}

export function ToggleGroup({ options, value, onChange }: ToggleGroupProps) {
  return (
    <div style={{
      display: 'flex',
      borderRadius: 'var(--radius-md)',
      overflow: 'hidden',
      border: '1px solid var(--border-default)',
    }}>
      {options.map((opt) => {
        const active = opt.id === value;
        return (
          <button
            key={opt.id}
            onClick={() => onChange(opt.id)}
            style={{
              flex: 1,
              padding: '8px 0',
              border: 'none',
              cursor: 'pointer',
              fontFamily: 'var(--font-mono)',
              fontSize: 'var(--font-size-sm)',
              background: active ? (opt.color ?? 'var(--accent)') : 'transparent',
              color: active ? (opt.textColor ?? '#050510') : 'var(--text-muted)',
              transition: 'background var(--duration-fast) var(--ease-out)',
            }}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
