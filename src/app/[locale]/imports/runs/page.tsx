import { hasLocale } from "next-intl";
import { setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { RunsList } from "@/components/ingest/runs-list";
import { db } from "@/db/client";
import { sourceSystem } from "@/db/schema";
import { routing } from "@/i18n/routing";
import { listRunEntities, listRuns } from "@/modules/ingest/runs-queries";

const PAGE_SIZE = 25;

const first = (value: string | string[] | undefined) =>
  typeof value === "string" && value !== "" ? value : undefined;

async function RunsData({
  params,
  searchParams,
}: PageProps<"/[locale]/imports/runs">) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);

  const sp = await searchParams;
  const filters = {
    source: first(sp.source),
    entity: first(sp.entity),
    status: first(sp.status),
  };
  const [{ runs, nextCursor }, entities] = await Promise.all([
    listRuns(db, { ...filters, cursor: first(sp.cursor), limit: PAGE_SIZE }),
    listRunEntities(db),
  ]);

  const next = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (value) next.set(key, value);
  }
  if (nextCursor) next.set("cursor", nextCursor);

  return (
    <RunsList
      runs={runs}
      filters={filters}
      entities={entities}
      sources={[...sourceSystem.enumValues]}
      nextHref={nextCursor ? `/imports/runs?${next}` : null}
    />
  );
}

export default function RunsPage(props: PageProps<"/[locale]/imports/runs">) {
  return (
    <main className="mx-auto w-full max-w-7xl p-8">
      <Suspense>
        <RunsData {...props} />
      </Suspense>
    </main>
  );
}
