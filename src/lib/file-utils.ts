import { randomBytes } from "node:crypto";
import { cp, mkdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

/** A problem caused by the request (bad input, queue full), as opposed to a server fault. */
export class UserInputError extends Error {
  constructor(
    message: string,
    readonly status = 400,
    readonly fields?: Record<string, string>,
  ) {
    super(message);
    this.name = "UserInputError";
  }
}

const JOB_ID = /^[a-f0-9]{32}$/;

export function isValidJobId(id: string): boolean {
  return JOB_ID.test(id);
}

/** Unpredictable job ID (128 bits). */
export function newJobId(): string {
  return randomBytes(16).toString("hex");
}

/**
 * The one directory all build workspaces and artifacts live under. Configurable with BUILD_ROOT,
 * otherwise a folder in the OS temp directory. Contents are wiped when the server starts.
 */
export function buildRoot(): string {
  const configured = process.env.BUILD_ROOT?.trim();
  // Runtime-configured folder; not something to trace into the server bundle.
  return path.resolve(/*turbopackIgnore: true*/ configured || path.join(os.tmpdir(), "website-to-app-builds"));
}

/** Resolves a job's directory and guarantees it stays inside the build root. */
export function jobDir(root: string, id: string): string {
  if (!isValidJobId(id)) throw new Error("Invalid job id.");
  const dir = path.join(root, id);
  assertInside(root, dir);
  return dir;
}

export function assertInside(root: string, target: string): void {
  const relative = path.relative(path.resolve(root), path.resolve(target));
  if (relative === "" || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("Path escapes the build root.");
  }
}

export function templateDir(): string {
  return path.join(process.cwd(), "templates", "android");
}

/** Deletes a directory tree, tolerating files that Windows still has locked for a moment. */
export async function removeDir(dir: string): Promise<void> {
  await rm(dir, { recursive: true, force: true, maxRetries: 6, retryDelay: 250 });
}

/** Empties (and creates) a directory without removing the directory itself. */
export async function resetDir(dir: string): Promise<void> {
  await removeDir(dir);
  await mkdir(dir, { recursive: true });
}

/** Copies the Android template, leaving out local build output and caches. */
export async function copyTemplate(source: string, destination: string): Promise<void> {
  const skipped = new Set([".gradle", "build", ".kotlin", ".idea", "captures"]);
  await cp(source, destination, {
    recursive: true,
    filter: (entry) => {
      const name = path.basename(entry);
      if (name === "local.properties" || name === "generator.properties") return false;
      return !skipped.has(name) || path.resolve(entry) === path.resolve(source);
    },
  });
}

/** Lower-case ASCII slug for file names: "My Reader!" -> "my-reader". */
export function slugify(value: string, fallback = "app"): string {
  const slug = value
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return slug || fallback;
}

/** Escapes text for an Android string resource (strings.xml). */
export function escapeAndroidString(value: string): string {
  const xml = value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\\/g, "\\\\")
    .replace(/'/g, "\\'")
    .replace(/"/g, '\\"');
  // A leading "@" or "?" would be read as a resource reference.
  return /^[@?]/.test(xml) ? `\\${xml}` : xml;
}

/** Escapes a value for a Java .properties file (non-ASCII as \uXXXX, specials backslashed). */
export function escapePropertiesValue(value: string): string {
  let out = "";
  for (const char of value) {
    const code = char.codePointAt(0)!;
    if (char === "\\" || char === ":" || char === "=" || char === "#" || char === "!") out += `\\${char}`;
    else if (code < 0x20 || code > 0x7e) {
      for (let i = 0; i < char.length; i++) out += `\\u${char.charCodeAt(i).toString(16).padStart(4, "0")}`;
    } else out += char;
  }
  return out;
}
