/**
 * Detects the local Android build prerequisites (JDK, Android SDK, template, writable build
 * folder). The public report contains no file system paths; `locations` is for the server only.
 */
import { execFile } from "node:child_process";
import { access, mkdir, readdir, readFile, writeFile, rm } from "node:fs/promises";
import { constants } from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildRoot, templateDir } from "./file-utils";

export interface Toolchain {
  gradle: string;
  androidGradlePlugin: string;
  kotlin: string;
  compileSdk: number;
  targetSdk: number;
  minSdk: number;
  buildTools: string;
  jdk: { min: number; max: number; tested: number };
}

export interface EnvironmentCheck {
  id: "template" | "java" | "sdk" | "platform" | "buildTools" | "licenses" | "buildFolder";
  label: string;
  ok: boolean;
  detail: string;
  /** What to do when the check fails. */
  hint?: string;
}

export interface ToolLocations {
  /** Set when JAVA_HOME should be passed to Gradle; null means "use whatever java is on PATH". */
  javaHome: string | null;
  sdkRoot: string | null;
}

export interface EnvironmentReport {
  ready: boolean;
  checks: EnvironmentCheck[];
  toolchain: Toolchain;
  /** Server-side only. Never serialise this into an API response. */
  locations: ToolLocations;
}

export async function readToolchain(): Promise<Toolchain> {
  const file = path.join(templateDir(), "toolchain.json");
  return JSON.parse(await readFile(file, "utf-8")) as Toolchain;
}

const exists = (p: string) => access(p, constants.F_OK).then(() => true, () => false);

function run(command: string, args: string[]): Promise<string> {
  return new Promise((resolve) => {
    execFile(command, args, { timeout: 15_000, windowsHide: true }, (_error, stdout, stderr) => {
      resolve(`${stdout}\n${stderr}`);
    });
  });
}

/** Parses the major version out of `java -version` output ("17.0.2" -> 17, "1.8.0_352" -> 8). */
export function parseJavaMajor(output: string): number | null {
  const match = output.match(/version "(\d+)(?:\.(\d+))?/);
  if (!match) return null;
  const first = Number(match[1]);
  return first === 1 ? Number(match[2] ?? 0) : first;
}

interface JavaCandidate {
  home: string | null;
  executable: string;
}

async function listDirs(dir: string): Promise<string[]> {
  try {
    return (await readdir(dir, { withFileTypes: true })).filter((e) => e.isDirectory()).map((e) => path.join(dir, e.name));
  } catch {
    return [];
  }
}

async function javaCandidates(): Promise<JavaCandidate[]> {
  const exe = process.platform === "win32" ? "java.exe" : "java";
  const homes: string[] = [];
  if (process.env.JAVA_HOME) homes.push(process.env.JAVA_HOME);

  if (process.platform === "win32") {
    const programFiles = [process.env["ProgramFiles"], process.env["ProgramFiles(x86)"]].filter(Boolean) as string[];
    for (const base of programFiles) {
      for (const vendor of ["Eclipse Adoptium", "Java", "Microsoft", "Zulu", "Amazon Corretto", "BellSoft"]) {
        homes.push(...(await listDirs(path.join(/*turbopackIgnore: true*/ base, vendor))));
      }
      homes.push(path.join(base, "Android", "Android Studio", "jbr"));
    }
  } else if (process.platform === "darwin") {
    for (const jvm of await listDirs("/Library/Java/JavaVirtualMachines")) homes.push(path.join(jvm, "Contents", "Home"));
    homes.push("/Applications/Android Studio.app/Contents/jbr/Contents/Home");
  } else {
    homes.push(...(await listDirs("/usr/lib/jvm")));
  }

  const candidates: JavaCandidate[] = homes.map((home) => ({ home, executable: path.join(home, "bin", exe) }));
  candidates.push({ home: null, executable: "java" }); // whatever is on PATH
  return candidates;
}

interface JavaResult {
  found: JavaCandidate | null;
  major: number | null;
  /** The newest unsupported version seen, for the error message. */
  unsupported: number | null;
}

async function findJava(toolchain: Toolchain): Promise<JavaResult> {
  let unsupported: number | null = null;
  const seen = new Set<string>();
  for (const candidate of await javaCandidates()) {
    const key = candidate.executable.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    if (candidate.home && !(await exists(candidate.executable))) continue;
    const major = parseJavaMajor(await run(candidate.executable, ["-version"]));
    if (major === null) continue;
    if (major >= toolchain.jdk.min && major <= toolchain.jdk.max) return { found: candidate, major, unsupported };
    unsupported = Math.max(unsupported ?? 0, major);
  }
  return { found: null, major: null, unsupported };
}

async function findSdk(): Promise<string | null> {
  const candidates = [process.env.ANDROID_HOME, process.env.ANDROID_SDK_ROOT];
  if (process.platform === "win32") candidates.push(path.join(process.env.LOCALAPPDATA ?? "", "Android", "Sdk"));
  else if (process.platform === "darwin") candidates.push(path.join(os.homedir(), "Library", "Android", "sdk"));
  else candidates.push(path.join(os.homedir(), "Android", "Sdk"));
  for (const candidate of candidates) {
    if (candidate && (await exists(path.join(candidate, "platforms"))) ) return path.resolve(candidate);
  }
  for (const candidate of candidates) {
    if (candidate && (await exists(candidate))) return path.resolve(candidate);
  }
  return null;
}

async function isWritableDir(dir: string): Promise<boolean> {
  try {
    await mkdir(dir, { recursive: true });
    const probe = path.join(dir, `.write-test-${process.pid}`);
    await writeFile(probe, "ok");
    await rm(probe, { force: true });
    return true;
  } catch {
    return false;
  }
}

export async function detectEnvironment(): Promise<EnvironmentReport> {
  const toolchain = await readToolchain();
  const checks: EnvironmentCheck[] = [];
  const gradlew = process.platform === "win32" ? "gradlew.bat" : "gradlew";

  const template = templateDir();
  const templateFiles = [gradlew, "gradle/wrapper/gradle-wrapper.jar", "gradle/wrapper/gradle-wrapper.properties", "settings.gradle.kts", "app/build.gradle.kts"];
  const missing: string[] = [];
  for (const file of templateFiles) if (!(await exists(path.join(/*turbopackIgnore: true*/ template, file)))) missing.push(file);
  checks.push({
    id: "template",
    label: "Android template",
    ok: missing.length === 0,
    detail: missing.length === 0 ? "templates/android is complete" : `Missing: ${missing.join(", ")}`,
    hint: missing.length === 0 ? undefined : "Restore templates/android from the repository (it includes the Gradle wrapper).",
  });

  const java = await findJava(toolchain);
  const { min, max } = toolchain.jdk;
  checks.push({
    id: "java",
    label: `JDK ${min}-${max}`,
    ok: java.found !== null,
    detail: java.found
      ? `JDK ${java.major} found`
      : java.unsupported
        ? `Found JDK ${java.unsupported}, which this toolchain does not support`
        : "No JDK found",
    hint: java.found ? undefined : `Install a JDK ${toolchain.jdk.tested} (for example Eclipse Temurin) and set JAVA_HOME, or put it on PATH.`,
  });

  const sdkRoot = await findSdk();
  checks.push({
    id: "sdk",
    label: "Android SDK",
    ok: sdkRoot !== null,
    detail: sdkRoot ? "Android SDK found" : "Android SDK not found",
    hint: sdkRoot ? undefined : "Install the Android SDK command-line tools and set ANDROID_HOME (or ANDROID_SDK_ROOT).",
  });

  const platformOk = sdkRoot ? await exists(path.join(sdkRoot, "platforms", `android-${toolchain.compileSdk}`)) : false;
  checks.push({
    id: "platform",
    label: `SDK platform android-${toolchain.compileSdk}`,
    ok: platformOk,
    detail: platformOk ? "Installed" : "Not installed",
    hint: platformOk ? undefined : `Run: sdkmanager "platforms;android-${toolchain.compileSdk}"`,
  });

  const buildToolsOk = sdkRoot ? await exists(path.join(sdkRoot, "build-tools", toolchain.buildTools)) : false;
  checks.push({
    id: "buildTools",
    label: `Build-tools ${toolchain.buildTools}`,
    ok: buildToolsOk,
    detail: buildToolsOk ? "Installed" : "Not installed",
    hint: buildToolsOk ? undefined : `Run: sdkmanager "build-tools;${toolchain.buildTools}"`,
  });

  const licensesOk = sdkRoot ? await exists(path.join(sdkRoot, "licenses", "android-sdk-license")) : false;
  checks.push({
    id: "licenses",
    label: "SDK licenses accepted",
    ok: licensesOk,
    detail: licensesOk ? "Accepted" : "Not accepted",
    hint: licensesOk ? undefined : "Run: sdkmanager --licenses",
  });

  const folderOk = await isWritableDir(buildRoot());
  checks.push({
    id: "buildFolder",
    label: "Build folder writable",
    ok: folderOk,
    detail: folderOk ? "Writable" : "Not writable",
    hint: folderOk ? undefined : "Set BUILD_ROOT to a writable local folder.",
  });

  return {
    ready: checks.every((c) => c.ok),
    checks,
    toolchain,
    locations: { javaHome: java.found?.home ?? null, sdkRoot },
  };
}
