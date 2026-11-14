import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { CalibrationTableView } from "@/components/calibration/calibration-table";
import { DistributionChart } from "@/components/calibration/distribution-chart";
import { GroupsPanel } from "@/components/calibration/groups-panel";
import { PublishCalibration } from "@/components/calibration/publish-calibration";
import { db } from "@/db/client";
import { Link } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";
import { getActor } from "@/modules/actor/server";
import {
  calibrationTable,
  distribution,
  getCycle,
  listGroups,
  ReviewError,
} from "@/modules/review-core";
import { createGroupAction, proposeAction, publishAction } from "./actions";

async function Calibration({
  params,
  searchParams,
}: PageProps<"/[locale]/cycles/[id]/calibration">) {
  const { locale, id } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);
  await connection();
  const cycle = await getCycle(db, id);
  if (!cycle) notFound();
  const actor = await getActor();
  const t = await getTranslations("Calibration");
  const isHr = actor.role === "hr";
  const groups = await listGroups(db, actor, id);
  // Non-HR (calibrators included) see only the groups they calibrate.
  if (!isHr && groups.length === 0) notFound();
  const sp = await searchParams;
  const selectedId =
    (typeof sp.group === "string" ? sp.group : null) ?? groups[0]?.id ?? null;
  let table = null;
  if (selectedId && groups.some((g) => g.id === selectedId)) {
    try {
      table = await calibrationTable(db, actor, selectedId);
    } catch (error) {
      if (!(error instanceof ReviewError)) throw error;
    }
  }
  // Scoped by the domain: HR the whole cycle, calibrators their groups.
  const dist = (
    groupBy: "department" | "manager",
    stage: "manager" | "current",
  ) => distribution(db, actor, id, { groupBy, stage });
  const [deptPre, deptPost, mgrPre, mgrPost] = await Promise.all([
    dist("department", "manager"),
    dist("department", "current"),
    dist("manager", "manager"),
    dist("manager", "current"),
  ]);
  const data = {
    department: { manager: deptPre, current: deptPost },
    manager: { manager: mgrPre, current: mgrPost },
  };
  const active = cycle.participants.filter((p) => !p.removedAt);
  const departments = [
    ...new Set(active.map((p) => p.snapDepartment).filter((d) => d !== null)),
  ].sort();
  const managers = [
    ...new Map(
      active
        .filter((p) => p.snapManagerPersonId && p.snapManagerName)
        .map((p) => [
          p.snapManagerPersonId!,
          { id: p.snapManagerPersonId!, name: p.snapManagerName! },
        ]),
    ).values(),
  ].sort((a, b) => a.name.localeCompare(b.name));
  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-1">
        <Link href={`/cycles/${id}`} className="text-sm underline">
          {t("back")}
        </Link>
        <h1 className="text-2xl font-semibold">
          {t("title", { cycle: cycle.name })}
        </h1>
      </div>
      {isHr ? (
        <PublishCalibration
          cycleId={id}
          publishedAt={cycle.calibrationPublishedAt}
          publish={publishAction}
        />
      ) : null}
      <GroupsPanel
        cycleId={id}
        groups={groups}
        selectedId={selectedId}
        canCreate={isHr}
        departments={departments}
        managers={managers}
        create={createGroupAction}
      />
      {table ? (
        <CalibrationTableView table={table} propose={proposeAction} />
      ) : groups.length ? (
        <p className="text-muted-foreground">{t("selectGroup")}</p>
      ) : null}
      <DistributionChart data={data} />
    </div>
  );
}

export default function CalibrationPage(
  props: PageProps<"/[locale]/cycles/[id]/calibration">,
) {
  return (
    <main className="mx-auto w-full max-w-6xl p-8">
      <Suspense fallback={<div aria-busy="true" className="h-40" />}>
        <Calibration {...props} />
      </Suspense>
    </main>
  );
}
