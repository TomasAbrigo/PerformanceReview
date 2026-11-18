"use client";

import type { ReactNode } from "react";
import { useState } from "react";
import { useTranslations } from "next-intl";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { useRouter } from "@/i18n/navigation";

/**
 * The side sheet of a drill: open while the URL carries `drill`; closing it
 * (Esc, the X, the backdrop) navigates to `closeHref`, the same page
 * without the param. Key it by the drill so a new one opens fresh.
 */
export function DrillSheet({
  title,
  description,
  closeHref,
  children,
}: {
  title: string;
  description?: string;
  closeHref: string;
  children: ReactNode;
}) {
  const t = useTranslations("Drill");
  const router = useRouter();
  const [open, setOpen] = useState(true);
  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        if (next) return;
        setOpen(false);
        router.replace(closeHref, { scroll: false });
      }}
    >
      <SheetContent
        side="right"
        closeLabel={t("close")}
        className="w-full overflow-y-auto data-[side=right]:sm:max-w-xl"
        data-testid="drill-sheet"
      >
        <SheetHeader className="border-b border-border/70 bg-brand-fog/60 p-5 pr-12">
          <span className="kicker text-muted-foreground">{t("kicker")}</span>
          <SheetTitle className="text-xl font-light">{title}</SheetTitle>
          {description ? (
            <SheetDescription>{description}</SheetDescription>
          ) : null}
        </SheetHeader>
        <div className="flex flex-col gap-6 px-5 pb-8">{children}</div>
      </SheetContent>
    </Sheet>
  );
}
