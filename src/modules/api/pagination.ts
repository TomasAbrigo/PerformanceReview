import { z } from "zod";
import { isUuid } from "@/lib/uuid";
import { badRequest } from "./errors";

export const DEFAULT_LIMIT = 50;
export const MAX_LIMIT = 200;

/** `?limit=&cursor=` of every list endpoint. */
export const pageParams = z.object({
  limit: z.coerce.number().int().min(1).max(MAX_LIMIT).default(DEFAULT_LIMIT),
  cursor: z.string().min(1).max(512).optional(),
});

export type Page<T> = { items: T[]; nextCursor: string | null };

const ISO_INSTANT = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(\.\d{1,6})?Z$/;

/** An opaque, url-safe cursor over the key of the last row of a page. */
export function encodeCursor(key: string[]): string {
  return Buffer.from(JSON.stringify(key)).toString("base64url");
}

/**
 * Keyset position of a cursor: `ts_id` = (instant with microseconds, uuid),
 * `id` = (uuid). Null for the first page; anything else that does not decode
 * is a 400, never silently the first page.
 */
export function decodeCursor(
  cursor: string | null | undefined,
  shape: "ts_id",
): [string, string] | null;
export function decodeCursor(
  cursor: string | null | undefined,
  shape: "id",
): [string] | null;
export function decodeCursor(
  cursor: string | null | undefined,
  shape: "ts_id" | "id",
): [string, string] | [string] | null {
  if (!cursor) return null;
  try {
    const parsed: unknown = JSON.parse(
      Buffer.from(cursor, "base64url").toString("utf8"),
    );
    if (
      Array.isArray(parsed) &&
      parsed.every((v) => typeof v === "string") &&
      (shape === "id"
        ? parsed.length === 1 && isUuid(parsed[0])
        : parsed.length === 2 &&
          ISO_INSTANT.test(parsed[0]) &&
          isUuid(parsed[1]))
    ) {
      return parsed as [string, string] | [string];
    }
  } catch {
    // fall through to the 400
  }
  throw badRequest("Invalid cursor.", [
    { path: "cursor", message: "not a cursor returned by this endpoint" },
  ]);
}

/**
 * The page of a result fetched with `limit + 1` rows: the extra row only says
 * there is a next page, whose cursor is the key of the last row returned.
 */
export function pageOf<T>(
  rows: T[],
  limit: number,
  cursorOf: (row: T) => string,
): Page<T> {
  const items = rows.slice(0, limit);
  const last = items.at(-1);
  return {
    items,
    nextCursor: rows.length > limit && last ? cursorOf(last) : null,
  };
}

/** Every row of a paged query, fetched page by page (exports stream through this). */
export async function* allPages<T>(
  fetchPage: (cursor: string | null) => Promise<Page<T>>,
): AsyncGenerator<T> {
  let cursor: string | null = null;
  do {
    const page: Page<T> = await fetchPage(cursor);
    yield* page.items;
    cursor = page.nextCursor;
  } while (cursor);
}
