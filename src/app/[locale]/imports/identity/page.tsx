import { hasLocale } from "next-intl";
import { setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { IdentityQueue } from "@/components/identity/identity-queue";
import { db } from "@/db/client";
import { routing } from "@/i18n/routing";
import { countOpenIssues, listIssues } from "@/modules/identity";

async function QueueData({
  params,
  searchParams,
}: PageProps<"/[locale]/imports/identity">) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);
  await connection();
  const { tab } = await searchParams;
  const history = tab === "history";
  const [issues, openCount] = await Promise.all([
    listIssues(db, { status: history ? ["resolved", "ignored"] : "open" }),
    countOpenIssues(db),
  ]);
  return (
    <IdentityQueue
      issues={issues}
      tab={history ? "history" : "open"}
      openCount={openCount}
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
