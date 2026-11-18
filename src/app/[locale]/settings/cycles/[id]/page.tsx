import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { HrOnly } from "@/components/access/hr-only";
import { ActionButton } from "@/components/cycles/action-button";
import { AddParticipant } from "@/components/cycles/add-participant";
import { ParticipantPicker } from "@/components/cycles/participant-picker";
import { Panel } from "@/components/insights/parts";
import { PageHeader } from "@/components/page-header";
import { groupKicker } from "@/components/page-kicker";
import { ProgressBar } from "@/components/progress-bar";
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
import { getActor } from "@/modules/actor/server";
import {
  cycleProgress,
  getCycle,
  listCandidates,
  listCycleRequests,
} from "@/modules/review-core";
import { cycleName } from "@/modules/review-core/cycle-name";
import {
  addParticipantAction,
  closeCycleAction,
  launchCycleAction,
  removeParticipantAction,
  reopenRequestAction,
  setParticipantsAction,
} from "../actions";
import { statusKey } from "../status-key";

async function CycleDetail({
  params,
}: PageProps<"/[locale]/settings/cycles/[id]">) {
  const { locale, id } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);
  await connection();
  const actor = await getActor();
  const cycle = await getCycle(db, id);
  if (!cycle) notFound();
  const t = await getTranslations("Cycles");
  const kicker = await groupKicker("settings");
  const state = statusKey(cycle.status);
  const draft = state === "draft";
  const open = state === "open";
  const active = cycle.participants.filter((p) => !p.removedAt);
  const missing = active.filter((p) => p.withoutManager);
  const candidates = await listCandidates(db, actor);
  const inCycle = new Set(active.map((p) => p.revieweePersonId));
  const progress = await cycleProgress(db, id);
  const requests = draft ? [] : await listCycleRequests(db, actor, id);
  const total = (kind: "self" | "manager") => progress[kind];

  return (
    <>
      <PageHeader
        kicker={kicker}
        title={cycleName(cycle, locale)}
        description={[
          t("detail.period", {
            start: cycle.periodStart,
            end: cycle.periodEnd,
          }),
          t("detail.snapshot", { date: cycle.snapshotDate }),
        ].join(" · ")}
        actions={
          <>
            <Badge variant="outline">{t(`status.${state}`)}</Badge>
            <Link
              href="/settings/cycles"
              className="text-sm underline underline-offset-4"
            >
              {t("back")}
            </Link>
          </>
        }
      />

      {draft ? (
        <Panel id="cycle-launch" title={t("actions.launch")}>
          <p className="text-sm text-muted-foreground">
            {t("actions.launchHint")}
          </p>
          <div>
            {active.length > 0 ? (
              <ActionButton
                variant="default"
                action={launchCycleAction.bind(null, id)}
              >
                {t("actions.launch")}
              </ActionButton>
            ) : null}
          </div>
        </Panel>
      ) : (
        <Panel
          id="cycle-progress"
          title={t("progress.title")}
          hint={t("progress.hint")}
          actions={
            open ? (
              <ActionButton action={closeCycleAction.bind(null, id)}>
                {t("actions.close")}
              </ActionButton>
            ) : undefined
          }
        >
          {(["self", "manager"] as const).map((kind) => (
            <div key={kind} className="flex flex-col gap-1">
              <p className="text-sm">
                {t(`progress.${kind}`)}:{" "}
                {t("progress.of", {
                  submitted: total(kind).submitted,
                  total: total(kind).total,
                })}
              </p>
              <ProgressBar
                percent={
                  total(kind).total === 0
                    ? 0
                    : (total(kind).submitted / total(kind).total) * 100
                }
                label={t(`progress.${kind}`)}
              />
            </div>
          ))}
          {open ? (
            <p className="text-sm text-muted-foreground">
              {t("actions.closeHint")}
            </p>
          ) : null}
        </Panel>
      )}

      <Panel
        id="cycle-without-manager"
        title={t("withoutManager.title")}
        hint={t("withoutManager.hint")}
      >
        {missing.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {t("withoutManager.none")}
          </p>
        ) : (
          <ul className="list-disc pl-5 text-sm">
            {missing.map((p) => (
              <li key={p.id}>{p.displayName}</li>
            ))}
          </ul>
        )}
      </Panel>

      <Panel
        id="cycle-participants"
        title={t("participants.title")}
        hint={t(draft ? "participants.hintDraft" : "participants.hintOpen")}
      >
        {draft ? (
          <ParticipantPicker
            candidates={candidates}
            initial={active.map((p) => p.revieweePersonId)}
            save={setParticipantsAction.bind(null, id)}
          />
        ) : (
          <>
            {open ? (
              <AddParticipant
                options={candidates.filter((c) => !inCycle.has(c.personId))}
                add={addParticipantAction.bind(null, id)}
              />
            ) : null}
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("participants.columns.person")}</TableHead>
                  <TableHead>{t("participants.columns.area")}</TableHead>
                  <TableHead>{t("participants.columns.manager")}</TableHead>
                  <TableHead>{t("participants.columns.state")}</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {cycle.participants.map((p) => (
                  <TableRow key={p.id}>
                    <TableCell>{p.displayName}</TableCell>
                    <TableCell>{p.snapDepartment ?? "—"}</TableCell>
                    <TableCell>{p.snapManagerName ?? "—"}</TableCell>
                    <TableCell>
                      {p.removedAt
                        ? t("participants.removed")
                        : t("participants.active")}
                    </TableCell>
                    <TableCell className="text-right">
                      {open && !p.removedAt ? (
                        <ActionButton
                          size="sm"
                          action={removeParticipantAction.bind(
                            null,
                            id,
                            p.revieweePersonId,
                          )}
                        >
                          {t("participants.remove")}
                        </ActionButton>
                      ) : null}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </>
        )}
      </Panel>

      {draft ? null : (
        <Panel id="cycle-requests" title={t("requests.title")}>
          {requests.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {t("requests.empty")}
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("requests.columns.person")}</TableHead>
                  <TableHead>{t("requests.columns.kind")}</TableHead>
                  <TableHead>{t("requests.columns.reviewer")}</TableHead>
                  <TableHead>{t("requests.columns.status")}</TableHead>
                  <TableHead>{t("requests.columns.actions")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {requests.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell>{r.revieweeName}</TableCell>
                    <TableCell>
                      {t(`requests.kind.${r.relationship}`)}
                    </TableCell>
                    <TableCell>
                      {r.reviewerMissing
                        ? t("requests.reviewerMissing")
                        : (r.reviewerName ?? "—")}
                    </TableCell>
                    <TableCell>{t(`requests.status.${r.status}`)}</TableCell>
                    <TableCell>
                      {open && !r.removed && r.status === "submitted" ? (
                        <ActionButton
                          size="sm"
                          action={reopenRequestAction.bind(null, r.id)}
                        >
                          {t("requests.reopen")}
                        </ActionButton>
                      ) : null}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </Panel>
      )}
    </>
  );
}

export default function CycleDetailPage(
  props: PageProps<"/[locale]/settings/cycles/[id]">,
) {
  return (
    <main className="mx-auto flex w-full max-w-6xl flex-col gap-8 p-6 lg:p-10">
      <Suspense fallback={<div aria-busy="true" className="h-40" />}>
        <HrOnly>
          <CycleDetail {...props} />
        </HrOnly>
      </Suspense>
    </main>
  );
}
