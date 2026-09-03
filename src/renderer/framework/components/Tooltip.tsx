import { useState, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import type { ReactNode } from 'react';

type Placement = 'top' | 'bottom' | 'left' | 'right' | 'auto';

interface Props {
  text: string;
  variant?: 'solid' | 'glasses';
  /** Preferred placement. 'auto' picks the side with the most room. @default 'auto' */
  placement?: Placement;
  /** Max width before wrapping. @default 260 */
  maxWidth?: number;
  children: ReactNode;
}

interface Pos {
  x: number;
  y: number;
  originX: string;  // CSS transform-origin + translate
  originY: string;
}

const MARGIN = 8;

export function Tooltip({ text, variant = 'solid', placement = 'auto', maxWidth = 260, children }: Props) {
  const [visible, setVisible] = useState(false);
  const [pos, setPos] = useState<Pos>({ x: 0, y: 0, originX: '-50%', originY: '-100%' });
  const ref = useRef<HTMLSpanElement>(null);

  const show = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    // Estimate tooltip size (rough, refined by browser layout)
    const estW = Math.min(maxWidth, text.length * 8 + 24);
    const estH = Math.ceil(text.length * 8 / maxWidth) * 18 + 14;

    // Available space in each direction
    const space: Record<string, number> = {
      top: r.top - MARGIN,
      bottom: vh - r.bottom - MARGIN,
      left: r.left - MARGIN,
      right: vw - r.right - MARGIN,
    };

    let picked: string = placement;
    if (placement === 'auto') {
      // Pick the side with the most room
      picked = (Object.entries(space) as [string, number][])
        .sort((a, b) => b[1] - a[1])[0][0];
    }

    // Compute position
    let x: number, y: number, ox: string, oy: string;
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    const clampX = (v: number) => Math.max(MARGIN + estW / 2, Math.min(vw - MARGIN - estW / 2, v));

    switch (picked) {
      case 'top':
        x = clampX(cx); y = r.top - MARGIN;
        ox = '-50%'; oy = '-100%';
        break;
      case 'bottom':
        x = clampX(cx); y = r.bottom + MARGIN;
        ox = '-50%'; oy = '0';
        break;
      case 'left':
        x = r.left - MARGIN; y = cy;
        ox = '-100%'; oy = '-50%';
        break;
      case 'right':
        x = r.right + MARGIN; y = cy;
        ox = '0'; oy = '-50%';
        break;
      default:
        x = clampX(cx); y = r.top - MARGIN;
        ox = '-50%'; oy = '-100%';
    }

    setPos({ x, y, originX: ox, originY: oy });
    setVisible(true);
  }, [text, placement, maxWidth]);

  const hide = useCallback(() => setVisible(false), []);

  return (
    <>
      <span
        ref={ref}
        onMouseEnter={show}
        onMouseLeave={hide}
        style={{ display: 'inline-flex', position: 'relative' }}
      >
        {children}
      </span>
      {visible &&
        createPortal(
          <div
            className={`tooltip-popup tooltip-popup--${variant}`}
            style={{
              position: 'fixed',
              left: pos.x,
              top: pos.y,
              transform: `translate(${pos.originX}, ${pos.originY})`,
              maxWidth,
              wordBreak: 'break-word',
              padding: '6px 10px',
              borderRadius: 6,
              fontFamily: 'var(--font-sans)',
              fontSize: 'var(--font-size-xs)',
              fontWeight: 400,
              lineHeight: 1.4,
              pointerEvents: 'none',
              zIndex: 99999,
            }}
          >
            {text}
          </div>,
          document.body,
        )}
    </>
  );
}
