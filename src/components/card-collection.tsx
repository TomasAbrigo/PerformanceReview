import { Children, type HTMLAttributes, type ReactNode } from "react";
import { useTranslations } from "next-intl";

/** Keep large reports readable; every remaining record is available on demand. */
export function CardCollection({
  children,
  gridClassName = "record-grid",
  initialCount = 6,
  ...props
}: HTMLAttributes<HTMLDivElement> & {
  children: ReactNode;
  gridClassName?: string;
  initialCount?: number;
}) {
  const t = useTranslations("Experience");
  const items = Children.toArray(children);
  return (
    <div {...props} className="flex min-w-0 flex-col gap-4">
      <div className={gridClassName}>{items.slice(0, initialCount)}</div>
      {items.length > initialCount ? (
        <details className="collection-more">
          <summary className="button-outline">
            {t("moreRecords", { count: items.length - initialCount })}
          </summary>
          <div className={`${gridClassName} mt-4`}>
            {items.slice(initialCount)}
          </div>
        </details>
      ) : null}
    </div>
  );
}
