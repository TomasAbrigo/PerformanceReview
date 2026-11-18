/** The highest page any list reads: far past every list, so no URL or call makes a huge offset. */
export const MAX_PAGE = 1000;

/**
 * The page to read: the one asked for, kept between the first and the last
 * (`total` rows, `pageSize` per page) and never past `MAX_PAGE`. A missing or
 * invalid page is the first.
 */
export function clampPage(
  requested: number | undefined,
  total: number,
  pageSize: number,
): number {
  const pages = Math.min(MAX_PAGE, Math.max(1, Math.ceil(total / pageSize)));
  const wanted =
    requested !== undefined && Number.isFinite(requested)
      ? Math.floor(requested)
      : 1;
  return Math.min(Math.max(1, wanted), pages);
}
