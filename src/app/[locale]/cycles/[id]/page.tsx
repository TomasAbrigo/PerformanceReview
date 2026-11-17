import { hasLocale } from "next-intl";
import { setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { CycleDetailView } from "@/components/cycles/cycle-detail";
import { db } from "@/db/client";
import { routing } from "@/i18n/routing";
import { getActor } from "@/modules/actor/server";
import { canSeeSensitiveIndicators } from "@/modules/insights/authz";
import { getCycle } from "@/modules/review-core";

async function Detail({ params }: PageProps<"/[locale]/cycles/[id]">) {
  const { locale, id } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);
  await connection();
  const cycle = await getCycle(db, id);
  if (!cycle) notFound();
  // The assessment page is for People and for the manager of the snapshot:
  // only those get the link (the page checks again).
  const actor = await getActor();
  return (
    <CycleDetailView
      cycle={{
        ...cycle,
        participants: cycle.participants.map((p) => ({
          ...p,
          canOpenAssessment: canSeeSensitiveIndicators(actor, {
            revieweePersonId: p.revieweePersonId,
            snapManagerPersonId: p.snapManagerPersonId,
          }),
        })),
      }}
    />
  );
}

export default function CyclePage(props: PageProps<"/[locale]/cycles/[id]">) {
  return (
    <main className="mx-auto w-full max-w-5xl p-8">
      <Suspense fallback={<div aria-busy="true" className="h-40" />}>
        <Detail {...props} />
      </Suspense>
    </main>
  );
}
