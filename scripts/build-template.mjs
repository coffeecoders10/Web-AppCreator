// Usage: npm run build:template
// Builds templates/android on its own (unit tests + debug APK). Run it once after setup to verify
// the toolchain and to fill the Gradle caches, so the first build from the web UI is fast.
import { spawn } from "node:child_process";
import { checkAll, templateDir } from "./detect.mjs";

const { ready, checks, java, sdk } = checkAll();
if (!ready) {
  for (const check of checks.filter((c) => !c.ok)) console.error(`FAIL ${check.label}${check.hint ? ` -> ${check.hint}` : ""}`);
  console.error("\nRun `npm run check-env` for details.");
  process.exit(1);
}

const env = { ...process.env, ANDROID_HOME: sdk, ANDROID_SDK_ROOT: sdk };
if (java.home) env.JAVA_HOME = java.home;

// Constant arguments only. On Windows the wrapper is a .bat file, which Node can only start via a shell.
const args = ["testDebugUnitTest", "assembleDebug", "--console=plain"];
const child =
  process.platform === "win32"
    ? spawn(`.\\gradlew.bat ${args.join(" ")}`, { cwd: templateDir, env, shell: true, stdio: "inherit" })
    : spawn("./gradlew", args, { cwd: templateDir, env, stdio: "inherit" });

child.on("close", (code) => {
  if (code === 0) console.log("\nTemplate built: templates/android/app/build/outputs/apk/debug/app-debug.apk");
  process.exit(code ?? 1);
});
