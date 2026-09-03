/**
 * @ign/framework — Reusable UI components for the Ign desktop app.
 *
 * ## Style Variants
 * Every visual component accepts a `variant` prop:
 * - `"solid"` — opaque, high-contrast (Settings window)
 * - `"glasses"` — translucent, glass-morphism (Main / Orb windows)
 *
 * Each variant auto-adapts to the active theme (`dark` / `light`) via CSS custom properties.
 *
 * ## How to use
 * ```tsx
 * import { TitleBar, ActionDot, HintIcon, Tooltip, TechPanel } from './framework';
 * ```
 *
 * Third-party developers only need to care about layout & sizing — styles are handled
 * by the framework via `theme.css` design tokens.
 */

export { TitleBar }     from './components/TitleBar';
export { ActionDot }    from './components/ActionDot';
export type { DotColor } from './components/ActionDot';
export { HintIcon }     from './components/HintIcon';
export { Tooltip }      from './components/Tooltip';
export { TechPanel }    from './components/TechPanel';
export { Select }       from './components/Select';
export type { SelectOption } from './components/Select';

export { FormField }    from './components/FormField';
export { FormInput }    from './components/FormInput';
export { FormRow }      from './components/FormRow';
export { Checkbox }     from './components/Checkbox';
export { ToggleGroup }  from './components/ToggleGroup';
