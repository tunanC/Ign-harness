import '../styles/action-dot.css';
import { Tooltip } from './Tooltip';
import type { ReactNode } from 'react';

export type DotColor = 'red' | 'yellow' | 'green' | 'purple';

interface Props {
  color: DotColor;
  label: string;
  variant?: 'solid' | 'glasses';
  children?: ReactNode;
  onClick: () => void;
}

const SOLID_BG: Record<DotColor, string> = {
  red: 'var(--danger)',
  yellow: 'var(--warning)',
  green: 'var(--success)',
  purple: 'var(--accent2)',
};

const GLOW_COLOR: Record<DotColor, string> = {
  red: 'rgba(255,77,106,0.6)',
  yellow: 'rgba(251,191,36,0.6)',
  green: 'rgba(34,211,160,0.6)',
  purple: 'rgba(168,85,247,0.6)',
};

const GLASSES_GLOW: Record<DotColor, string> = {
  red: 'rgba(255,77,106,0.45)',
  yellow: 'rgba(251,191,36,0.45)',
  green: 'rgba(34,211,160,0.45)',
  purple: 'rgba(168,85,247,0.45)',
};

export function ActionDot({ color, label, variant = 'solid', children, onClick }: Props) {
  const isGlasses = variant === 'glasses';

  const solidStyle: React.CSSProperties = {
    background: SOLID_BG[color],
    border: 'none',
  };

  const glassesStyle: React.CSSProperties = {
  };

  return (
    <Tooltip text={label} variant={variant}>
      <button
        className={`action-dot action-dot--${variant}`}
        style={{
          ...(isGlasses ? glassesStyle : solidStyle),
          '--glow': isGlasses ? GLASSES_GLOW[color] : GLOW_COLOR[color],
        } as React.CSSProperties}
        onClick={onClick}
      >
        {children}
      </button>
    </Tooltip>
  );
}
