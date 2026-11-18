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

/** A positive page number from the `page` param (1 when missing or not a number). */
export function pageParam(sp: Raw): number {
  const n = Number(firstParam(sp, "page"));
  return Number.isInteger(n) && n >= 1 ? n : 1;
}
