import type { InputHTMLAttributes } from 'react';

/**
 * FormInput — Pre-styled text / password / etc. input.
 *
 * Applies the theme-aware `form-input` CSS class. All standard
 * <input> props are forwarded.
 *
 * Usage:
 *   <FormInput type="text" value={name} onChange={...} placeholder="..." />
 *   <FormInput type="password" value={pw} onChange={...} />
 */

export function FormInput({ className = '', ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={`form-input ${className}`} {...props} />;
}
