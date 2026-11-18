import { ClipboardCheck, UserRound, UserRoundCheck } from "lucide-react";
import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { HrOnly } from "@/components/access/hr-only";
import { ActionButton } from "@/components/cycles/action-button";
import { AddParticipant } from "@/components/cycles/add-participant";
import { ParticipantPicker } from "@/components/cycles/participant-picker";
import { CardCollection } from "@/components/card-collection";
import { EmptyState, MetricCard, PageSkeleton } from "@/components/experience";
import { Panel } from "@/components/insights/parts";
import { PageHeader } from "@/components/page-header";
import { groupKicker } from "@/components/page-kicker";
import { Badge } from "@/components/ui/badge";
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
import { getSettings } from "@/modules/settings";
import { kpiThresholds, percentTone } from "@/modules/insights/tone";

const percentOf = ({
  submitted,
  total,
}: {
  submitted: number;
  total: number;
}) => (total === 0 ? 0 : Math.round((submitted / total) * 100));

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
  const thresholds = kpiThresholds(await getSettings(db));
  const requests = draft ? [] : await listCycleRequests(db, actor, id);

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
          <div className="grid gap-5 sm:grid-cols-2">
            {(["self", "manager"] as const).map((kind) => (
              <MetricCard
                key={kind}
                label={t(`progress.${kind}`)}
                value={`${percentOf(progress[kind])} %`}
                note={t("progress.of", progress[kind])}
                status={
                  progress[kind].total > 0
                    ? percentTone(percentOf(progress[kind]), thresholds)
                    : undefined
                }
                scale={{
                  value: percentOf(progress[kind]),
                  min: 0,
                  max: 100,
                  label: t("progress.of", progress[kind]),
                  minLabel: "0 %",
                  maxLabel: "100 %",
                }}
                icon={
                  kind === "self" ? (
                    <UserRound className="size-5" />
                  ) : (
                    <UserRoundCheck className="size-5" />
                  )
                }
              />
            ))}
          </div>
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
          <EmptyState icon={<ClipboardCheck className="size-6" />}>
            {t("withoutManager.none")}
          </EmptyState>
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
            <CardCollection gridClassName="dense-list" initialCount={15}>
              {cycle.participants.map((p) => (
                <article
                  key={p.id}
                  aria-label={p.displayName}
                  className="dense-row md:!grid-cols-[minmax(0,1.4fr)_minmax(0,2fr)_auto]"
                >
                  <div className="dense-name">
                    <h3 className="text-base font-medium">{p.displayName}</h3>
                    <small>
                      {p.removedAt
                        ? t("participants.removed")
                        : t("participants.active")}
                    </small>
                  </div>
                  <dl className="dense-facts !grid-cols-2">
                    <div>
                      <dt>{t("participants.columns.area")}</dt>
                      <dd>{p.snapDepartment ?? "—"}</dd>
                    </div>
                    <div>
                      <dt>{t("participants.columns.manager")}</dt>
                      <dd>{p.snapManagerName ?? "—"}</dd>
                    </div>
                  </dl>
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
                  ) : (
                    <span />
                  )}
                </article>
              ))}
            </CardCollection>
          </>
        )}
      </Panel>

      {draft ? null : (
        <Panel id="cycle-requests" title={t("requests.title")}>
          {requests.length === 0 ? (
            <EmptyState>{t("requests.empty")}</EmptyState>
          ) : (
            <CardCollection gridClassName="dense-list" initialCount={15}>
              {requests.map((r) => (
                <article
                  key={r.id}
                  aria-label={r.revieweeName}
                  className="dense-row md:!grid-cols-[minmax(0,1.4fr)_minmax(0,2fr)_auto]"
                >
                  <div className="dense-name">
                    <h3 className="text-base font-medium">{r.revieweeName}</h3>
                    <small>{t(`requests.kind.${r.relationship}`)}</small>
                  </div>
                  <dl className="dense-facts !grid-cols-2">
                    <div>
                      <dt>{t("requests.columns.reviewer")}</dt>
                      <dd>
                        {r.reviewerMissing
                          ? t("requests.reviewerMissing")
                          : (r.reviewerName ?? "—")}
                      </dd>
                    </div>
                    <div>
                      <dt>{t("requests.columns.status")}</dt>
                      <dd>
                        <span
                          className="tone-pill"
                          data-tone={
                            r.status === "submitted"
                              ? "good"
                              : r.status === "draft"
                                ? "watch"
                                : undefined
                          }
                        >
                          {t(`requests.status.${r.status}`)}
                        </span>
                      </dd>
                    </div>
                  </dl>
                  {open && !r.removed && r.status === "submitted" ? (
                    <ActionButton
                      size="sm"
                      action={reopenRequestAction.bind(null, r.id)}
                    >
                      {t("requests.reopen")}
                    </ActionButton>
                  ) : (
                    <span />
                  )}
                </article>
              ))}
            </CardCollection>
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
      <Suspense fallback={<PageSkeleton />}>
        <HrOnly>
          <CycleDetail {...props} />
        </HrOnly>
      </Suspense>
    </main>
  );
}
