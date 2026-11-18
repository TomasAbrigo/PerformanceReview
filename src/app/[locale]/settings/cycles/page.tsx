import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { HrOnly } from "@/components/access/hr-only";
import { CreateCycleForm } from "@/components/cycles/create-cycle-form";
import { Panel } from "@/components/insights/parts";
import { PageHeader } from "@/components/page-header";
import { groupKicker } from "@/components/page-kicker";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { db } from "@/db/client";
import { Link } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";
import {
  periodCycleName,
  semesterConfig,
  semesterOf,
} from "@/modules/import-history/semester";
import { todayLocal } from "@/modules/org-history/dates";
import { listCycles } from "@/modules/review-core";
import { cycleName } from "@/modules/review-core/cycle-name";
import { createCycleAction } from "./actions";
import { statusKey } from "./status-key";

async function Cycles({ params }: PageProps<"/[locale]/settings/cycles">) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);
  await connection();
  const t = await getTranslations("Cycles");
  const kicker = await groupKicker("settings");
  const cycles = await listCycles(db);
  // The suggested period: the semester of today, from the configured cuts.
  const semester = semesterOf(todayLocal(), await semesterConfig(db));
  const defaults = {
    name: periodCycleName(semester.periodStart, semester.periodEnd),
    periodStart: semester.periodStart,
    periodEnd: semester.periodEnd,
  };
  return (
    <>
      <PageHeader
        kicker={kicker}
        title={t("title")}
        description={t("description")}
      />
      <Panel id="cycles-new" title={t("create.title")}>
        <CreateCycleForm defaults={defaults} create={createCycleAction} />
      </Panel>
      <Panel id="cycles-list" title={t("list.title")}>
        {cycles.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("list.empty")}</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("list.columns.name")}</TableHead>
                <TableHead>{t("list.columns.period")}</TableHead>
                <TableHead>{t("list.columns.status")}</TableHead>
                <TableHead className="text-right">
                  {t("list.columns.participants")}
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {cycles.map((c) => (
                <TableRow key={c.id}>
                  <TableCell>
                    <Link
                      href={`/settings/cycles/${c.id}`}
                      className="underline underline-offset-4"
                    >
                      {cycleName(c, locale)}
                    </Link>
                  </TableCell>
                  <TableCell>
                    {c.periodStart} – {c.periodEnd}
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline">
                      {t(`status.${statusKey(c.status)}`)}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    {c.participantCount}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Panel>
    </>
  );
}

export default function CyclesPage(
  props: PageProps<"/[locale]/settings/cycles">,
) {
  return (
    <main className="mx-auto flex w-full max-w-6xl flex-col gap-8 p-6 lg:p-10">
      <Suspense fallback={<div aria-busy="true" className="h-40" />}>
        <HrOnly>
          <Cycles {...props} />
        </HrOnly>
      </Suspense>
    </main>
  );
}
