import type { ReactNode } from "react";
import styles from "./Toggle.module.css";

interface ToggleProps {
  id: string;
  label: string;
  description?: ReactNode;
  checked: boolean;
  disabled?: boolean;
  error?: string;
  onChange: (checked: boolean) => void;
}

/** An on/off switch built on a real checkbox, so keyboard and screen-reader behaviour comes for free. */
export function Toggle({ id, label, description, checked, disabled, error, onChange }: ToggleProps) {
  return (
    <div className={styles.row}>
      <input
        id={id}
        className={styles.input}
        type="checkbox"
        role="switch"
        checked={checked}
        disabled={disabled}
        aria-describedby={description ? `${id}-description` : undefined}
        aria-invalid={error ? true : undefined}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span className={styles.track} aria-hidden="true" />
      <label className={styles.text} htmlFor={id}>
        <span className={styles.label}>{label}</span>
        {description && (
          <span className={styles.description} id={`${id}-description`}>
            {description}
          </span>
        )}
      </label>
      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
