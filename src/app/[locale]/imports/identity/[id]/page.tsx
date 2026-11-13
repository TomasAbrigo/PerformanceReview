import { hasLocale } from "next-intl";
import { setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { IssueDetail } from "@/components/identity/issue-detail";
import { db } from "@/db/client";
import { routing } from "@/i18n/routing";
import { getIssue } from "@/modules/identity";
import {
  createIssueAction,
  ignoreIssueAction,
  linkIssueAction,
  searchPeopleAction,
} from "../actions";

async function IssueData({
  params,
}: PageProps<"/[locale]/imports/identity/[id]">) {
  const { locale, id } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);
  await connection();
  const issue = await getIssue(db, id);
  if (!issue) notFound();
  return (
    <IssueDetail
      issue={issue}
      actions={{
        link: linkIssueAction,
        create: createIssueAction,
        ignore: ignoreIssueAction,
        searchPeople: searchPeopleAction,
      }}
    />
  );
}

export default function IdentityIssuePage(
  props: PageProps<"/[locale]/imports/identity/[id]">,
) {
  return (
    <main className="mx-auto w-full max-w-4xl p-8">
      <Suspense>
        <IssueData {...props} />
      </Suspense>
    </main>
  );
}
