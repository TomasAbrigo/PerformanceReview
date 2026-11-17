import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import type { QualitativeSide } from "./params";

const SIDES = [undefined, "self", "manager"] as const;

/**
 * Todos / Propios / Manager: which side wrote the comments (the review's
 * relationship). Links, so the choice lives in the URL; it applies to every
 * block of the page and to the CSV.
 */
export function SideToggle({
  current,
  hrefFor,
}: {
  current: QualitativeSide | undefined;
  hrefFor: (side: QualitativeSide | undefined) => string;
}) {
  const t = useTranslations("Qualitative.side");
  return (
    <nav aria-label={t("label")} className="inline-flex rounded-md border">
      {SIDES.map((side) => (
        <Link
          key={side ?? "all"}
          href={hrefFor(side)}
          aria-current={side === current ? "true" : undefined}
          className={`px-3 py-1 text-sm ${
            side === current ? "bg-primary text-primary-foreground" : ""
          }`}
        >
          {t(side ?? "all")}
        </Link>
      ))}
    </nav>
  );
}
