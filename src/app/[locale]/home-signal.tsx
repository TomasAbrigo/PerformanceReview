import {
  ArrowRight,
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
import { getFormatter, getTranslations } from "next-intl/server";
import type { ReactNode } from "react";
import { connection } from "next/server";
import { MetricCard, ProgressRing } from "@/components/experience";
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
import {
  kpiThresholds,
  percentTarget,
  percentTone,
} from "@/modules/insights/tone";
import {
  listPendingSelfReviews,
  listTeamReviews,
} from "@/modules/review-capture";
import { listCycles } from "@/modules/review-core";
import { cycleName, localizeCycles } from "@/modules/review-core/cycle-name";
import { latestFirst, pickCycle } from "@/modules/review-core/current-cycle";
import { rememberedCycle } from "@/modules/review-core/remembered-cycle";
import { getSettings } from "@/modules/settings";

type Attention = {
  key: string;
  href: string;
  text: string;
  /** What the reader does there ("Resolver", "Completar"). */
  action: string;
  icon: ReactNode;
  tone: "risk" | "watch";
};

const pct = (n: number, total: number) =>
  total ? Math.round((n / total) * 100) : 0;

/**
 * The signal of the home (#119): the cycle in focus with its progress and
 * one or two things to do about it, the cycle's KPIs in the actor's own
 * scope (each a link to the list filtered by it; a percent sits on its scale
 * with the target marked, a count is just the count), and what needs the
 * actor's attention, each row with its action: their own self review, their
 * team's reviews, and for People the identity queue and the data-quality
 * cases. One cycle for the whole page: the one last chosen in any screen
 * when the actor has it, else the latest period. Every count comes from the
 * same queries the lists use, so they agree.
 */
export async function HomeSignal({ locale }: { locale: string }) {
  await connection();
  const [t, tf, tx, format, actor, settings, remembered] = await Promise.all([
    getTranslations("Home.signal"),
    getTranslations("Home.focus"),
    getTranslations("Experience"),
    getFormatter(),
    getActor(),
    getSettings(db),
    rememberedCycle(),
  ]);
  const thresholds = kpiThresholds(settings);
  const scope = individualScope(actor);
  const individual = scope.kind !== "none" && actor.role !== "direction";
  const analysis = insightsScope(actor).kind !== "none";

  // Who reads people opens on the cycles they have assessments in; who only
  // reads aggregates (direction), on the cycles of the analysis.
  const cycles = individual
    ? localizeCycles(await listAssessmentCycles(db, actor), locale)
    : analysis
      ? latestFirst(
          localizeCycles(await listCycles(db), locale).filter(
            (c) => c.status !== "draft",
          ),
        )
      : [];
  const cycle = pickCycle<{ id: string; name: string }>(
    cycles,
    undefined,
    remembered,
  );
  const [participants, goals, pendingSelf, team, identityOpen, quality] =
    await Promise.all([
      cycle && individual
        ? listAssessmentParticipants(db, actor, cycle.id)
        : null,
      cycle && individual ? listGoals(db, actor, { cycleId: cycle.id }) : null,
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
      action: t("attention.action.self"),
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
      action: t("attention.action.team"),
      icon: <Users className="size-5" />,
      tone: "watch",
    });
  }
  if (goals && goals.counts.overdue > 0 && actor.role !== "hr") {
    attention.push({
      key: "overdue",
      href: `/goals?state=overdue`,
      text: t("attention.overdue", { n: goals.counts.overdue }),
      action: t("attention.action.overdue"),
      icon: <CalendarDays className="size-5" />,
      tone: "risk",
    });
  }
  if (identityOpen > 0) {
    attention.push({
      key: "identity",
      href: "/imports/identity",
      text: t("attention.identity", { n: identityOpen }),
      action: t("attention.action.identity"),
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
      action: t("attention.action.failedRuns"),
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
      action: t("attention.action.quality"),
      icon: <Database className="size-5" />,
      tone: "watch",
    });
  }

  // What is at risk first, then what to watch; the order within each is kept.
  attention.sort(
    (a, b) => Number(b.tone === "risk") - Number(a.tone === "risk"),
  );

  const total = participants
    ? participants.counts.complete +
      participants.counts.partial +
      participants.counts.pending
    : 0;
  const goalsTotal = goals
    ? Object.values(goals.counts).reduce((a, b) => a + b, 0)
    : 0;
  const showKpis = participants && cycle && scope.kind !== "own";
  const completePct = participants
    ? pct(participants.counts.complete, total)
    : 0;
  const completeTone =
    showKpis && total ? percentTone(completePct, thresholds) : undefined;
  // Completion against the target counts the goals that were due by the
  // reference date (a goal not due yet is not a failure); overdue is measured
  // at the same date: today, or the end of the period of a closed cycle.
  const goalsDue = goals?.due ?? { total: 0, completed: 0 };
  const goalsPct = pct(goalsDue.completed, goalsDue.total);
  const asOfText = goals
    ? format.dateTime(new Date(`${goals.asOf}T00:00:00Z`), {
        dateStyle: "medium",
        timeZone: "UTC",
      })
    : "";
  const target = percentTarget(thresholds);

  return (
    <div className="flex flex-col gap-8">
      <section
        className="home-focus"
        aria-labelledby="home-cycle"
        data-testid="home-focus"
      >
        {showKpis ? (
          <ProgressRing percent={completePct} label={tf("progress")} />
        ) : null}
        <div className="flex min-w-0 flex-1 flex-col gap-3">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <p className="kicker text-brand-200">{tf("kicker")}</p>
            {showKpis ? (
              <p className="text-xs text-brand-200">
                {t(scope.kind === "team" ? "scope.team" : "scope.all")}
              </p>
            ) : null}
          </div>
          <h2 id="home-cycle" className="text-2xl text-white lg:text-3xl">
            {cycle ? cycle.name : tf("noCycle")}
          </h2>
          {showKpis ? (
            <p className="flex flex-wrap items-center gap-x-3 gap-y-2 text-sm text-brand-200">
              <Link
                href={`/assessments?cycle=${cycle.id}&progress=complete`}
                className="text-white underline decoration-brand-400/60 decoration-dotted underline-offset-4 hover:text-brand-200"
              >
                {tf("progressNote", {
                  done: participants.counts.complete,
                  total,
                })}
              </Link>
              {completeTone ? (
                <span className="tone-pill" data-tone={completeTone}>
                  {tx(`tone.${completeTone}`)}
                </span>
              ) : null}
              <span>{tf("target", { value: target })}</span>
            </p>
          ) : null}
          {cycle ? (
            <div className="flex flex-wrap gap-3 pt-1">
              {showKpis && total > participants.counts.complete ? (
                <Link
                  href={`/assessments?cycle=${cycle.id}&progress=pending`}
                  className="button-outline"
                >
                  {tf("missing")}
                  <ArrowRight className="ml-2 size-4" aria-hidden="true" />
                </Link>
              ) : null}
              {analysis ? (
                <Link
                  href={`/insights/executive?cycle=${cycle.id}`}
                  className="button-outline home-focus-quiet"
                >
                  <ChartNoAxesCombined
                    className="mr-2 size-4"
                    aria-hidden="true"
                  />
                  {tf("analysis")}
                </Link>
              ) : individual ? (
                <Link
                  href={`/assessments?cycle=${cycle.id}`}
                  className="button-outline"
                >
                  {tf("assessments")}
                  <ArrowRight className="ml-2 size-4" aria-hidden="true" />
                </Link>
              ) : null}
            </div>
          ) : null}
        </div>
      </section>
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
                <Link href={a.href} className="home-attention-row group">
                  <span
                    aria-hidden="true"
                    className="icon-tile"
                    data-tone={a.tone}
                  >
                    {a.icon}
                  </span>
                  <span className="min-w-0 flex-1 text-sm">{a.text}</span>
                  <span className="home-attention-action">
                    {a.action}
                    <ArrowRight className="size-4" aria-hidden="true" />
                  </span>
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
      </section>
      {showKpis ? (
        <section aria-label={cycle.name} className="home-kpis">
          <MetricCard
            label={t("pending")}
            value={participants.counts.pending}
            href={`/assessments?cycle=${cycle.id}&progress=pending`}
            note={t("ofParticipants", {
              pct: pct(participants.counts.pending, total),
            })}
            icon={<Users className="size-5" />}
          />
          {goals ? (
            <>
              <MetricCard
                label={t("goalsCompleted")}
                value={goalsDue.total ? `${goalsPct} %` : "—"}
                href={`/goals?cycle=${cycle.id}&state=completed`}
                status={
                  goalsDue.total ? percentTone(goalsPct, thresholds) : undefined
                }
                scale={
                  goalsDue.total
                    ? {
                        value: goalsPct,
                        min: 0,
                        max: 100,
                        label: t("goalsNote", {
                          done: goalsDue.completed,
                          total: goalsDue.total,
                          date: asOfText,
                        }),
                        minLabel: "0 %",
                        maxLabel: "100 %",
                        target: { value: target, text: `${target} %` },
                      }
                    : undefined
                }
                note={
                  goalsDue.total
                    ? t("goalsNote", {
                        done: goalsDue.completed,
                        total: goalsDue.total,
                        date: asOfText,
                      })
                    : t("goalsNoneDue", { date: asOfText })
                }
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
                note={t("ofGoals", {
                  pct: pct(goals.counts.overdue, goalsTotal),
                  date: asOfText,
                })}
                icon={<CalendarDays className="size-5" />}
              />
            </>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}
