import { NextResponse } from "next/server";
import type { ApiError } from "./build-types";
import { UserInputError } from "./file-utils";

const NO_STORE = { "Cache-Control": "no-store" };

export function json<T>(body: T, status = 200): NextResponse<T> {
  return NextResponse.json(body, { status, headers: NO_STORE });
}

/**
 * Matches by name rather than `instanceof`: the build manager is a process-wide singleton that may
 * have been created from a different bundle of this module (instrumentation vs route handlers).
 */
function isUserInputError(error: unknown): error is UserInputError {
  return error instanceof Error && error.name === "UserInputError";
}

export function errorResponse(error: unknown): NextResponse<ApiError> {
  if (isUserInputError(error)) {
    return json<ApiError>({ error: error.message, fields: error.fields }, error.status);
  }
  console.error("[api] unexpected error", error);
  return json<ApiError>({ error: "Something went wrong on the generator. Check its server console." }, 500);
}

/**
 * The generator has no login, so any web page open in the user's browser could otherwise POST a
 * build to http://localhost. Browsers attach Origin / Sec-Fetch-Site to such requests; refuse
 * anything that is not from the generator's own page.
 */
export function assertSameOrigin(request: Request): void {
  const site = request.headers.get("sec-fetch-site");
  if (site && site !== "same-origin" && site !== "none") {
    throw new UserInputError("Cross-site requests are not allowed.", 403);
  }
  const origin = request.headers.get("origin");
  if (origin) {
    let originHost: string;
    try {
      originHost = new URL(origin).host;
    } catch {
      throw new UserInputError("Invalid Origin header.", 403);
    }
    if (originHost !== request.headers.get("host")) {
      throw new UserInputError("Cross-origin requests are not allowed.", 403);
    }
  }
}
