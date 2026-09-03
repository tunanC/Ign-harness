import type { CSSProperties, ReactNode } from 'react';

/**
 * TechPanel — Sci-fi styled container with glowing border and vignette.
 *
 * Usage:
 *   <TechPanel variant="card"> content </TechPanel>
 *   <TechPanel variant="section" glow accent="purple"> content </TechPanel>
 */

export interface TechPanelProps {
  children: ReactNode;
  variant?: 'card' | 'section' | 'inset';
  glow?: boolean;
  /** Preset name or any CSS color string (e.g. '#ff6600', 'rgb(200,100,50)', 'var(--my-color)') */
  accent?: string;
  className?: string;
  style?: CSSProperties;
  /** Optional title shown in the panel's top bar */
  title?: string;
}

export function TechPanel({
  children,
  variant = 'card',
  glow = false,
  accent = 'cyan',
  className = '',
  style,
  title,
}: TechPanelProps) {
  const accentMap: Record<string, { color: string; glow: string }> = {
    cyan:   { color: 'var(--accent)',   glow: 'var(--accent-glow)'   },
    purple: { color: 'var(--accent2)',  glow: 'var(--accent2-glow)'  },
    pink:   { color: 'var(--accent3)',  glow: 'var(--accent3-glow)'  },
    blue:   { color: 'var(--accent4)',  glow: 'var(--accent4-glow)'  },
    yellow: { color: 'var(--accent5)',  glow: 'var(--accent5-glow)'  },
    green:  { color: 'var(--success)',  glow: 'var(--success-glow)'  },
  };
  const preset = accentMap[accent ?? ''];
  // Preset → use design-token values; anything else → treat as raw CSS color
  const accentVar   = preset ? preset.color : accent!;
  const accentGlow  = preset ? preset.glow  : accent!;

  const baseStyle: CSSProperties = {
    background: variant === 'inset' ? 'var(--bg-input)' : 'var(--bg-card)',
    border: `1px solid ${accentGlow}`,
    borderRadius: 'var(--radius-lg)',
    position: 'relative',
    overflow: 'hidden',
    ...(glow
      ? { boxShadow: `inset 0 0 24px ${accentGlow}` }
      : {}),
    ...style,
  };

  return (
    <div className={`tech-panel tech-panel--${variant} ${className}`} style={baseStyle}>
      {/* Top accent line */}
      <div
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          height: 1,
          background: `linear-gradient(90deg, transparent, ${accentVar}, transparent)`,
          opacity: 0.7,
        }}
      />

      {title && (
        <div
          style={{
            padding: '10px 16px 0',
            fontSize: 'var(--font-size-xs)',
            fontFamily: 'var(--font-mono)',
            color: 'var(--text-secondary)',
            textTransform: 'uppercase',
            letterSpacing: '0.12em',
          }}
        >
          <span style={{ color: accentVar, marginRight: 8 }}>◆</span>
          {title}
        </div>
      )}

      <div style={{ padding: title ? '12px 16px 16px' : '16px' }}>
        {children}
      </div>
    </div>
  );
}
