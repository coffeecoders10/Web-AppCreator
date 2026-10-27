/** Browser-side wrappers around the generator's own /api routes. */
import type { ApiError, EnvironmentStatus, JobStatus } from "./build-types";

export class ApiRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body?: ApiError,
  ) {
    super(message);
    this.name = "ApiRequestError";
  }
}

async function readJson<T>(response: Response): Promise<T> {
  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    // Non-JSON error bodies fall through to the generic message below.
  }
  if (!response.ok) {
    const apiError = body as ApiError | null;
    throw new ApiRequestError(apiError?.error ?? `Request failed (${response.status}).`, response.status, apiError ?? undefined);
  }
  return body as T;
}

export async function fetchEnvironment(signal?: AbortSignal): Promise<EnvironmentStatus> {
  return readJson<EnvironmentStatus>(await fetch("/api/environment", { cache: "no-store", signal }));
}

export async function startBuild(configJson: string, icon: File | null, iconBackground: string | null = null): Promise<{ id: string }> {
  const form = new FormData();
  form.set("config", configJson);
  if (icon) form.set("icon", icon);
  if (icon && iconBackground) form.set("iconBackground", iconBackground);
  return readJson<{ id: string }>(await fetch("/api/builds", { method: "POST", body: form }));
}

export async function fetchBuild(id: string, signal?: AbortSignal): Promise<JobStatus> {
  return readJson<JobStatus>(await fetch(`/api/builds/${id}`, { cache: "no-store", signal }));
}
