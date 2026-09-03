/* ═══════════════════════════════════════════════════════════════════
   types.ts — Enums, constants, and fundamental type aliases
   ═══════════════════════════════════════════════════════════════════ */

// ── Theme ─────────────────────────────────────────────────────────

/** All supported theme identifiers — single source of truth. */
export type ThemeId = 'dark' | 'light';

export const DEFAULT_THEME: ThemeId = 'dark';

export const THEME_OPTIONS: { id: ThemeId; label: string }[] = [
  { id: 'dark', label: '◆ Dark (Cyberpunk)' },
  { id: 'light', label: '◈ Light' },
];

// ── License ────────────────────────────────────────────────────────

export type LicenseSource = 'personal' | 'enterprise';

// ── App View State ─────────────────────────────────────────────────

export type AppView = 'loading' | 'settings' | 'main';
