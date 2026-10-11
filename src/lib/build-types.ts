/** Shapes shared by the build API and the browser UI. Safe to import from client code. */

export type JobState = "queued" | "building" | "completed" | "failed";
export type JobStage = "queued" | "preparing" | "building" | "verifying" | "done";

export interface StageTiming {
  stage: JobStage;
  startedAt: number;
  endedAt?: number;
}

/** A build result described as metadata, so the UI is not tied to "an APK" specifically. */
export interface ArtifactInfo {
  platform: "android";
  kind: "apk";
  signing: "debug";
  fileName: string;
  sizeBytes: number;
  downloadUrl: string;
}

export interface JobStatus {
  id: string;
  state: JobState;
  stage: JobStage;
  statusText: string;
  /** 0-100, approximate. */
  progress: number;
  /** 1 = next to build; null when not queued. */
  queuePosition: number | null;
  createdAt: number;
  startedAt: number | null;
  finishedAt: number | null;
  /** When the job and its artifact are deleted from the generator machine. */
  expiresAt: number | null;
  elapsedMs: number;
  stages: StageTiming[];
  error: { message: string; hint?: string } | null;
  /** Recent build output, with local paths removed. */
  log: string[];
  artifact: ArtifactInfo | null;
}

export interface EnvironmentCheckInfo {
  id: string;
  label: string;
  ok: boolean;
  detail: string;
  hint?: string;
}

export interface EnvironmentStatus {
  ready: boolean;
  checks: EnvironmentCheckInfo[];
  toolchain: { gradle: string; androidGradlePlugin: string; kotlin: string; compileSdk: number; jdk: string };
}

export interface ApiError {
  error: string;
  fields?: Record<string, string>;
  checks?: EnvironmentCheckInfo[];
}
