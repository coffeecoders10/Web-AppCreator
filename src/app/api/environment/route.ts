import { detectEnvironment } from "@/lib/environment";
import { errorResponse, json } from "@/lib/api-helpers";
import type { EnvironmentStatus } from "@/lib/build-types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Reports whether the local build prerequisites look available. Contains no file system paths. */
export async function GET() {
  try {
    const report = await detectEnvironment();
    const { toolchain } = report;
    return json<EnvironmentStatus>({
      ready: report.ready,
      checks: report.checks,
      toolchain: {
        gradle: toolchain.gradle,
        androidGradlePlugin: toolchain.androidGradlePlugin,
        kotlin: toolchain.kotlin,
        compileSdk: toolchain.compileSdk,
        jdk: `${toolchain.jdk.min}-${toolchain.jdk.max}`,
      },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
