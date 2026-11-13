import { afterEach, describe, expect, it, vi } from "vitest";
import page1 from "./__fixtures__/employees-page-1.json";
import page2 from "./__fixtures__/employees-page-2.json";
import employee101 from "./__fixtures__/employee-101.json";
import employee103 from "./__fixtures__/employee-103.json";
import changed from "./__fixtures__/employees-changed.json";
import { BambooError, createBambooClient } from "./index";

type Handler = (url: URL, init: RequestInit) => Response | Promise<Response>;

function fakeFetch(handler: Handler) {
  const calls: { url: URL; init: RequestInit }[] = [];
  const fn = vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = new URL(String(input));
    calls.push({ url, init });
    return handler(url, init);
  });
  return { fetch: fn as unknown as typeof fetch, calls };
}

const json = (body: unknown, init: ResponseInit = {}) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
    ...init,
  });

const config = { companyDomain: "acme", apiKey: "secret-key" };

describe("createBambooClient", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("follows the cursor across pages and sends auth + accept headers", async () => {
    const { fetch, calls } = fakeFetch((url) =>
      url.searchParams.get("page[after]") === "cursor-page-2"
        ? json(page2)
        : json(page1),
    );
    const client = createBambooClient({ ...config, fetch });

    const ids: string[] = [];
    for await (const e of client.listEmployees({
      fields: ["firstName", "workEmail"],
      limit: 2,
    })) {
      ids.push(e.id);
    }

    expect(ids).toEqual(["101", "102", "103"]);
    expect(calls).toHaveLength(2);
    const first = calls[0];
    expect(first.url.origin + first.url.pathname).toBe(
      "https://acme.bamboohr.com/api/v1/employees",
    );
    expect(first.url.searchParams.get("fields")).toBe("firstName,workEmail");
    expect(first.url.searchParams.get("page[limit]")).toBe("2");
    const headers = new Headers(first.init.headers);
    expect(headers.get("accept")).toBe("application/json");
    expect(headers.get("authorization")).toBe(
      `Basic ${Buffer.from("secret-key:x").toString("base64")}`,
    );
  });

  it("retries a 429 after waiting Retry-After seconds, then succeeds", async () => {
    vi.useFakeTimers();
    let n = 0;
    const { fetch, calls } = fakeFetch(() =>
      ++n === 1
        ? new Response("slow down", {
            status: 429,
            headers: { "Retry-After": "7" },
          })
        : json(employee101),
    );
    const client = createBambooClient({ ...config, fetch });

    const promise = client.getEmployee("101", ["firstName"]);
    await vi.advanceTimersByTimeAsync(6_999);
    expect(calls).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    await expect(promise).resolves.toMatchObject({ id: "101" });
    expect(calls).toHaveLength(2);
  });

  it("accepts Retry-After as an HTTP-date", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-13T10:00:00Z"));
    let n = 0;
    const { fetch, calls } = fakeFetch(() =>
      ++n === 1
        ? new Response(null, {
            status: 503,
            headers: { "Retry-After": "Fri, 13 Nov 2026 10:00:03 GMT" },
          })
        : json(employee101),
    );
    const client = createBambooClient({ ...config, fetch });

    const promise = client.getEmployee("101", ["firstName"]);
    await vi.advanceTimersByTimeAsync(2_999);
    expect(calls).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    await expect(promise).resolves.toMatchObject({ id: "101" });
  });

  it("does not retry a 403 and exposes status + Bamboo message without the key", async () => {
    const { fetch, calls } = fakeFetch(
      () =>
        new Response(null, {
          status: 403,
          headers: { "X-BambooHR-Error-Message": "No access" },
        }),
    );
    const client = createBambooClient({ ...config, fetch });

    const error = await client
      .getEmployee("101", ["firstName"])
      .catch((e) => e);

    expect(error).toBeInstanceOf(BambooError);
    expect(error).toMatchObject({ status: 403, bambooMessage: "No access" });
    expect(calls).toHaveLength(1);
    expect(JSON.stringify({ ...error, message: error.message })).not.toContain(
      "secret-key",
    );
    expect(JSON.stringify({ ...error, message: error.message })).not.toContain(
      Buffer.from("secret-key:x").toString("base64"),
    );
  });

  it("gives up after 6 attempts on persistent 500s", async () => {
    vi.useFakeTimers();
    const { fetch, calls } = fakeFetch(
      () => new Response(null, { status: 500 }),
    );
    const client = createBambooClient({ ...config, fetch });

    const promise = client.getEmployee("101", []).catch((e) => e);
    await vi.runAllTimersAsync();

    expect(await promise).toMatchObject({ status: 500 });
    expect(calls).toHaveLength(6);
  });

  it("returns restricted fields as null and normalizes ids to strings", async () => {
    const { fetch } = fakeFetch(() => json(employee103));
    const client = createBambooClient({ ...config, fetch });

    const e = await client.getEmployee("103", ["hireDate", "supervisorEId"]);

    expect(e.id).toBe("103");
    expect(e.supervisorEId).toBe("101");
    expect(e.hireDate).toBeNull();
    expect(e._restrictedFields).toEqual(["hireDate"]);
  });

  it("reads the changed-employees feed with ids as strings", async () => {
    const { fetch, calls } = fakeFetch(() => json(changed));
    const client = createBambooClient({ ...config, fetch });

    const result = await client.getChangedEmployees(
      new Date("2026-11-10T00:00:00Z"),
    );

    expect(calls[0].url.pathname).toBe("/api/v1/employees/changed");
    expect(calls[0].url.searchParams.get("since")).toBe(
      "2026-11-10T00:00:00.000Z",
    );
    expect(result.employees["103"].id).toBe("103");
  });
});
