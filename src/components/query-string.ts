import { MAX_PAGE } from "@/lib/paging";

/** A query string (`?a=1&b=2`, or empty) from the params that have a value. */
export function queryString(
  params: Record<string, string | number | undefined | null>,
): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== "") {
      search.set(key, String(value));
    }
  }
  const text = search.toString();
  return text ? `?${text}` : "";
}

type Raw = Record<string, string | string[] | undefined>;

/** The first value of a search param, trimmed; an empty one is no value. */
export const firstParam = (sp: Raw, key: string): string | undefined => {
  const value = sp[key];
  return (Array.isArray(value) ? value[0] : value)?.trim() || undefined;
};

/**
 * A page number from the `page` param: 1 when it is missing or not a whole
 * number, never past `MAX_PAGE`. The query clamps it to the last page there is.
 */
export function pageParam(sp: Raw): number {
  const n = Number(firstParam(sp, "page"));
  return Number.isInteger(n) && n >= 1 ? Math.min(n, MAX_PAGE) : 1;
}

/**
 * The href builder of a list: `base` plus the filters in the query string,
 * with `extra` (the page, a state to filter by...) laid over them. An
 * undefined value drops that param.
 */
export function listHref(
  base: string,
  filters: Record<string, string | number | undefined | null>,
): (extra?: Record<string, string | number | undefined | null>) => string {
  return (extra = {}) => `${base}${queryString({ ...filters, ...extra })}`;
}
