import type { ReactNode } from "react";
import styles from "./Field.module.css";

interface FieldProps {
  id: string;
  label: string;
  hint?: ReactNode;
  error?: string;
  optional?: boolean;
  children: ReactNode;
}

/** A labelled form control with a hint and an error message wired up for screen readers. */
export function Field({ id, label, hint, error, optional, children }: FieldProps) {
  return (
    <div className={styles.field}>
      <label className={styles.label} htmlFor={id}>
        {label}
        {optional && <span className={styles.optional}>optional</span>}
      </label>
      {children}
      {error ? (
        <p className={styles.error} id={`${id}-error`} role="alert">
          {error}
        </p>
      ) : hint ? (
        <p className={styles.hint} id={`${id}-hint`}>
          {hint}
        </p>
      ) : null}
    </div>
  );
}

/** Props to spread on the control so it points at the field's hint/error text. */
export function describedBy(id: string, error?: string, hint?: ReactNode) {
  return {
    "aria-invalid": error ? true : undefined,
    "aria-describedby": error ? `${id}-error` : hint ? `${id}-hint` : undefined,
  } as const;
}
