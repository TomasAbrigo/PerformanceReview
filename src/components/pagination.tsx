import { Link } from "@/i18n/navigation";

/**
 * Previous / next of a paged list. `hrefFor` builds the link of a page (the
 * filters live in the URL); nothing renders for a single page.
 */
export function Pagination({
  page,
  pages,
  hrefFor,
  labels,
}: {
  page: number;
  pages: number;
  hrefFor: (page: number) => string;
  labels: { nav: string; previous: string; next: string; position: string };
}) {
  if (pages <= 1) return null;
  const link =
    "button-outline aria-disabled:pointer-events-none aria-disabled:opacity-50";
  return (
    <nav
      aria-label={labels.nav}
      className="flex flex-wrap items-center justify-between gap-3 pt-2 text-sm"
    >
      {page > 1 ? (
        <Link href={hrefFor(page - 1)} rel="prev" className={link}>
          {labels.previous}
        </Link>
      ) : (
        <span aria-disabled="true" className={link}>
          {labels.previous}
        </span>
      )}
      <span className="text-muted-foreground tabular-nums">
        {labels.position}
      </span>
      {page < pages ? (
        <Link href={hrefFor(page + 1)} rel="next" className={link}>
          {labels.next}
        </Link>
      ) : (
        <span aria-disabled="true" className={link}>
          {labels.next}
        </span>
      )}
    </nav>
  );
}
