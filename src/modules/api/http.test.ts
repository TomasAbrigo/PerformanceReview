import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { ApiError } from "./errors";
import { apiRoute, authorize, ok, parseQuery, problem } from "./http";

const req = (url = "http://localhost/api/v1/x", headers?: HeadersInit) =>
  new Request(url, { headers });

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("responses", () => {
  it("ok wraps data as JSON and is never cached", async () => {
    const response = ok({ data: [1] });
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toMatch(/^application\/json/);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ data: [1] });
  });

  it("problem answers application/problem+json (RFC 9457)", async () => {
    const response = problem(
      new ApiError(400, "Bad Request", "limit must be at least 1", [
        { path: "limit", message: "too small" },
      ]),
    );
    expect(response.status).toBe(400);
    expect(response.headers.get("content-type")).toBe(
      "application/problem+json",
    );
    expect(await response.json()).toEqual({
      type: "about:blank",
      title: "Bad Request",
      status: 400,
      detail: "limit must be at least 1",
      errors: [{ path: "limit", message: "too small" }],
    });
  });
});

describe("authorize (API_TOKEN gate)", () => {
  it("lets everything through when API_TOKEN is unset or empty", () => {
    vi.stubEnv("API_TOKEN", "");
    expect(() => authorize(req())).not.toThrow();
    vi.stubEnv("API_TOKEN", undefined as unknown as string);
    expect(() => authorize(req())).not.toThrow();
  });

  it("requires the bearer token when API_TOKEN is set", () => {
    vi.stubEnv("API_TOKEN", "s3cret");
    expect(() => authorize(req())).toThrowError(ApiError);
    expect(() =>
      authorize(req(undefined, { Authorization: "Bearer nope" })),
    ).toThrowError(ApiError);
    expect(() =>
      authorize(req(undefined, { Authorization: "Basic s3cret" })),
    ).toThrowError(ApiError);
    expect(() =>
      authorize(req(undefined, { Authorization: "Bearer s3cret" })),
    ).not.toThrow();
    // Same length, wrong value, and a longer one.
    expect(() =>
      authorize(req(undefined, { Authorization: "Bearer s3cres" })),
    ).toThrowError(ApiError);
    expect(() =>
      authorize(req(undefined, { Authorization: "Bearer s3cret-and-more" })),
    ).toThrowError(ApiError);
  });

  it("reports 401 with a Bearer challenge", async () => {
    vi.stubEnv("API_TOKEN", "s3cret");
    const route = apiRoute(async () => ok({ data: 1 }));
    const response = await route(req());
    expect(response.status).toBe(401);
    expect(response.headers.get("www-authenticate")).toBe("Bearer");
    expect(response.headers.get("content-type")).toBe(
      "application/problem+json",
    );
  });
});

describe("parseQuery", () => {
  const schema = z.object({
    limit: z.coerce.number().int().min(1).max(5).default(2),
    q: z.string().max(3).optional(),
  });

  it("applies defaults and coerces", () => {
    expect(parseQuery(req("http://x/y"), schema)).toEqual({ limit: 2 });
    expect(parseQuery(req("http://x/y?limit=4&q=ab"), schema)).toEqual({
      limit: 4,
      q: "ab",
    });
  });

  it("throws a 400 ApiError listing every invalid parameter", () => {
    try {
      parseQuery(req("http://x/y?limit=0&q=abcd"), schema);
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(ApiError);
      const e = error as ApiError;
      expect(e.status).toBe(400);
      expect(e.errors?.map((i) => i.path).sort()).toEqual(["limit", "q"]);
    }
  });
});

describe("apiRoute", () => {
  it("passes the request and the awaited params to the handler", async () => {
    const route = apiRoute<{ id: string }>(async (_request, params) =>
      ok({ id: params.id }),
    );
    const response = await route(req(), { params: Promise.resolve({ id: "7" }) });
    expect(await response.json()).toEqual({ id: "7" });
  });

  it("maps ApiError to its status", async () => {
    const route = apiRoute(async () => {
      throw new ApiError(404, "Not Found", "no such thing");
    });
    const response = await route(req());
    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({
      status: 404,
      title: "Not Found",
      detail: "no such thing",
    });
  });

  it("hides unexpected failures behind a 500", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const route = apiRoute(async () => {
      throw new Error("db password is hunter2");
    });
    const response = await route(req());
    expect(response.status).toBe(500);
    expect(JSON.stringify(await response.json())).not.toContain("hunter2");
  });
});
