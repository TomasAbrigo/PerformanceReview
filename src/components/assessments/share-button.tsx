"use client";

import { useTranslations } from "next-intl";
import { type ActionResult, useAction } from "@/components/form-helpers";
import { Button } from "@/components/ui/button";
import { useRouter } from "@/i18n/navigation";

const errorKeys = [
  "forbidden",
  "cycle_closed",
  "not_found",
  "not_submitted",
  "not_shareable",
] as const;

/** Shares the submitted manager review with the reviewee, then refreshes the page. */
export function ShareButton({ share }: { share: () => Promise<ActionResult> }) {
  const t = useTranslations("Capture");
  const router = useRouter();
  const { pending, error, run } = useAction();
  const key = errorKeys.find((k) => k === error?.code);
  return (
    <div className="flex flex-wrap items-center gap-3">
      <Button
        type="button"
        disabled={pending}
        onClick={() => run(share, () => router.refresh())}
      >
        {pending ? t("share.sharing") : t("share.button")}
      </Button>
      <p className="text-sm text-muted-foreground">{t("share.hint")}</p>
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {key ? t(`errors.${key}`) : t("errors.unknown")}
        </p>
      ) : null}
    </div>
  );
}
