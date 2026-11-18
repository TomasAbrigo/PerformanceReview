import type { ReactNode } from "react";

/**
 * The head of a screen: a kicker (the group it belongs to), the title, a
 * line of context and, on the right, its actions. `children` is the row of
 * filters, when the screen has one.
 */
export function PageHeader({
  kicker,
  title,
  description,
  actions,
  children,
}: {
  kicker?: string;
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <header className="page-header">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-col gap-2">
          {kicker ? <p className="kicker text-primary">{kicker}</p> : null}
          <h1 className="text-3xl lg:text-4xl">{title}</h1>
          {description ? (
            <p className="max-w-3xl text-sm text-muted-foreground">
              {description}
            </p>
          ) : null}
        </div>
        {actions ? (
          <div className="flex flex-wrap items-center gap-2">{actions}</div>
        ) : null}
      </div>
      {children ? <div className="filter-toolbar">{children}</div> : null}
    </header>
  );
}
