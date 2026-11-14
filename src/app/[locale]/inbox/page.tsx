import { hasLocale } from "next-intl";
import { setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { InboxView } from "@/components/notifications/inbox-view";
import { db } from "@/db/client";
import { routing } from "@/i18n/routing";
import { getActor } from "@/modules/actor/server";
import { listNotifications } from "@/modules/notifications";
import { markAllReadAction, markReadAction } from "./actions";

async function Inbox({ params, searchParams }: PageProps<"/[locale]/inbox">) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);
  await connection();
  const { cursor } = await searchParams;
  const actor = await getActor();
  const page = await listNotifications(db, actor, {
    cursor: typeof cursor === "string" ? cursor : undefined,
  });
  return (
    <InboxView
      hasPerson={actor.personId !== null}
      items={page.items}
      nextCursor={page.nextCursor}
      isFirstPage={typeof cursor !== "string"}
      markRead={markReadAction}
      markAllRead={markAllReadAction}
    />
  );
}

export default function InboxPage(props: PageProps<"/[locale]/inbox">) {
  return (
    <main className="mx-auto w-full max-w-3xl p-8">
      <Suspense fallback={<div aria-busy="true" className="h-40" />}>
        <Inbox {...props} />
      </Suspense>
    </main>
  );
}
