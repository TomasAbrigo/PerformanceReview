import { hasLocale } from "next-intl";
import { setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { PeopleList } from "@/components/people/people-list";
import { db } from "@/db/client";
import { routing } from "@/i18n/routing";
import { listPeople } from "@/modules/people/queries";

async function PeopleData({
  params,
  searchParams,
}: PageProps<"/[locale]/people">) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);
  const { q } = await searchParams;
  const query = typeof q === "string" ? q : "";
  const people = await listPeople(db, query);
  return <PeopleList people={people} query={query} />;
}

export default function PeoplePage(props: PageProps<"/[locale]/people">) {
  return (
    <main className="mx-auto w-full max-w-4xl p-8">
      <Suspense>
        <PeopleData {...props} />
      </Suspense>
    </main>
  );
}
