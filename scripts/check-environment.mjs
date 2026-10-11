// Usage: npm run check-env
// Verifies the local prerequisites for building Android APKs and prints how to fix anything missing.
import { checkAll, toolchain } from "./detect.mjs";

const { checks, ready } = checkAll();
console.log(`Website-to-App build environment (Gradle ${toolchain.gradle}, AGP ${toolchain.androidGradlePlugin}, Kotlin ${toolchain.kotlin}, compileSdk ${toolchain.compileSdk})\n`);
for (const check of checks) {
  console.log(`${check.ok ? "  ok  " : " FAIL "} ${check.label}${check.detail ? ` - ${check.detail}` : ""}`);
  if (check.hint) console.log(`        -> ${check.hint}`);
}
console.log(ready ? "\nReady to build." : "\nNot ready: fix the items marked FAIL (see README.md, section 'Setup').");
process.exit(ready ? 0 : 1);
