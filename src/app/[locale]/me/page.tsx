import { hasLocale } from "next-intl";
import { setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { NotificationsPreview } from "@/components/notifications/notifications-preview";
import { MyTasksView } from "@/components/review/my-tasks";
import { PeerTasks } from "@/components/review/peer-tasks";
import { db } from "@/db/client";
import { routing } from "@/i18n/routing";
import { getActor } from "@/modules/actor/server";
import { listNotifications } from "@/modules/notifications";
import { getUnreadCount } from "@/modules/notifications/server";
import { listMyTasks } from "@/modules/review-core";

async function Tasks({ params }: PageProps<"/[locale]/me">) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);
  await connection();
  const actor = await getActor();
  const [tasks, latest, unread] = await Promise.all([
    listMyTasks(db, actor),
    listNotifications(db, actor, { unreadOnly: true, limit: 3 }),
    getUnreadCount(actor.personId),
  ]);
  return (
    <div className="flex flex-col gap-6">
      <NotificationsPreview items={latest.items} unread={unread} />
      <MyTasksView
        hasPerson={actor.personId !== null}
        tasks={{
          selfAssessments: tasks.selfAssessments,
          sharedReviews: tasks.sharedReviews,
        }}
      />
      <PeerTasks
        nominations={tasks.nominations}
        feedback={tasks.feedback}
        sharedCycles={tasks.sharedReviews}
      />
    </div>
  );
}

export default function MePage(props: PageProps<"/[locale]/me">) {
  return (
    <main className="mx-auto w-full max-w-3xl p-8">
      <Suspense fallback={<div aria-busy="true" className="h-40" />}>
        <Tasks {...props} />
      </Suspense>
    </main>
  );
}
