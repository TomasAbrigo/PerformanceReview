import { hasLocale } from "next-intl";
import { setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { MyTasksView } from "@/components/review/my-tasks";
import { db } from "@/db/client";
import { routing } from "@/i18n/routing";
import { getActor } from "@/modules/actor/server";
import { listMyTasks } from "@/modules/review-core";

async function Tasks({ params }: PageProps<"/[locale]/me">) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);
  await connection();
  const actor = await getActor();
  const tasks = await listMyTasks(db, actor);
  return (
    <MyTasksView
      hasPerson={actor.personId !== null}
      tasks={{ selfAssessments: tasks.selfAssessments }}
    />
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
