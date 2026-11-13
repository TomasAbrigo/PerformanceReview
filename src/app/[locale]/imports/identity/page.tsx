import { hasLocale } from "next-intl";
import { setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { IdentityQueue } from "@/components/identity/identity-queue";
import { db } from "@/db/client";
import { routing } from "@/i18n/routing";
import { countOpenIssues, listIssues } from "@/modules/identity";

const HISTORY_PAGE_SIZE = 25;

async function QueueData({
  params,
  searchParams,
}: PageProps<"/[locale]/imports/identity">) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);
  await connection();
  const { tab, cursor } = await searchParams;
  const history = tab === "history";
  const after = history && typeof cursor === "string" ? cursor : undefined;
  const [page, openCount] = await Promise.all([
    history
      ? listIssues(db, {
          status: ["resolved", "ignored"],
          limit: HISTORY_PAGE_SIZE,
          cursor: after,
        })
      : listIssues(db, { status: "open" }),
    countOpenIssues(db),
  ]);
  return (
    <IdentityQueue
      issues={page.items}
      tab={history ? "history" : "open"}
      openCount={openCount}
      nextCursor={page.nextCursor}
      paged={Boolean(after)}
    />
  );
}

export default function IdentityQueuePage(
  props: PageProps<"/[locale]/imports/identity">,
) {
  return (
    <main className="mx-auto w-full max-w-5xl p-8">
      <Suspense>
        <QueueData {...props} />
      </Suspense>
    </main>
  );
}
