import type { ReactNode } from 'react';

/**
 * FormRow — Horizontal flex row for side-by-side form fields.
 *
 * Each child gets flex: 1. Gap defaults to 12px.
 *
 * Usage:
 *   <FormRow>
 *     <FormField label="API Key"><FormInput ... /></FormField>
 *     <FormField label="Model"><FormInput ... /></FormField>
 *   </FormRow>
 */

export interface FormRowProps {
  children: ReactNode;
  gap?: number;
}

export function FormRow({ children, gap = 12 }: FormRowProps) {
  return <div className="form-row" style={{ gap }}>{children}</div>;
}
