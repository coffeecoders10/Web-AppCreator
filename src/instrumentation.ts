/**
 * Runs once when the Next.js server starts: clears build workspaces left over from a previous
 * run (jobs live only in memory, so nothing on disk can be recovered) and starts the expiry sweep.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { getBuildManager } = await import("./lib/build-manager");
  try {
    await getBuildManager().init();
  } catch (error) {
    console.error("[build] could not initialise the build folder:", error instanceof Error ? error.message : error);
  }
}
