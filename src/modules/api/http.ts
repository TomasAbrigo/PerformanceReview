import { createHash, timingSafeEqual } from "node:crypto";
import type { ZodType } from "zod";
import { ApiError, badRequest } from "./errors";

/** JSON answer; the API is read live, so never cached. */
export function ok(body: unknown): Response {
  return Response.json(body, { headers: { "Cache-Control": "no-store" } });
}

/** RFC 9457 problem+json for an error. */
export function problem(error: ApiError): Response {
  const headers: Record<string, string> = {
    "Content-Type": "application/problem+json",
    "Cache-Control": "no-store",
  };
  if (error.status === 401) headers["WWW-Authenticate"] = "Bearer";
  return new Response(
    JSON.stringify({
      type: "about:blank",
      title: error.title,
      status: error.status,
      ...(error.detail ? { detail: error.detail } : {}),
      ...(error.errors?.length ? { errors: error.errors } : {}),
    }),
    { status: error.status, headers },
  );
}

const digest = (value: string) => createHash("sha256").update(value).digest();

/**
 * Token gate: when `API_TOKEN` is set the request must carry
 * `Authorization: Bearer <token>`; when it is unset or empty the API is open
 * (local development). Compared in constant time.
 */
export function authorize(request: Request): void {
  const token = process.env.API_TOKEN;
  if (!token) return;
  const header = request.headers.get("authorization") ?? "";
  const match = /^Bearer (.+)$/.exec(header);
  if (match && timingSafeEqual(digest(match[1]), digest(token))) return;
  throw new ApiError(
    401,
    "Unauthorized",
    "A valid bearer token is required (Authorization: Bearer <API_TOKEN>).",
  );
}

/** Query-string parameters parsed with `schema`; a bad one is a 400 listing each problem. */
export function parseQuery<T>(request: Request, schema: ZodType<T>): T {
  const params: Record<string, string> = {};
  for (const [key, value] of new URL(request.url).searchParams) {
    // First value wins, like most servers; unknown keys are ignored by the schema.
    if (!(key in params)) params[key] = value;
  }
  const result = schema.safeParse(params);
  if (result.success) return result.data;
  throw badRequest(
    "Invalid query parameters.",
    result.error.issues.map((i) => ({
      path: i.path.join("."),
      message: i.message,
    })),
  );
}

/**
 * Wraps a route handler: token gate, then the handler, with every failure
 * answered as problem+json (unexpected ones as a bare 500, logged).
 */
export function apiRoute<P = Record<string, never>>(
  handler: (request: Request, params: P) => Promise<Response>,
): (request: Request, context?: { params: Promise<P> }) => Promise<Response> {
  return async (request, context) => {
    try {
      authorize(request);
      const params = (await context?.params) ?? ({} as P);
      return await handler(request, params);
    } catch (error) {
      if (error instanceof ApiError) return problem(error);
      console.error(error);
      return problem(new ApiError(500, "Internal Server Error"));
    }
  };
}
