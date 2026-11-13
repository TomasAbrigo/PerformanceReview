import path from "node:path";
import { describe, expect, it } from "vitest";
import page1 from "@/modules/bamboo-client/__fixtures__/employees-page-1.json";
import page2 from "@/modules/bamboo-client/__fixtures__/employees-page-2.json";
import { createBambooClient } from "@/modules/bamboo-client";
import { BambooApiAdapter, EMPLOYEE_FIELDS } from "./bamboo-api-adapter";
import { FixtureAdapter } from "./fixture-adapter";
import { payloadHash } from "./run-ingest";
import type { SourceAdapter } from "./types";

const FIXTURES = path.resolve("src/modules/bamboo-client/__fixtures__");

function apiServingFixtures() {
  const requested: URL[] = [];
  const fetch = (async (input: RequestInfo | URL) => {
    const url = new URL(String(input));
    requested.push(url);
    const body = url.searchParams.get("page[after]") ? page2 : page1;
    return new Response(JSON.stringify(body), { status: 200 });
  }) as typeof globalThis.fetch;
  return {
    client: createBambooClient({ companyDomain: "acme", apiKey: "k", fetch }),
    requested,
  };
}

async function hashes(adapter: SourceAdapter) {
  const out = new Map<string, string>();
  for await (const r of adapter.extract({}, "employee")) {
    out.set(r.sourceId, payloadHash(r.payload));
  }
  return out;
}

describe("BambooApiAdapter", () => {
  it("extracts raw employees keyed by their internal id (as string)", async () => {
    const { client, requested } = apiServingFixtures();
    const adapter = new BambooApiAdapter(client);

    const out = [];
    for await (const r of adapter.extract({}, "employee")) out.push(r);

    expect(adapter.source).toBe("bamboo_api");
    expect(requested[0].searchParams.get("fields")).toBe(
      EMPLOYEE_FIELDS.join(","),
    );
    expect(out.map((r) => r.sourceId)).toEqual(["101", "102", "103"]);
    // Payload is what Bamboo sent, untouched (id 101 stays a number).
    expect(out[0].payload).toEqual(page1.data[0]);
  });

  it("produces the same payload hash as the FixtureAdapter for the same data", async () => {
    const api = await hashes(new BambooApiAdapter(apiServingFixtures().client));
    const fixture = await hashes(new FixtureAdapter(FIXTURES));

    expect(api).toEqual(fixture);
  });
});
