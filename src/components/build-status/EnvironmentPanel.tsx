"use client";

import type { EnvironmentStatus } from "@/lib/build-types";
import styles from "./EnvironmentPanel.module.css";

interface EnvironmentPanelProps {
  environment: EnvironmentStatus | null;
  /** Set when the /api/environment request itself failed. */
  error: string | null;
  checking: boolean;
  onRecheck: () => void;
}

export function EnvironmentPanel({ environment, error, checking, onRecheck }: EnvironmentPanelProps) {
  if (error) {
    return (
      <section className={`${styles.panel} ${styles.warn}`} aria-label="Build environment">
        <p className={styles.heading}>Can't reach the generator's API</p>
        <p className={styles.text}>{error}</p>
        <button type="button" className={styles.button} onClick={onRecheck} disabled={checking}>Check again</button>
      </section>
    );
  }

  if (!environment) {
    return (
      <section className={styles.panel} aria-label="Build environment" aria-busy="true">
        <p className={styles.text}>Checking local build tools…</p>
      </section>
    );
  }

  const failing = environment.checks.filter((check) => !check.ok);

  if (environment.ready) {
    return (
      <section className={`${styles.panel} ${styles.ok}`} aria-label="Build environment">
        <details>
          <summary>
            <span className={styles.badge} aria-hidden="true" />
            Local build tools ready
            <small>JDK · Android SDK {environment.toolchain.compileSdk}</small>
          </summary>
          <ul className={styles.list}>
            {environment.checks.map((check) => (
              <li key={check.id}>
                <span>{check.label}</span>
                <span className={styles.detail}>{check.detail}</span>
              </li>
            ))}
          </ul>
          <p className={styles.text}>
            Gradle {environment.toolchain.gradle} · AGP {environment.toolchain.androidGradlePlugin} · Kotlin {environment.toolchain.kotlin}
          </p>
        </details>
      </section>
    );
  }

  return (
    <section className={`${styles.panel} ${styles.warn}`} aria-label="Build environment" role="alert">
      <p className={styles.heading}>This machine can't build Android apps yet</p>
      <ul className={styles.problems}>
        {failing.map((check) => (
          <li key={check.id}>
            <strong>{check.label}:</strong> {check.detail}
            {check.hint && <span className={styles.fix}>{check.hint}</span>}
          </li>
        ))}
      </ul>
      <p className={styles.text}>See the README for the full setup, then check again.</p>
      <button type="button" className={styles.button} onClick={onRecheck} disabled={checking}>
        {checking ? "Checking…" : "Check again"}
      </button>
    </section>
  );
}
