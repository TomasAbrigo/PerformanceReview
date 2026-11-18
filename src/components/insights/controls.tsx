import { Link } from "@/i18n/navigation";

/** A labelled segmented row of link toggles (aria-current marks the active one). */
export function Toggle<T extends string>({
  label,
  options,
  current,
  hrefFor,
  text,
}: {
  label: string;
  options: readonly T[];
  current: T;
  hrefFor: (v: T) => string;
  text: (v: T) => string;
}) {
  return (
    <div
      role="group"
      aria-label={label}
      className="flex flex-wrap items-center gap-2 text-sm"
    >
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      <span className="segmented">
        {options.map((o) => (
          <Link
            key={o}
            href={hrefFor(o)}
            aria-current={o === current ? "true" : undefined}
          >
            {text(o)}
          </Link>
        ))}
      </span>
    </div>
  );
}
