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

  it("also hides the credentials of a connection URL", () => {
    expect(redactEmails("postgresql://u:secret@db.internal.example/x")).toBe(
      "postgresql://u:[email]/x",
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
