import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { OpsAuditLog } from "@/components/cycles/ops-audit-log";
import { db } from "@/db/client";
import { routing } from "@/i18n/routing";
import { getActor } from "@/modules/actor/server";
import { getCycle } from "@/modules/review-core";
import { listAuditLog } from "@/modules/review-core/admin-audit";
import {
  type AdminAction,
  adminActions,
} from "@/modules/review-core/ops-constants";

async function Audit({
  params,
  searchParams,
}: PageProps<"/[locale]/cycles/[id]/audit">) {
  const { locale, id } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);
  await connection();
  const actor = await getActor();
  if (actor.role !== "hr") {
    const t = await getTranslations("Ops.audit");
    return <p role="alert">{t("forbidden")}</p>;
  }
  const cycle = await getCycle(db, id);
  if (!cycle) notFound();
  const { action: raw } = await searchParams;
  const action = adminActions.find((a) => a === raw) as AdminAction | undefined;
  const entries = await listAuditLog(db, actor, id, { action });
  return (
    <OpsAuditLog
      cycleId={cycle.id}
      cycleName={cycle.name}
      entries={entries}
      action={action ?? null}
    />
  );
}

export default function AuditPage(
  props: PageProps<"/[locale]/cycles/[id]/audit">,
) {
  return (
    <main className="mx-auto w-full max-w-6xl p-8">
      <Suspense fallback={<div aria-busy="true" className="h-40" />}>
        <Audit {...props} />
      </Suspense>
    </main>
  );
}
