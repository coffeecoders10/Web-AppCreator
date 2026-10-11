"use client";

import { useCallback, useEffect, useState } from "react";
import type { EnvironmentStatus, JobStatus } from "@/lib/build-types";
import { ApiRequestError, fetchBuild, fetchEnvironment, startBuild } from "@/lib/client-api";
import { BuildStatus } from "./build-status/BuildStatus";
import { EnvironmentPanel } from "./build-status/EnvironmentPanel";
import { GeneratorForm, type FormSubmission } from "./generator-form/GeneratorForm";
import styles from "./GeneratorApp.module.css";

const POLL_INTERVAL_MS = 1500;
const MAX_CONSECUTIVE_POLL_FAILURES = 8;

export function GeneratorApp() {
  const [environment, setEnvironment] = useState<EnvironmentStatus | null>(null);
  const [environmentError, setEnvironmentError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);

  const [jobId, setJobId] = useState<string | null>(null);
  const [job, setJob] = useState<JobStatus | null>(null);
  const [starting, setStarting] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [serverErrors, setServerErrors] = useState<Record<string, string>>({});

  const checkEnvironment = useCallback(async (signal?: AbortSignal) => {
    setChecking(true);
    try {
      setEnvironment(await fetchEnvironment(signal));
      setEnvironmentError(null);
    } catch (error) {
      if (signal?.aborted) return;
      setEnvironmentError(error instanceof Error ? error.message : "Could not check the build environment.");
    } finally {
      if (!signal?.aborted) setChecking(false);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void checkEnvironment(controller.signal);
    return () => controller.abort();
  }, [checkEnvironment]);

  // Poll the build every ~1.5 s until it finishes; tolerate a few failed polls in a row.
  useEffect(() => {
    if (!jobId) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let failures = 0;

    const poll = async () => {
      try {
        const status = await fetchBuild(jobId, controller.signal);
        if (controller.signal.aborted) return;
        failures = 0;
        setJob(status);
        if (status.state === "completed" || status.state === "failed") return;
      } catch (error) {
        if (controller.signal.aborted) return;
        failures += 1;
        const lost = error instanceof ApiRequestError && error.status === 404;
        if (lost || failures >= MAX_CONSECUTIVE_POLL_FAILURES) {
          setProblem(lost ? (error as Error).message : "Lost contact with the generator while the build was running.");
          setJob(null);
          setJobId(null);
          return;
        }
      }
      timer = setTimeout(poll, POLL_INTERVAL_MS);
    };

    void poll();
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [jobId]);

  const handleSubmit = async ({ config, icon }: FormSubmission) => {
    setServerErrors({});
    setProblem(null);
    setJob(null);
    setStarting(true);
    try {
      const { id } = await startBuild(JSON.stringify(config), icon);
      setJobId(id);
    } catch (error) {
      if (error instanceof ApiRequestError) {
        if (error.body?.fields) setServerErrors(error.body.fields);
        if (error.body?.checks) void checkEnvironment();
        setProblem(error.message);
      } else {
        setProblem("Could not reach the generator. Is it still running?");
      }
    } finally {
      setStarting(false);
    }
  };

  const reset = () => {
    setJobId(null);
    setJob(null);
    setProblem(null);
  };

  const active = job !== null ? job.state === "queued" || job.state === "building" : jobId !== null;
  const blockedReason = environment && !environment.ready ? "Resolve the build environment issues first." : null;

  return (
    <div className={styles.layout}>
      <GeneratorForm busy={starting || active} blockedReason={blockedReason} serverErrors={serverErrors} onSubmit={handleSubmit} />
      <aside className={styles.side} aria-label="Build">
        <EnvironmentPanel environment={environment} error={environmentError} checking={checking} onRecheck={() => void checkEnvironment()} />
        <BuildStatus status={job} starting={starting || (jobId !== null && job === null)} problem={problem} onReset={reset} />
      </aside>
    </div>
  );
}
