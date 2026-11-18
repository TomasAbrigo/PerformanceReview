import { Link } from "@/i18n/navigation";

/** A row of link toggles (aria-current marks the active one). */
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
      className="flex items-center gap-1 text-sm"
    >
      <span className="text-muted-foreground">{label}:</span>
      {options.map((o) => (
        <Link
          key={o}
          href={hrefFor(o)}
          aria-current={o === current ? "true" : undefined}
          className={`rounded-md border px-2 py-1 ${o === current ? "bg-foreground text-background" : ""}`}
        >
          {text(o)}
        </Link>
      ))}
    </div>
  );
}
