import { errorResponse, json } from "@/lib/api-helpers";
import type { ApiError, JobStatus } from "@/lib/build-types";
import { getBuildManager } from "@/lib/build-manager";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const status = getBuildManager().status(id);
    if (!status) {
      return json<ApiError>({ error: "This build was not found. It may have expired or the generator was restarted." }, 404);
    }
    return json<JobStatus>(status);
  } catch (error) {
    return errorResponse(error);
  }
}
