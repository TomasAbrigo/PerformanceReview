import {
  CalendarDays,
  ChartNoAxesCombined,
  CircleCheck,
  ClipboardCheck,
  Database,
  Fingerprint,
  Target,
  TriangleAlert,
  Users,
} from "lucide-react";
import { getTranslations } from "next-intl/server";
import type { ReactNode } from "react";
import { connection } from "next/server";
import { IconTile, MetricCard } from "@/components/experience";
import { db } from "@/db/client";
import { Link } from "@/i18n/navigation";
import { individualScope } from "@/modules/actor/individual-scope";
import { getActor } from "@/modules/actor/server";
import { getDataQuality } from "@/modules/analytics/data-quality";
import {
  listAssessmentCycles,
  listAssessmentParticipants,
} from "@/modules/assessments";
import { listGoals } from "@/modules/goals/browse";
import { countOpenIssues } from "@/modules/identity";
import { insightsScope } from "@/modules/insights/authz";
import { kpiThresholds, percentTone } from "@/modules/insights/tone";
import {
  listPendingSelfReviews,
  listTeamReviews,
} from "@/modules/review-capture";
import { cycleName, localizeCycles } from "@/modules/review-core/cycle-name";
import { getSettings } from "@/modules/settings";

type Attention = {
  key: string;
  href: string;
  text: string;
  count?: number;
  icon: ReactNode;
  tone: "risk" | "watch";
};

const pct = (n: number, total: number) =>
  total ? Math.round((n / total) * 100) : 0;

/**
 * The signal of the home: the current cycle's KPIs in the actor's own scope
 * (assessments complete and pending, goals completed and overdue, each with
 * its scale and tone and a link to the list filtered by it), and what needs
 * the actor's attention: their own self review, their team's reviews, and
 * for People the identity queue and the data-quality cases. Every count
 * comes from the same queries the lists use, so they agree.
 */
export async function HomeSignal({ locale }: { locale: string }) {
  await connection();
  const [t, actor, settings] = await Promise.all([
    getTranslations("Home.signal"),
    getActor(),
    getSettings(db),
  ]);
  const thresholds = kpiThresholds(settings);
  const scope = individualScope(actor);
  const individual = scope.kind !== "none" && actor.role !== "direction";

  const cycles = individual
    ? localizeCycles(await listAssessmentCycles(db, actor), locale)
    : [];
  const cycle = cycles[0];
  const [participants, goals, pendingSelf, team, identityOpen, quality] =
    await Promise.all([
      cycle ? listAssessmentParticipants(db, actor, cycle.id) : null,
      cycle ? listGoals(db, actor, { cycleId: cycle.id }) : null,
      listPendingSelfReviews(db, actor),
      actor.role === "manager" ? listTeamReviews(db, actor) : [],
      actor.role === "hr" ? countOpenIssues(db) : 0,
      actor.role === "hr" ? getDataQuality(db) : [],
    ]);

  const attention: Attention[] = [];
  for (const r of pendingSelf) {
    attention.push({
      key: `self-${r.requestId}`,
      href: `/assessments/requests/${r.requestId}`,
      text: t("attention.self", {
        cycle: cycleName(
          { name: r.cycleName, localizedName: r.localizedName },
          locale,
        ),
      }),
      icon: <ClipboardCheck className="size-5" />,
      tone: "watch",
    });
  }
  const teamToWrite = team.filter((r) => r.managerStatus === "draft").length;
  if (teamToWrite > 0) {
    attention.push({
      key: "team",
      href: "/assessments",
      text: t("attention.team", { n: teamToWrite }),
      count: teamToWrite,
      icon: <Users className="size-5" />,
      tone: "watch",
    });
  }
  if (goals && goals.counts.overdue > 0 && actor.role !== "hr") {
    attention.push({
      key: "overdue",
      href: `/goals?state=overdue`,
      text: t("attention.overdue", { n: goals.counts.overdue }),
      count: goals.counts.overdue,
      icon: <CalendarDays className="size-5" />,
      tone: "risk",
    });
  }
  if (identityOpen > 0) {
    attention.push({
      key: "identity",
      href: "/imports/identity",
      text: t("attention.identity", { n: identityOpen }),
      count: identityOpen,
      icon: <Fingerprint className="size-5" />,
      tone: "risk",
    });
  }
  const failedRuns = quality.find((q) => q.key === "failed_runs")?.count ?? 0;
  if (failedRuns > 0) {
    attention.push({
      key: "runs",
      href: "/imports/runs",
      text: t("attention.failedRuns", { n: failedRuns }),
      count: failedRuns,
      icon: <TriangleAlert className="size-5" />,
      tone: "risk",
    });
  }
  const qualityOpen = quality.filter(
    (q) => q.count > 0 && q.key !== "identity_open" && q.key !== "failed_runs",
  );
  if (qualityOpen.length > 0) {
    const cases = qualityOpen.reduce((sum, q) => sum + q.count, 0);
    attention.push({
      key: "quality",
      href: "/data-quality",
      text: t("attention.quality", { n: cases, kinds: qualityOpen.length }),
      count: cases,
      icon: <Database className="size-5" />,
      tone: "watch",
    });
  }

  const analysis = insightsScope(actor).kind !== "none";
  const total = participants
    ? participants.counts.complete +
      participants.counts.partial +
      participants.counts.pending
    : 0;
  const goalsTotal = goals
    ? Object.values(goals.counts).reduce((a, b) => a + b, 0)
    : 0;
  const scale = (value: number, label: string) => ({
    value,
    min: 0,
    max: 100,
    label,
    minLabel: "0 %",
    maxLabel: "100 %",
  });
  const showKpis = participants && cycle && scope.kind !== "own";

  return (
    <div className="flex flex-col gap-8">
      {showKpis ? (
        <section aria-labelledby="home-kpis" className="flex flex-col gap-4">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 id="home-kpis" className="text-2xl">
              {t("kpis", { cycle: cycle.name })}
            </h2>
            <p className="text-sm text-muted-foreground">
              {t(scope.kind === "team" ? "scope.team" : "scope.all")}
            </p>
          </div>
          <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-4">
            <MetricCard
              label={t("complete")}
              value={`${pct(participants.counts.complete, total)} %`}
              href={`/assessments?cycle=${cycle.id}&progress=complete`}
              status={
                total
                  ? percentTone(
                      pct(participants.counts.complete, total),
                      thresholds,
                    )
                  : undefined
              }
              scale={scale(
                pct(participants.counts.complete, total),
                t("completeNote", {
                  done: participants.counts.complete,
                  total,
                }),
              )}
              note={t("completeNote", {
                done: participants.counts.complete,
                total,
              })}
              icon={<ClipboardCheck className="size-5" />}
            />
            <MetricCard
              label={t("pending")}
              value={participants.counts.pending}
              href={`/assessments?cycle=${cycle.id}&progress=pending`}
              status={
                total
                  ? percentTone(
                      pct(participants.counts.pending, total),
                      thresholds,
                      "down",
                    )
                  : undefined
              }
              scale={scale(
                pct(participants.counts.pending, total),
                t("ofParticipants", {
                  pct: pct(participants.counts.pending, total),
                }),
              )}
              note={t("ofParticipants", {
                pct: pct(participants.counts.pending, total),
              })}
              icon={<Users className="size-5" />}
            />
            {goals ? (
              <>
                <MetricCard
                  label={t("goalsCompleted")}
                  value={`${pct(goals.counts.completed, goalsTotal)} %`}
                  href={`/goals?cycle=${cycle.id}&state=completed`}
                  scale={scale(
                    pct(goals.counts.completed, goalsTotal),
                    t("goalsNote", {
                      done: goals.counts.completed,
                      total: goalsTotal,
                    }),
                  )}
                  note={t("goalsNote", {
                    done: goals.counts.completed,
                    total: goalsTotal,
                  })}
                  icon={<Target className="size-5" />}
                />
                <MetricCard
                  label={t("goalsOverdue")}
                  value={goals.counts.overdue}
                  href={`/goals?cycle=${cycle.id}&state=overdue`}
                  status={
                    goalsTotal
                      ? percentTone(
                          pct(goals.counts.overdue, goalsTotal),
                          thresholds,
                          "down",
                        )
                      : undefined
                  }
                  scale={scale(
                    pct(goals.counts.overdue, goalsTotal),
                    t("ofGoals", {
                      pct: pct(goals.counts.overdue, goalsTotal),
                    }),
                  )}
                  note={t("ofGoals", {
                    pct: pct(goals.counts.overdue, goalsTotal),
                  })}
                  icon={<CalendarDays className="size-5" />}
                />
              </>
            ) : null}
          </div>
        </section>
      ) : null}
      <section
        aria-labelledby="home-attention"
        className="flex flex-col gap-4"
        data-testid="home-attention"
      >
        <h2 id="home-attention" className="text-2xl">
          {t("attention.title")}
        </h2>
        {attention.length > 0 ? (
          <ul className="flex flex-col divide-y divide-border rounded-xl border border-border bg-card">
            {attention.map((a) => (
              <li key={a.key}>
                <Link
                  href={a.href}
                  className="flex items-center gap-4 px-5 py-4 hover:bg-brand-fog/60"
                >
                  <IconTile>{a.icon}</IconTile>
                  <span className="min-w-0 flex-1 text-sm">{a.text}</span>
                  {a.count !== undefined ? (
                    <span className="tone-pill tabular-nums" data-tone={a.tone}>
                      {a.count}
                    </span>
                  ) : null}
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <p className="flex items-center gap-3 rounded-xl border border-border bg-card px-5 py-4 text-sm text-muted-foreground">
            <CircleCheck className="size-5 text-status-done" aria-hidden />
            {t("attention.none")}
          </p>
        )}
        {analysis ? (
          <Link
            href="/insights/executive"
            className="inline-flex items-center gap-2 self-start text-sm text-primary underline-offset-4 hover:underline"
          >
            <ChartNoAxesCombined className="size-4" aria-hidden="true" />
            {t("analysis")}
          </Link>
        ) : null}
      </section>
    </div>
  );
}
