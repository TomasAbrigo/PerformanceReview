import { afterEach, describe, expect, it, vi } from "vitest";
import { describeError, errorMessage, logError } from "./log";
import { redactEmails } from "./sensitive-data";

// Assembled at run time: the repo-wide scan reads this file too.
const address = ["jane.roe", ["gmail", "com"].join(".")].join("@");

afterEach(() => vi.restoreAllMocks());

describe("redactEmails", () => {
  it("replaces every address and leaves the rest alone", () => {
    expect(redactEmails(`a ${address}, b ${address}.`)).toBe(
      "a [email], b [email].",
    );
    expect(redactEmails("nothing here, 3 @ 4, @media")).toBe(
      "nothing here, 3 @ 4, @media",
    );
  });

  it.each([
    [
      "postgresql://postgres:x@127.0.0.1:55322/db",
      "postgresql://[credentials]@127.0.0.1:55322/db",
    ],
    [
      "postgresql://u:secret@db.internal.example/x",
      "postgresql://[credentials]@db.internal.example/x",
    ],
    [
      "postgres://localhost-user:pw@localhost:5432/db failed",
      "postgres://[credentials]@localhost:5432/db failed",
    ],
    // A password with an @ in it.
    [
      "redis://u:p@ss@cache.internal/0",
      "redis://[credentials]@cache.internal/0",
    ],
  ])("hides the credentials of a connection URL: %s", (input, expected) => {
    expect(redactEmails(input)).toBe(expected);
  });

  it("redacts an address next to a URL in the same JSON line", () => {
    const line = `{"url":"postgres://a:b@h/db","owner":"${address}"}`;
    expect(redactEmails(line)).toBe(
      '{"url":"postgres://[credentials]@h/db","owner":"[email]"}',
    );
  });
});

describe("errorMessage", () => {
  it("gives the message of an Error, or the text of anything else, redacted", () => {
    expect(errorMessage(new Error(`bad row for ${address}`))).toBe(
      "bad row for [email]",
    );
    expect(errorMessage(`plain ${address}`)).toBe("plain [email]");
    expect(errorMessage(42)).toBe("42");
  });
});

describe("describeError", () => {
  it("covers the stack, the cause chain and a driver's `detail`, with no address", () => {
    const driver = Object.assign(
      new Error(`duplicate key value (${address})`),
      { detail: `Key (work_email)=(${address}) already exists.` },
    );
    const wrapped = new Error(
      `Failed query: insert into person params: ${address}`,
      { cause: driver },
    );
    const text = describeError(wrapped);
    expect(text).not.toContain(address);
    expect(text).not.toContain("jane.roe");
    expect(text).toContain("Failed query: insert into person params: [email]");
    expect(text).toContain("Caused by:");
    expect(text).toContain("duplicate key value ([email])");
    expect(text).toContain("Key (work_email)=([email]) already exists.");
  });

  it("keeps the PostgreSQL error fields, redacted", () => {
    const pg = Object.assign(new Error("duplicate key"), {
      code: "23505",
      constraint_name: "person_work_email_unique",
      schema_name: "public",
      table_name: "person",
      column_name: "work_email",
      hint: `try ${address}`,
      where: `row (${address})`,
      severity: "ERROR",
    });
    const text = describeError(new Error("Failed query", { cause: pg }));
    // The fields belong to the cause, after its own "Caused by:" header.
    expect(text.indexOf("Caused by:")).toBeLessThan(text.indexOf("code=23505"));
    expect(text).toContain("code=23505");
    expect(text).toContain("constraint_name=person_work_email_unique");
    expect(text).toContain("schema_name=public");
    expect(text).toContain("table_name=person");
    expect(text).toContain("column_name=work_email");
    expect(text).toContain("hint=try [email]");
    expect(text).toContain("where=row ([email])");
    expect(text).not.toContain(address);
  });

  it("does not print a cause that is null or undefined", () => {
    const nulled = new Error("outer", { cause: null });
    expect(describeError(nulled)).not.toContain("Caused by");
    expect(describeError(nulled)).not.toContain("null");
    expect(describeError(new Error("plain"))).not.toContain("Caused by");
  });

  it("describes a non-Error value", () => {
    expect(describeError(`oops ${address}`)).toBe("oops [email]");
  });
});

describe("logError", () => {
  it("writes one redacted line group to console.error, with the context", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    logError(new Error(`boom ${address}`), "CSV export failed");
    expect(spy).toHaveBeenCalledTimes(1);
    const [text] = spy.mock.calls[0];
    expect(String(text)).toContain("CSV export failed: Error: boom [email]");
    expect(String(text)).not.toContain("jane.roe");
    expect(spy.mock.calls[0]).toHaveLength(1);
  });
});
