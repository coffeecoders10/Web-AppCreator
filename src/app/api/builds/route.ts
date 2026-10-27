import { assertSameOrigin, errorResponse, json } from "@/lib/api-helpers";
import type { ApiError } from "@/lib/build-types";
import { getBuildManager } from "@/lib/build-manager";
import { validateConfig } from "@/lib/config";
import { detectEnvironment } from "@/lib/environment";
import { UserInputError } from "@/lib/file-utils";
import { MAX_ICON_BYTES, parseIconBackground, validateIcon } from "@/lib/icon";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_CONFIG_BYTES = 64 * 1024;
const MAX_REQUEST_BYTES = MAX_ICON_BYTES + MAX_CONFIG_BYTES + 64 * 1024;

/**
 * Validates multipart input (a `config` JSON field and an optional `icon` PNG file) and queues one
 * Android build. Returns the job ID immediately; the build runs in the background.
 */
export async function POST(request: Request) {
  try {
    assertSameOrigin(request);

    const declared = Number(request.headers.get("content-length"));
    if (Number.isFinite(declared) && declared > MAX_REQUEST_BYTES) {
      throw new UserInputError("The upload is too large.", 413);
    }

    let form: FormData;
    try {
      form = await request.formData();
    } catch {
      throw new UserInputError("Send the build request as multipart form data.");
    }

    const rawConfig = form.get("config");
    if (typeof rawConfig !== "string" || rawConfig.length > MAX_CONFIG_BYTES) {
      throw new UserInputError("Missing or oversized \"config\" field.");
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(rawConfig);
    } catch {
      throw new UserInputError("The \"config\" field is not valid JSON.");
    }
    const result = validateConfig(parsed);
    if (!result.ok) {
      throw new UserInputError("Some settings are not valid.", 422, result.errors);
    }

    let iconPng: Buffer | null = null;
    const icon = form.get("icon");
    if (icon instanceof File && icon.size > 0) {
      if (icon.size > MAX_ICON_BYTES) {
        throw new UserInputError("The icon must be 2 MB or smaller.", 413, { icon: "The icon must be 2 MB or smaller." });
      }
      iconPng = Buffer.from(await icon.arrayBuffer());
      await validateIcon(iconPng);
    }

    const iconBackground = parseIconBackground(form.get("iconBackground"));

    // Fail early, with actionable hints, instead of queueing a build that cannot succeed.
    const environment = await detectEnvironment();
    if (!environment.ready) {
      return json<ApiError>(
        {
          error: "This machine is not ready to build Android apps yet.",
          checks: environment.checks,
        },
        503,
      );
    }

    const id = await getBuildManager().enqueue(result.config, iconPng, iconBackground);
    return json({ id }, 202);
  } catch (error) {
    return errorResponse(error);
  }
}
