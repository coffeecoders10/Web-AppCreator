"use client";

import { useEffect, useRef } from "react";
import type { JobStage, JobStatus } from "@/lib/build-types";
import styles from "./BuildStatus.module.css";

interface BuildStatusProps {
  status: JobStatus | null;
  /** The build request is being sent; no job exists yet. */
  starting: boolean;
  /** A problem that prevented the build from starting, or from being tracked. */
  problem: string | null;
  onReset: () => void;
}

const STEPS: { stage: Exclude<JobStage, "queued" | "done">; label: string }[] = [
  { stage: "preparing", label: "Prepare the Android project" },
  { stage: "building", label: "Build with Gradle" },
  { stage: "verifying", label: "Verify the APK" },
];

export function formatDuration(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  const minutes = Math.floor(total / 60);
  return minutes > 0 ? `${minutes}m ${String(total % 60).padStart(2, "0")}s` : `${total}s`;
}

export function formatBytes(bytes: number): string {
  return bytes >= 1024 * 1024 ? `${(bytes / (1024 * 1024)).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

function stepState(step: (typeof STEPS)[number]["stage"], status: JobStatus): "done" | "active" | "failed" | "pending" {
  if (status.state === "completed") return "done";
  const order = STEPS.map((s) => s.stage);
  const current = order.indexOf(status.stage as (typeof order)[number]);
  const index = order.indexOf(step);
  if (current === -1) return "pending"; // still queued
  if (index < current) return "done";
  if (index === current) return status.state === "failed" ? "failed" : "active";
  return "pending";
}

export function BuildStatus({ status, starting, problem, onReset }: BuildStatusProps) {
  const logRef = useRef<HTMLPreElement>(null);
  const logLength = status?.log.length ?? 0;

  useEffect(() => {
    const el = logRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [logLength]);

  if (!status && !starting && !problem) return <Idle />;

  if (!status) {
    return (
      <section className={styles.panel} aria-labelledby="build-title">
        <h2 id="build-title" className={styles.title}>{problem ? "Build problem" : "Starting…"}</h2>
        {problem ? (
          <>
            <p className={styles.problem} role="alert">{problem}</p>
            <button type="button" className={styles.secondary} onClick={onReset}>Dismiss</button>
          </>
        ) : (
          <p className={styles.muted} role="status">Sending your settings to the local build queue.</p>
        )}
        <Notices />
      </section>
    );
  }

  const running = status.state === "queued" || status.state === "building";
  const title = status.state === "completed" ? "Your APK is ready" : status.state === "failed" ? "Build failed" : status.state === "queued" ? "Waiting in the queue" : "Building your app";

  return (
    <section className={styles.panel} aria-labelledby="build-title">
      <h2 id="build-title" className={styles.title}>{title}</h2>

      {running && (
        <>
          <div
            className={styles.bar}
            role="progressbar"
            aria-label="Build progress"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={status.progress}
          >
            <div className={styles.barFill} style={{ width: `${Math.max(status.progress, 3)}%` }} />
          </div>
          <p className={styles.statusLine} role="status">
            <span>
              {status.state === "queued" && status.queuePosition ? `Position ${status.queuePosition} in the queue` : status.statusText}
            </span>
            <span className={styles.elapsed}>{formatDuration(status.elapsedMs)}</span>
          </p>
        </>
      )}

      {status.state !== "queued" && (
        <ol className={styles.steps}>
          {STEPS.map((step) => {
            const state = stepState(step.stage, status);
            return (
              <li key={step.stage} className={`${styles.step} ${styles[state]}`} aria-current={state === "active" ? "step" : undefined}>
                <span className={styles.dot} aria-hidden="true" />
                <span>{step.label}</span>
                <span className="visually-hidden">{state === "done" ? " (done)" : state === "failed" ? " (failed)" : ""}</span>
              </li>
            );
          })}
        </ol>
      )}

      {status.state === "building" && status.stage === "building" && status.progress <= 12 && (
        <p className={styles.muted}>
          The first build can take several minutes while Gradle and the Android dependencies are downloaded. Later builds are much faster.
        </p>
      )}

      {status.state === "completed" && status.artifact && (
        <div className={styles.result}>
          <a className={styles.download} href={status.artifact.downloadUrl} download={status.artifact.fileName}>
            Download APK
          </a>
          <dl className={styles.meta}>
            <div><dt>File</dt><dd>{status.artifact.fileName}</dd></div>
            <div><dt>Size</dt><dd>{formatBytes(status.artifact.sizeBytes)}</dd></div>
            <div><dt>Built in</dt><dd>{formatDuration(status.elapsedMs)}</dd></div>
            {status.expiresAt && (
              <div><dt>Download until</dt><dd>{new Date(status.expiresAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</dd></div>
            )}
          </dl>
          <div className={styles.install}>
            <p>Install on a connected device or emulator:</p>
            <code>adb install -r {status.artifact.fileName}</code>
          </div>
          <button type="button" className={styles.secondary} onClick={onReset}>Build another</button>
        </div>
      )}

      {status.state === "failed" && (
        <div className={styles.failure}>
          <p className={styles.problem} role="alert">{status.error?.message ?? "The build failed."}</p>
          {status.error?.hint && <p className={styles.hint}>{status.error.hint}</p>}
          <button type="button" className={styles.secondary} onClick={onReset}>Back to settings</button>
        </div>
      )}

      {status.log.length > 0 && (
        <details className={styles.log} open={status.state === "failed"}>
          <summary>Build log</summary>
          <pre ref={logRef} tabIndex={0} aria-label="Build log">{status.log.join("\n")}</pre>
        </details>
      )}

      <Notices />
    </section>
  );
}

function Idle() {
  return (
    <section className={styles.panel} aria-labelledby="build-title">
      <h2 id="build-title" className={styles.title}>What happens next</h2>
      <ol className={styles.preview}>
        <li>Your settings are checked, then queued on this machine.</li>
        <li>A copy of the Android template is configured and built with Gradle.</li>
        <li>You download an APK that opens your website in a restricted-navigation WebView.</li>
      </ol>
      <p className={styles.muted}>The first build is slower because Gradle and the Android dependencies are resolved once.</p>
      <Notices />
    </section>
  );
}

function Notices() {
  return (
    <ul className={styles.notices}>
      <li>
        <strong>Debug-signed APK.</strong> For sideloading and testing, not for the Play Store.
      </li>
      <li>
        <strong>Temporary.</strong> Build jobs live in memory only; restarting the generator discards them, and files are deleted automatically after an hour.
      </li>
      <li>
        <strong>Needs internet.</strong> The app loads your live website; it does not bundle it.
      </li>
    </ul>
  );
}
