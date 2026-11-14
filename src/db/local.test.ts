import { describe, expect, it } from "vitest";
import { assertLocalDatabase, e2eDatabaseUrl } from "./local";

describe("assertLocalDatabase", () => {
  it.each([
    "postgresql://postgres:postgres@127.0.0.1:55322/postgres",
    "postgresql://postgres:postgres@localhost:5432/postgres",
    "postgresql://postgres:postgres@[::1]:5432/postgres",
  ])("accepts %s", (url) => {
    expect(() => assertLocalDatabase(url)).not.toThrow();
  });

  it.each([
    "postgresql://u:p@db.abcdefgh.supabase.co:5432/postgres",
    "postgresql://u:p@10.0.0.5:5432/postgres",
    "not a url",
    "",
    undefined,
  ])("refuses %s", (url) => {
    expect(() => assertLocalDatabase(url)).toThrow(/not local/);
  });
});

describe("e2eDatabaseUrl", () => {
  it("is the development database with _e2e appended, same server and credentials", () => {
    expect(
      e2eDatabaseUrl({
        DATABASE_URL: "postgresql://postgres:postgres@127.0.0.1:55322/postgres",
      }),
    ).toBe("postgresql://postgres:postgres@127.0.0.1:55322/postgres_e2e");
    expect(
      e2eDatabaseUrl({
        DATABASE_URL:
          "postgresql://u:p@localhost:5432/pr_issue29?sslmode=disable",
      }),
    ).toBe("postgresql://u:p@localhost:5432/pr_issue29_e2e?sslmode=disable");
  });

  it("prefers E2E_DATABASE_URL and needs one of the two", () => {
    expect(
      e2eDatabaseUrl({
        DATABASE_URL: "postgresql://u:p@localhost/dev",
        E2E_DATABASE_URL: "postgresql://u:p@localhost/mine",
      }),
    ).toBe("postgresql://u:p@localhost/mine");
    expect(() => e2eDatabaseUrl({})).toThrow(/DATABASE_URL/);
  });
});
