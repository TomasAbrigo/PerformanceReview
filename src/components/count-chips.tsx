import { Link } from "@/i18n/navigation";

/**
 * The counts per state of a list, as a segmented row of links: each one
 * filters the list by that state, the first (`all`) clears the filter. The
 * current one carries aria-current.
 */
export function CountChips<T extends string>({
  label,
  all,
  items,
  current,
  hrefFor,
}: {
  label: string;
  all: { label: string; count: number };
  items: { value: T; label: string; count: number }[];
  current: T | undefined;
  hrefFor: (value: T | undefined) => string;
}) {
  return (
    <div
      role="group"
      aria-label={label}
      className="flex flex-wrap items-center gap-2 text-sm"
    >
      <span className="segmented">
        <Link
          href={hrefFor(undefined)}
          aria-current={current === undefined ? "true" : undefined}
        >
          {all.label} <span className="tabular-nums">{all.count}</span>
        </Link>
        {items.map((item) => (
          <Link
            key={item.value}
            href={hrefFor(item.value)}
            aria-current={current === item.value ? "true" : undefined}
          >
            {item.label} <span className="tabular-nums">{item.count}</span>
          </Link>
        ))}
      </span>
    </div>
  );
}
