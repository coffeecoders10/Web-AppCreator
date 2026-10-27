/**
 * Android-specific build steps: parameterize a copy of templates/android, run the checked-in
 * Gradle wrapper (`assembleDebug`), verify the APK and hand it back as artifact metadata.
 * Everything Android lives here so a future iOS builder can sit next to it.
 */
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { chmod, copyFile, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { AppConfig } from "./config";
import { startHost } from "./config";
import { detectEnvironment, type EnvironmentReport } from "./environment";
import {
  buildRoot,
  copyTemplate,
  escapeAndroidString,
  escapePropertiesValue,
  slugify,
  templateDir,
} from "./file-utils";
import { buildLauncherIcons } from "./icon";

export type BuildStage = "preparing" | "building" | "verifying";

/** What a finished build produced. Modelled as metadata so non-APK artifacts can follow later. */
export interface ArtifactMeta {
  platform: "android";
  kind: "apk";
  signing: "debug";
  fileName: string;
  filePath: string;
  sizeBytes: number;
  contentType: string;
}

export interface BuildContext {
  config: AppConfig;
  iconPng: Buffer | null;
  iconBackground: string | null;
  workDir: string;
  artifactDir: string;
  setStage(stage: BuildStage, statusText: string): void;
  /** Called with each Gradle task name as it starts (used for progress). */
  onTask(task: string): void;
  log(line: string): void;
}

/** A failed build, with a plain-language hint where we recognise the cause. */
export class BuildError extends Error {
  constructor(
    message: string,
    readonly hint?: string,
  ) {
    super(message);
    this.name = "BuildError";
  }
}

const APK_CONTENT_TYPE = "application/vnd.android.package-archive";
const MIN_APK_BYTES = 50 * 1024;

const activeChildren = new Set<ChildProcess>();

/** Kills every running Gradle process tree. Called when the generator itself shuts down. */
export function killActiveBuilds(): void {
  for (const child of activeChildren) killTree(child);
}

function killTree(child: ChildProcess): void {
  if (!child.pid) return;
  try {
    if (process.platform === "win32") {
      spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], { windowsHide: true });
    } else {
      process.kill(-child.pid, "SIGKILL"); // negative pid: the whole process group (see detached below)
    }
  } catch {
    child.kill("SIGKILL");
  }
}

export async function buildAndroidApk(ctx: BuildContext): Promise<ArtifactMeta> {
  const env = await detectEnvironment();
  if (!env.ready) {
    const failing = env.checks.filter((c) => !c.ok);
    throw new BuildError(
      `The build environment is not ready: ${failing.map((c) => c.label).join(", ")}.`,
      failing.map((c) => c.hint).filter(Boolean).join(" "),
    );
  }

  ctx.setStage("preparing", "Preparing the Android project");
  await prepareWorkspace(ctx, env);

  ctx.setStage("building", "Starting Gradle");
  await runGradle(ctx, env);

  ctx.setStage("verifying", "Checking the APK");
  return collectApk(ctx);
}

async function prepareWorkspace(ctx: BuildContext, env: EnvironmentReport): Promise<void> {
  const { config, workDir } = ctx;
  await copyTemplate(templateDir(), workDir);
  if (process.platform !== "win32") await chmod(path.join(workDir, "gradlew"), 0o755);

  // 1. The runtime configuration the app reads at launch. Validated input only: no paths, no secrets.
  const assets = path.join(workDir, "app", "src", "main", "assets");
  await mkdir(assets, { recursive: true });
  await writeFile(path.join(assets, "app-config.json"), `${JSON.stringify(config, null, 2)}\n`, "utf-8");

  // 2. Application ID, version and orientation, read by app/build.gradle.kts. Written to a file
  //    (never the command line) so no user text is ever part of a process invocation.
  const properties = [
    `applicationId=${escapePropertiesValue(config.app.applicationId)}`,
    `versionName=${escapePropertiesValue(config.app.versionName)}`,
    `versionCode=${config.app.versionCode}`,
    `screenOrientation=${config.appearance.orientation === "auto" ? "unspecified" : "portrait"}`,
  ];
  await writeFile(path.join(workDir, "generator.properties"), `${properties.join("\n")}\n`, "utf-8");

  // 3. SDK location for Gradle (workspace only; it is not packaged into the APK).
  await writeFile(path.join(workDir, "local.properties"), `sdk.dir=${escapePropertiesValue(env.locations.sdkRoot!)}\n`, "utf-8");

  // 4. App label.
  const stringsFile = path.join(workDir, "app", "src", "main", "res", "values", "strings.xml");
  const strings = await readFile(stringsFile, "utf-8");
  const label = escapeAndroidString(config.app.name);
  const updated = strings.replace(/(<string name="app_name">)[^<]*(<\/string>)/, (_m, open: string, close: string) => `${open}${label}${close}`);
  if (updated === strings && !strings.includes(`>${label}<`)) throw new BuildError("The template is missing its app_name string.");
  await writeFile(stringsFile, updated, "utf-8");

  // 5. Launcher icons: drop the template's default icon and write the generated set.
  const res = path.join(workDir, "app", "src", "main", "res");
  await rm(path.join(res, "mipmap-anydpi"), { recursive: true, force: true });
  await rm(path.join(res, "mipmap-anydpi-v26"), { recursive: true, force: true });
  await rm(path.join(res, "drawable", "ic_launcher_foreground.xml"), { force: true });
  await rm(path.join(res, "values", "ic_launcher_background.xml"), { force: true });
  for (const file of await buildLauncherIcons(ctx.iconPng, config.app.name, ctx.iconBackground)) {
    const target = path.join(res, file.path);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, file.content);
  }

  // 6. A chosen icon background colour also paints the status bar, navigation bar and the area behind them.
  if (ctx.iconPng && ctx.iconBackground) await applySystemBarColor(res, ctx.iconBackground);
}

/** Adds the colour to both theme variants, with light or dark bar icons picked for contrast. */
async function applySystemBarColor(res: string, hex: string): Promise<void> {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  const lightBackground = (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.6;
  const items = [
    `<item name="android:colorBackground">${hex}</item>`,
    `<item name="android:statusBarColor">${hex}</item>`,
    `<item name="android:navigationBarColor">${hex}</item>`,
    `<item name="android:windowLightNavigationBar">${lightBackground}</item>`,
  ].join("\n        ");
  for (const dir of ["values", "values-night"]) {
    const file = path.join(res, dir, "themes.xml");
    const xml = await readFile(file, "utf-8");
    const patched = xml
      .replace(/(<item name="android:windowLightStatusBar">)[^<]*(<\/item>)/, `$1${lightBackground}$2`)
      .replace("</style>", `    ${items}\n    </style>`);
    if (patched === xml) throw new BuildError("The template theme could not be updated with the icon colour.");
    await writeFile(file, patched, "utf-8");
  }
}

function runGradle(ctx: BuildContext, env: EnvironmentReport): Promise<void> {
  const timeoutMs = Number(process.env.BUILD_TIMEOUT_MINUTES ?? 20) * 60_000;
  const sanitize = makeSanitizer([
    [ctx.workDir, "<workspace>"],
    [templateDir(), "<template>"],
    [buildRoot(), "<builds>"],
    ...(env.locations.sdkRoot ? ([[env.locations.sdkRoot, "<android-sdk>"]] as [string, string][]) : []),
    ...(env.locations.javaHome ? ([[env.locations.javaHome, "<jdk>"]] as [string, string][]) : []),
    [os.homedir(), "~"],
  ]);

  const gradleArgs = ["assembleDebug", "--console=plain"];
  if (process.env.GRADLE_DAEMON !== "1") gradleArgs.push("--no-daemon");
  if (process.env.GRADLE_OFFLINE === "1") gradleArgs.push("--offline");

  const childEnv: NodeJS.ProcessEnv = { ...process.env, ANDROID_HOME: env.locations.sdkRoot!, ANDROID_SDK_ROOT: env.locations.sdkRoot! };
  if (env.locations.javaHome) childEnv.JAVA_HOME = env.locations.javaHome;

  // The wrapper script checked into templates/android. On Windows it is a .bat file, which Node
  // can only start through a shell; the command string below consists solely of constants and
  // contains none of the user's input, and the working directory is passed as an option.
  const child =
    process.platform === "win32"
      ? spawn(`.\\gradlew.bat ${gradleArgs.join(" ")}`, { cwd: ctx.workDir, env: childEnv, shell: true, windowsHide: true })
      : spawn("./gradlew", gradleArgs, { cwd: ctx.workDir, env: childEnv, detached: true });
  activeChildren.add(child);

  return new Promise<void>((resolve, reject) => {
    const output: string[] = [];
    let timedOut = false;
    let settled = false;

    const timer = setTimeout(() => {
      timedOut = true;
      killTree(child);
    }, timeoutMs);

    const handleLine = (raw: string) => {
      const line = sanitize(raw.replace(/\u001b\[[0-9;]*[A-Za-z]/g, "")).slice(0, 500);
      if (!line.trim()) return;
      output.push(line);
      if (output.length > 400) output.shift();
      ctx.log(line);
      const task = line.match(/^> Task :app:(\S+)/);
      if (task) ctx.onTask(task[1]);
    };

    const attach = (stream: NodeJS.ReadableStream | null) => {
      if (!stream) return;
      let pending = "";
      stream.setEncoding("utf-8");
      stream.on("data", (chunk: string) => {
        pending += chunk;
        const lines = pending.split(/\r?\n/);
        pending = lines.pop() ?? "";
        lines.forEach(handleLine);
      });
      stream.on("end", () => pending && handleLine(pending));
    };
    attach(child.stdout);
    attach(child.stderr);

    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      activeChildren.delete(child);
      if (error) reject(error);
      else resolve();
    };

    child.on("error", (error) => finish(new BuildError(`Could not start Gradle: ${sanitize(error.message)}`)));
    child.on("close", (code) => {
      if (timedOut) {
        finish(new BuildError(`The build did not finish within ${Math.round(timeoutMs / 60_000)} minutes and was stopped.`, "The first build downloads Gradle and Android dependencies; set BUILD_TIMEOUT_MINUTES higher or run the template build once first."));
      } else if (code === 0) {
        finish();
      } else {
        finish(explainFailure(code, output.join("\n")));
      }
    });
  });
}

/** Turns a Gradle failure into a short message plus a hint for the causes people actually hit. */
export function explainFailure(code: number | null, output: string): BuildError {
  const message = `Gradle failed with exit code ${code ?? "unknown"}.`;
  if (/have not accepted the license|licen[cs]e.*not accepted/i.test(output)) {
    return new BuildError(message, "Accept the Android SDK licenses: run `sdkmanager --licenses`.");
  }
  if (/SDK location not found|ANDROID_HOME/i.test(output)) {
    return new BuildError(message, "Gradle could not find the Android SDK. Set ANDROID_HOME and restart the generator.");
  }
  if (/UnknownHostException|Could not resolve|Could not GET|Could not HEAD|Connection timed out|SSLHandshake|Read timed out/i.test(output)) {
    return new BuildError(message, "Gradle could not download a dependency. The first build needs internet access; check your connection or proxy, then try again.");
  }
  if (/OutOfMemoryError|Java heap space|Metaspace/i.test(output)) {
    return new BuildError(message, "Gradle ran out of memory. Close other applications or raise org.gradle.jvmargs in templates/android/gradle.properties.");
  }
  if (/Unsupported class file major version|requires Java|JVM.*(not|isn't) compatible|Could not target platform/i.test(output)) {
    return new BuildError(message, "The JDK version is not compatible with this toolchain. Use JDK 17 (see the README).");
  }
  return new BuildError(message, "See the build log below for the first error.");
}

async function collectApk(ctx: BuildContext): Promise<ArtifactMeta> {
  const apk = path.join(ctx.workDir, "app", "build", "outputs", "apk", "debug", "app-debug.apk");
  let size: number;
  try {
    size = (await stat(apk)).size;
  } catch {
    throw new BuildError("Gradle reported success but no APK was produced.");
  }
  const header = (await readFile(apk)).subarray(0, 4);
  if (size < MIN_APK_BYTES || header[0] !== 0x50 || header[1] !== 0x4b) {
    throw new BuildError("The build produced a file that does not look like a valid APK.");
  }

  const base = slugify(ctx.config.app.name, slugify(startHost(ctx.config.app.startUrl) ?? "app"));
  const fileName = `${base}-${ctx.config.app.versionName}-debug.apk`;
  await mkdir(ctx.artifactDir, { recursive: true });
  const filePath = path.join(ctx.artifactDir, fileName);
  await copyFile(apk, filePath);
  return { platform: "android", kind: "apk", signing: "debug", fileName, filePath, sizeBytes: size, contentType: APK_CONTENT_TYPE };
}

/** Replaces local absolute paths in log text so logs are safe to show in the browser. */
function makeSanitizer(replacements: [string, string][]): (text: string) => string {
  const variants: [string, string][] = [];
  for (const [from, to] of replacements) {
    if (!from) continue;
    const resolved = path.resolve(from);
    variants.push([resolved, to], [resolved.replace(/\\/g, "/"), to]);
  }
  variants.sort((a, b) => b[0].length - a[0].length);
  return (text) => {
    let out = text;
    for (const [from, to] of variants) out = out.split(from).join(to);
    return out;
  };
}
