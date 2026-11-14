import { describe, expect, it } from "vitest";
import { ApiError } from "./errors";
import {
  allPages,
  decodeCursor,
  encodeCursor,
  pageOf,
  pageParams,
} from "./pagination";

const ID = "3f1c9a52-8d6e-4b7a-9c10-5e2f7a8b9c0d";
const TS = "2026-11-13T12:00:00.123456Z";

describe("cursors", () => {
  it("round-trips a (timestamp, id) key and an id key as opaque url-safe text", () => {
    const cursor = encodeCursor([TS, ID]);
    expect(cursor).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(decodeCursor(cursor, "ts_id")).toEqual([TS, ID]);
    expect(decodeCursor(encodeCursor([ID]), "id")).toEqual([ID]);
  });

  it("treats a missing cursor as the first page", () => {
    expect(decodeCursor(null, "ts_id")).toBeNull();
    expect(decodeCursor(undefined, "id")).toBeNull();
  });

  it.each([
    ["not base64 json", "%%%"],
    ["wrong json", Buffer.from("{}").toString("base64url")],
    ["wrong arity", encodeCursor([TS])],
    ["bad timestamp", encodeCursor(["yesterday", ID])],
    ["bad uuid", encodeCursor([TS, "nope"])],
  ])("rejects a malformed cursor (%s) with a 400", (_name, cursor) => {
    try {
      decodeCursor(cursor, "ts_id");
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(ApiError);
      expect((error as ApiError).status).toBe(400);
    }
  });

  it("does not accept an id cursor where a timestamp one is expected", () => {
    expect(() => decodeCursor(encodeCursor([ID]), "ts_id")).toThrowError(
      ApiError,
    );
    expect(() => decodeCursor(encodeCursor([TS, ID]), "id")).toThrowError(
      ApiError,
    );
  });
});

describe("pageOf", () => {
  const rows = [1, 2, 3, 4, 5].map((n) => ({ n }));
  const cursorOf = (r: { n: number }) => `c${r.n}`;

  it("returns the page and the cursor of its last row when there is more", () => {
    expect(pageOf(rows.slice(0, 3), 2, cursorOf)).toEqual({
      items: [{ n: 1 }, { n: 2 }],
      nextCursor: "c2",
    });
  });

  it("has no next cursor on the last (full or short) page", () => {
    expect(pageOf(rows.slice(0, 2), 2, cursorOf).nextCursor).toBeNull();
    expect(pageOf(rows.slice(0, 1), 2, cursorOf).nextCursor).toBeNull();
    expect(pageOf([], 2, cursorOf)).toEqual({ items: [], nextCursor: null });
  });
});

describe("pageParams", () => {
  it("defaults to 50 and caps at 200", () => {
    expect(pageParams.parse({})).toEqual({ limit: 50 });
    expect(pageParams.parse({ limit: "200", cursor: "abc" })).toEqual({
      limit: 200,
      cursor: "abc",
    });
    expect(pageParams.safeParse({ limit: "201" }).success).toBe(false);
    expect(pageParams.safeParse({ limit: "0" }).success).toBe(false);
    expect(pageParams.safeParse({ limit: "1.5" }).success).toBe(false);
    expect(pageParams.safeParse({ limit: "abc" }).success).toBe(false);
  });
});

describe("allPages", () => {
  it("walks every page, handing each cursor to the next fetch", async () => {
    const seen: (string | null)[] = [];
    const fetch = async (cursor: string | null) => {
      seen.push(cursor);
      return cursor === null
        ? { items: [1, 2], nextCursor: "a" }
        : cursor === "a"
          ? { items: [3, 4], nextCursor: "b" }
          : { items: [5], nextCursor: null };
    };
    const all: number[] = [];
    for await (const item of allPages(fetch)) all.push(item);
    expect(all).toEqual([1, 2, 3, 4, 5]);
    expect(seen).toEqual([null, "a", "b"]);
  });
});
