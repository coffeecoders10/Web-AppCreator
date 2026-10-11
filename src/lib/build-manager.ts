/**
 * In-memory job registry and a one-at-a-time build queue. There is deliberately no database:
 * state lives in this Node process, files live under one local build folder, and both are
 * discarded on expiry and on restart.
 */
import { mkdir, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { AppConfig } from "./config";
import { BuildError, buildAndroidApk, killActiveBuilds, type ArtifactMeta, type BuildStage } from "./android-builder";
import type { JobStage, JobState, JobStatus, StageTiming } from "./build-types";
import { buildRoot, jobDir, newJobId, removeDir, resetDir, UserInputError, isValidJobId } from "./file-utils";

const MARKER_FILE = ".website-to-app-builds";
const MAX_LOG_LINES = 300;
const MAX_LOG_BYTES = 100 * 1024;
const STATUS_LOG_LINES = 150;
/** Roughly how many `:app:` Gradle tasks an assembleDebug runs; only used for a progress estimate. */
const EXPECTED_TASKS = 38;

interface Job {
  id: string;
  state: JobState;
  stage: JobStage;
  statusText: string;
  createdAt: number;
  startedAt: number | null;
  finishedAt: number | null;
  expiresAt: number | null;
  stages: StageTiming[];
  taskCount: number;
  error: { message: string; hint?: string } | null;
  log: string[];
  logBytes: number;
  artifact: ArtifactMeta | null;
  config: AppConfig;
  iconPng: Buffer | null;
}

function numberFromEnv(name: string, fallback: number, min: number): number {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value >= min ? value : fallback;
}

export class BuildManager {
  private jobs = new Map<string, Job>();
  private queue: string[] = [];
  private running: string | null = null;
  private initPromise: Promise<void> | null = null;

  private get maxQueued() {
    return numberFromEnv("MAX_QUEUED_BUILDS", 3, 0);
  }
  private get ttlMs() {
    return numberFromEnv("JOB_TTL_MINUTES", 60, 1) * 60_000;
  }

  /** Wipes leftovers from a previous run, starts the expiry sweep and installs shutdown hooks. Idempotent. */
  init(): Promise<void> {
    this.initPromise ??= this.doInit();
    return this.initPromise;
  }

  private async doInit(): Promise<void> {
    const root = buildRoot();
    let entries: string[] = [];
    try {
      entries = await readdir(root);
    } catch {
      // Does not exist yet; created below.
    }
    // Never wipe a folder this tool did not create: BUILD_ROOT may have been pointed somewhere precious.
    if (entries.length > 0 && !entries.includes(MARKER_FILE)) {
      throw new Error("BUILD_ROOT already contains files that were not created by this tool, so it was left untouched. Point BUILD_ROOT at an empty or dedicated folder.");
    }
    await resetDir(root);
    await mkdir(root, { recursive: true });
    await writeFile(path.join(root, MARKER_FILE), "Temporary build workspaces. Safe to delete.\n");

    setInterval(() => void this.sweep(), 60_000).unref();
    process.once("exit", killActiveBuilds);
    for (const signal of ["SIGINT", "SIGTERM"] as const) {
      process.once(signal, () => {
        killActiveBuilds();
        process.exit(0);
      });
    }
  }

  /** Queues a build, or throws a 429 UserInputError when the queue is full. */
  async enqueue(config: AppConfig, iconPng: Buffer | null): Promise<string> {
    await this.init();
    const waiting = this.queue.length;
    if (this.running !== null && waiting >= this.maxQueued) {
      throw new UserInputError(`The build queue is full (${this.maxQueued} waiting). Try again when a build finishes.`, 429);
    }
    const job: Job = {
      id: newJobId(),
      state: "queued",
      stage: "queued",
      statusText: this.running ? "Waiting for the current build to finish" : "Starting",
      createdAt: Date.now(),
      startedAt: null,
      finishedAt: null,
      expiresAt: null,
      stages: [{ stage: "queued", startedAt: Date.now() }],
      taskCount: 0,
      error: null,
      log: [],
      logBytes: 0,
      artifact: null,
      config,
      iconPng,
    };
    this.jobs.set(job.id, job);
    this.queue.push(job.id);
    void this.processQueue();
    return job.id;
  }

  status(id: string): JobStatus | null {
    if (!isValidJobId(id)) return null;
    const job = this.jobs.get(id);
    return job ? this.toStatus(job) : null;
  }

  /** The artifact for a completed job, or null. */
  artifact(id: string): ArtifactMeta | null {
    if (!isValidJobId(id)) return null;
    const job = this.jobs.get(id);
    return job?.state === "completed" ? job.artifact : null;
  }

  private async processQueue(): Promise<void> {
    if (this.running !== null) return;
    const id = this.queue.shift();
    if (!id) return;
    const job = this.jobs.get(id);
    if (!job) return void this.processQueue();

    this.running = id;
    try {
      await this.run(job);
    } finally {
      this.running = null;
      job.iconPng = null;
      void this.processQueue();
    }
  }

  private async run(job: Job): Promise<void> {
    const dir = jobDir(buildRoot(), job.id);
    const workDir = path.join(dir, "work");
    const artifactDir = path.join(dir, "artifact");
    job.startedAt = Date.now();
    job.state = "building";
    this.endStage(job);

    try {
      await mkdir(workDir, { recursive: true });
      const artifact = await buildAndroidApk({
        config: job.config,
        iconPng: job.iconPng,
        workDir,
        artifactDir,
        setStage: (stage, text) => this.setStage(job, stage, text),
        onTask: (task) => {
          job.taskCount += 1;
          job.statusText = `Building: ${task}`;
        },
        log: (line) => this.appendLog(job, line),
      });
      job.artifact = artifact;
      job.state = "completed";
      job.stage = "done";
      job.statusText = "Your APK is ready";
    } catch (error) {
      job.state = "failed";
      if (error instanceof BuildError) {
        job.error = { message: error.message, hint: error.hint };
      } else {
        console.error("[build] unexpected failure", error);
        job.error = { message: "The build failed unexpectedly.", hint: "Check the generator's server console for details." };
      }
      job.statusText = "Build failed";
    } finally {
      this.endStage(job);
      job.finishedAt = Date.now();
      job.expiresAt = job.finishedAt + this.ttlMs;
      // The workspace is large and no longer needed; only the APK is kept until expiry.
      await removeDir(workDir).catch(() => undefined);
    }
  }

  private setStage(job: Job, stage: BuildStage, text: string): void {
    this.endStage(job);
    job.stage = stage;
    job.statusText = text;
    job.stages.push({ stage, startedAt: Date.now() });
  }

  private endStage(job: Job): void {
    const last = job.stages[job.stages.length - 1];
    if (last && last.endedAt === undefined) last.endedAt = Date.now();
  }

  private appendLog(job: Job, line: string): void {
    job.log.push(line);
    job.logBytes += line.length + 1;
    while (job.log.length > MAX_LOG_LINES || job.logBytes > MAX_LOG_BYTES) {
      const dropped = job.log.shift();
      if (dropped === undefined) break;
      job.logBytes -= dropped.length + 1;
    }
  }

  private progress(job: Job): number {
    if (job.state === "completed") return 100;
    switch (job.stage) {
      case "queued":
        return 0;
      case "preparing":
        return 5;
      case "building":
        return Math.min(90, 10 + Math.round((job.taskCount / EXPECTED_TASKS) * 80));
      case "verifying":
        return 95;
      default:
        return job.state === "failed" ? Math.min(90, 10 + Math.round((job.taskCount / EXPECTED_TASKS) * 80)) : 100;
    }
  }

  private toStatus(job: Job): JobStatus {
    const now = Date.now();
    const position = this.queue.indexOf(job.id);
    return {
      id: job.id,
      state: job.state,
      stage: job.stage,
      statusText: job.statusText,
      progress: this.progress(job),
      queuePosition: position === -1 ? null : position + 1,
      createdAt: job.createdAt,
      startedAt: job.startedAt,
      finishedAt: job.finishedAt,
      expiresAt: job.expiresAt,
      elapsedMs: (job.finishedAt ?? now) - (job.startedAt ?? job.createdAt),
      stages: job.stages.map((s) => ({ ...s })),
      error: job.error,
      log: job.log.slice(-STATUS_LOG_LINES),
      artifact: job.artifact
        ? {
            platform: job.artifact.platform,
            kind: job.artifact.kind,
            signing: job.artifact.signing,
            fileName: job.artifact.fileName,
            sizeBytes: job.artifact.sizeBytes,
            downloadUrl: `/api/builds/${job.id}/download`,
          }
        : null,
    };
  }

  /** Deletes jobs (and their files) whose expiry time has passed. Exposed for tests. */
  async sweep(now = Date.now()): Promise<number> {
    let removed = 0;
    for (const [id, job] of this.jobs) {
      if (job.expiresAt !== null && now >= job.expiresAt) {
        this.jobs.delete(id);
        await removeDir(jobDir(buildRoot(), id)).catch(() => undefined);
        removed += 1;
      }
    }
    return removed;
  }
}

declare global {
  // eslint-disable-next-line no-var
  var __websiteToAppBuildManager: BuildManager | undefined;
}

/** One manager per Node process, even if the module is bundled more than once (dev server). */
export function getBuildManager(): BuildManager {
  globalThis.__websiteToAppBuildManager ??= new BuildManager();
  return globalThis.__websiteToAppBuildManager;
}
