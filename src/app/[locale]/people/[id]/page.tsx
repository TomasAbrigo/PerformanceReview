import { hasLocale } from "next-intl";
import { setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { PersonDetail } from "@/components/people/person-detail";
import { db } from "@/db/client";
import { routing } from "@/i18n/routing";
import { getPerson } from "@/modules/people/queries";

async function PersonData({ params }: PageProps<"/[locale]/people/[id]">) {
  const { locale, id } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);
  await connection();
  const person = await getPerson(db, id);
  if (!person) notFound();
  return <PersonDetail person={person} />;
}

export default function PersonPage(props: PageProps<"/[locale]/people/[id]">) {
  return (
    <main className="mx-auto w-full max-w-4xl p-8">
      <Suspense>
        <PersonData {...props} />
      </Suspense>
    </main>
  );
}
