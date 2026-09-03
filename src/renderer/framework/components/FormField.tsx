import type { ReactNode } from 'react';

/**
 * FormField — Labeled form control wrapper with dot indicator.
 *
 * Renders a label with ◆ dot + spacing, wrapping any child control.
 * The bottom margin is fixed at 12px — set `last` to remove it.
 *
 * Usage:
 *   <FormField label="API Key">
 *     <FormInput type="password" ... />
 *   </FormField>
 *   <FormField label="Model" last>
 *     <FormInput type="text" ... />
 *   </FormField>
 */

export interface FormFieldProps {
  label: string;
  children: ReactNode;
  /** Set true on the last field in a group to remove bottom margin. */
  last?: boolean;
}

export function FormField({ label, children, last = false }: FormFieldProps) {
  return (
    <div className="form-group" style={{ marginBottom: last ? 0 : 12 }}>
      <label className="form-label">
        <span className="label-dot" />
        {label}
      </label>
      {children}
    </div>
  );
}
