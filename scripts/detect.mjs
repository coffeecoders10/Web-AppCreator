// Shared by check-environment.mjs and build-template.mjs: finds the JDK and Android SDK.
// (The generator's own detection lives in src/lib/environment.ts; keep the two in step.)
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const templateDir = path.join(root, "templates", "android");
export const toolchain = JSON.parse(readFileSync(path.join(templateDir, "toolchain.json"), "utf-8"));

function subdirs(dir) {
  try {
    return readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => path.join(dir, e.name));
  } catch {
    return [];
  }
}

function javaMajor(executable) {
  // `java -version` prints to stderr, so read both streams.
  const result = spawnSync(executable, ["-version"], { encoding: "utf-8", timeout: 15000, windowsHide: true });
  return parseMajor(`${result.stdout ?? ""}${result.stderr ?? ""}`);
}

function parseMajor(text) {
  const match = /version "(\d+)(?:\.(\d+))?/.exec(text ?? "");
  if (!match) return null;
  return Number(match[1]) === 1 ? Number(match[2] ?? 0) : Number(match[1]);
}

export function findJava() {
  const exe = process.platform === "win32" ? "java.exe" : "java";
  const homes = [];
  if (process.env.JAVA_HOME) homes.push(process.env.JAVA_HOME);
  if (process.platform === "win32") {
    for (const base of [process.env["ProgramFiles"], process.env["ProgramFiles(x86)"]].filter(Boolean)) {
      for (const vendor of ["Eclipse Adoptium", "Java", "Microsoft", "Zulu", "Amazon Corretto", "BellSoft"]) homes.push(...subdirs(path.join(base, vendor)));
      homes.push(path.join(base, "Android", "Android Studio", "jbr"));
    }
  } else if (process.platform === "darwin") {
    for (const jvm of subdirs("/Library/Java/JavaVirtualMachines")) homes.push(path.join(jvm, "Contents", "Home"));
  } else {
    homes.push(...subdirs("/usr/lib/jvm"));
  }

  let unsupported = null;
  const candidates = [...homes.map((home) => ({ home, executable: path.join(home, "bin", exe) })), { home: null, executable: "java" }];
  for (const candidate of candidates) {
    if (candidate.home && !existsSync(candidate.executable)) continue;
    const major = javaMajor(candidate.executable);
    if (major === null) continue;
    if (major >= toolchain.jdk.min && major <= toolchain.jdk.max) return { ...candidate, major, unsupported };
    unsupported = Math.max(unsupported ?? 0, major);
  }
  return { home: null, executable: null, major: null, unsupported };
}

export function findSdk() {
  const candidates = [process.env.ANDROID_HOME, process.env.ANDROID_SDK_ROOT];
  if (process.platform === "win32") candidates.push(path.join(process.env.LOCALAPPDATA ?? "", "Android", "Sdk"));
  else if (process.platform === "darwin") candidates.push(path.join(os.homedir(), "Library", "Android", "sdk"));
  else candidates.push(path.join(os.homedir(), "Android", "Sdk"));
  return candidates.find((c) => c && existsSync(path.join(c, "platforms"))) ?? candidates.find((c) => c && existsSync(c)) ?? null;
}

/** Returns a list of { label, ok, detail, hint } plus the resolved locations. */
export function checkAll() {
  const checks = [];
  const add = (label, ok, detail, hint) => checks.push({ label, ok, detail, hint: ok ? undefined : hint });

  const nodeMajor = Number(process.versions.node.split(".")[0]);
  add("Node.js >= 20.9", nodeMajor >= 20, `Node ${process.versions.node}`, "Install Node.js 20.9 or newer.");

  const wrapper = process.platform === "win32" ? "gradlew.bat" : "gradlew";
  const missing = [wrapper, "gradle/wrapper/gradle-wrapper.jar", "settings.gradle.kts", "app/build.gradle.kts"].filter((f) => !existsSync(path.join(templateDir, f)));
  add("Android template", missing.length === 0, missing.length ? `missing ${missing.join(", ")}` : "templates/android is complete", "Restore templates/android from the repository.");

  const java = findJava();
  add(`JDK ${toolchain.jdk.min}-${toolchain.jdk.max}`, java.major !== null,
    java.major !== null ? `JDK ${java.major} (${java.home ?? "on PATH"})` : java.unsupported ? `found JDK ${java.unsupported}, unsupported` : "not found",
    `Install JDK ${toolchain.jdk.tested} (e.g. Eclipse Temurin) and set JAVA_HOME.`);

  const sdk = findSdk();
  add("Android SDK", sdk !== null, sdk ?? "not found", "Install the Android command-line tools and set ANDROID_HOME.");
  const has = (...p) => sdk !== null && existsSync(path.join(sdk, ...p));
  add(`SDK platform android-${toolchain.compileSdk}`, has("platforms", `android-${toolchain.compileSdk}`), "", `sdkmanager "platforms;android-${toolchain.compileSdk}"`);
  add(`Build-tools ${toolchain.buildTools}`, has("build-tools", toolchain.buildTools), "", `sdkmanager "build-tools;${toolchain.buildTools}"`);
  add("SDK licenses accepted", has("licenses", "android-sdk-license"), "", "sdkmanager --licenses");

  return { checks, java, sdk, ready: checks.every((c) => c.ok) };
}
