import { Select } from './Select';
import { THEME_OPTIONS, type ThemeId } from '../../shared/types';

/**
 * ThemeSelect — Convenience wrapper around Select for theme switching.
 *
 * Third-party developers who need a generic dropdown should use <Select>
 * directly with their own options. ThemeSelect is just THEME_OPTIONS pre-wired.
 */

interface Props {
  value: ThemeId;
  onChange: (v: ThemeId) => void;
}

export function ThemeSelect({ value, onChange }: Props) {
  return <Select options={THEME_OPTIONS} value={value} onChange={onChange} />;
}
