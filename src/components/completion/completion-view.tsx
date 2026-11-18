import { ClipboardCheck, UserRound, Users } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { MetricCard } from "@/components/experience";
import { TableView, pct } from "@/components/insights/parts";
import { ProgressBar } from "@/components/progress-bar";
import type {
  CompletionDelta,
  CompletionDeltaRow,
  CompletionGroup,
} from "@/modules/analytics/completion/types";

type Deltas = Pick<CompletionDeltaRow, "selfDelta" | "managerDelta"> | null;
type Side = "self" | "manager";

/**
 * A difference in percentage points with the cycle before: an arrow, the signed
 * number and a word, so it never rests on color. `undefined`: there is no
 * earlier cycle, nothing to show; `null`: no rate to compare.
 */
export function Delta({ value }: { value: number | null | undefined }) {
  const t = useTranslations("Completion.delta");
  const format = useFormatter();
  if (value === undefined) return null;
  if (value === null) {
    return (
      <span className="text-muted-foreground" title={t("noData")}>
        <span aria-hidden="true">–</span>
        <span className="sr-only">{t("noData")}</span>
      </span>
    );
  }
  const arrow = value > 0 ? "▲" : value < 0 ? "▼" : "▬";
  const word = value > 0 ? t("up") : value < 0 ? t("down") : t("same");
  const text = format.number(value, {
    maximumFractionDigits: 1,
    signDisplay: "exceptZero",
  });
  return (
    <span
      className={`delta-pill ${value < 0 ? "delta-down" : value > 0 ? "delta-up" : ""}`}
      data-testid="delta"
    >
      <span aria-hidden="true">{arrow} </span>
      <span className="sr-only">{word} </span>
      {t("pp", { value: text })}
    </span>
  );
}

const of = (group: CompletionGroup, side: Side) =>
  side === "self"
    ? {
        rate: group.selfRate,
        submitted: group.selfSubmitted,
        applicable: group.selfApplicable,
      }
    : {
        rate: group.managerRate,
        submitted: group.managerSubmitted,
        applicable: group.managerApplicable,
      };

/** The whole cycle, one side: the percentage, the count and the change. */
function TotalTile({
  side,
  group,
  delta,
  featured,
}: {
  side: Side;
  group: CompletionGroup;
  delta: number | null | undefined;
  featured: boolean;
}) {
  const t = useTranslations("Completion.summary");
  const { rate, submitted, applicable } = of(group, side);
  return (
    <MetricCard
      featured={featured}
      label={t(side)}
      icon={
        side === "self" ? (
          <UserRound className="size-5" />
        ) : (
          <Users className="size-5" />
        )
      }
      value={rate === null ? t("notApplicable") : `${pct(rate)} %`}
      note={rate === null ? undefined : t("sent", { submitted, applicable })}
    >
      {rate === null ? null : (
        <div className="flex flex-wrap items-center gap-3">
          <ProgressBar
            percent={rate * 100}
            label={t("meter", {
              side: t(side),
              group: t("total"),
              submitted,
              applicable,
            })}
            figure={`${submitted}/${applicable}`}
          />
          <Delta value={delta} />
        </div>
      )}
    </MetricCard>
  );
}

/** One group, one side: its bar with the count, the percentage and the change. */
function GroupRow({
  side,
  group,
  label,
  people,
  delta,
}: {
  side: Side;
  group: CompletionGroup;
  label: string;
  people: string;
  delta: number | null | undefined;
}) {
  const t = useTranslations("Completion.summary");
  const { rate, submitted, applicable } = of(group, side);
  return (
    <li
      className="completion-row"
      data-testid="completion-group"
      data-side={side}
      aria-label={label}
    >
      <div className="flex items-baseline justify-between gap-3">
        <span className="font-medium">{label}</span>
        <span className="text-xs text-muted-foreground">{people}</span>
      </div>
      {rate === null ? (
        <p className="text-sm text-muted-foreground">{t("notApplicable")}</p>
      ) : (
        <div className="flex items-center gap-3">
          <ProgressBar
            percent={rate * 100}
            label={t("meter", {
              side: t(side),
              group: label,
              submitted,
              applicable,
            })}
            figure={
              <span className="text-sm text-foreground">
                {submitted}/{applicable} · {pct(rate)} %
              </span>
            }
          />
          <Delta value={delta} />
        </div>
      )}
    </li>
  );
}

/**
 * Completion of a cycle, as the canvas draws it: three figures for the whole
 * cycle (self assessments, manager assessments, what is pending on each
 * side), the progress of every group as horizontal bars (one card per side),
 * the change in percentage points since the previous cycle, and the same
 * numbers as a table. Direction's data arrives with small groups folded into
 * "Otros" or hidden.
 */
export function CompletionSummaryView({ data }: { data: CompletionDelta }) {
  const t = useTranslations("Completion");
  const { current, previous } = data;
  const hasPrevious = previous !== null;
  if (current.participants === 0) {
    return (
      <p className="text-sm text-muted-foreground">{t("summary.empty")}</p>
    );
  }
  if (current.total === null) {
    return (
      <p role="status" className="text-sm">
        {t("summary.belowMinimum", {
          min: current.minGroupSize ?? 0,
          n: current.participants,
        })}
      </p>
    );
  }
  const change = (v: number | null | undefined) =>
    hasPrevious ? (v ?? null) : undefined;
  const total = current.total;
  const groups = [
    ...current.groups.map((g, i) => ({
      key: `g:${g.key ?? ""}`,
      label: g.label ?? t("summary.unassigned"),
      group: g,
      delta: data.groups[i] ?? null,
    })),
    ...(current.others
      ? [
          {
            key: "others",
            label: t("summary.others"),
            group: current.others,
            delta: data.others as Deltas,
          },
        ]
      : []),
  ];
  const rows = [
    {
      key: "total",
      label: t("summary.total"),
      group: total,
      delta: data.total,
    },
    ...groups,
  ];
  const ratio = (submitted: number, applicable: number) =>
    applicable ? `${submitted}/${applicable}` : t("summary.notApplicable");
  const pending = (side: Side) => {
    const { submitted, applicable } = of(total, side);
    return applicable - submitted;
  };
  const sides: Side[] = ["self", "manager"];
  return (
    <div className="flex flex-col gap-5">
      <p className="text-sm text-muted-foreground" data-testid="delta-hint">
        {previous
          ? t("delta.title", { cycle: previous.cycleName })
          : t("delta.none")}
      </p>
      <section
        className="grid gap-5 sm:grid-cols-3"
        data-testid="completion-group"
        aria-label={t("summary.total")}
      >
        <TotalTile
          side="self"
          group={total}
          delta={change(data.total?.selfDelta)}
          featured
        />
        <TotalTile
          side="manager"
          group={total}
          delta={change(data.total?.managerDelta)}
          featured={false}
        />
        <MetricCard
          label={t("summary.pending")}
          icon={<ClipboardCheck className="size-5" />}
          value={t("summary.pendingValue", {
            self: pending("self"),
            manager: pending("manager"),
          })}
          note={t("summary.pendingNote")}
        />
      </section>
      {groups.length > 0 ? (
        <div className="grid gap-5 lg:grid-cols-2">
          {sides.map((side) => (
            <section
              key={side}
              className="chart-panel gap-4"
              aria-label={`${t("summary.byGroup")} · ${t(`summary.${side}`)}`}
            >
              <h3 className="text-lg">{t(`summary.${side}`)}</h3>
              <ul className="flex flex-col gap-4">
                {groups.map((r) => (
                  <GroupRow
                    key={r.key}
                    side={side}
                    group={r.group}
                    label={r.label}
                    people={t("summary.people", { n: r.group.participants })}
                    delta={change(
                      side === "self"
                        ? r.delta?.selfDelta
                        : r.delta?.managerDelta,
                    )}
                  />
                ))}
              </ul>
            </section>
          ))}
        </div>
      ) : null}
      {current.suppressed > 0 ? (
        <p className="text-sm text-muted-foreground">
          {t("summary.suppressed", {
            n: current.suppressed,
            min: current.minGroupSize ?? 0,
          })}
        </p>
      ) : null}
      {current.minGroupSize === null ? (
        <p className="text-sm text-muted-foreground">
          {t("summary.sources", current.sources)}
        </p>
      ) : null}
      <TableView
        head={[
          t("summary.columns.group"),
          t("summary.columns.participants"),
          t("summary.columns.self"),
          t("summary.columns.manager"),
        ]}
        rows={rows.map((r) => [
          r.label,
          r.group.participants,
          ratio(r.group.selfSubmitted, r.group.selfApplicable),
          ratio(r.group.managerSubmitted, r.group.managerApplicable),
        ])}
      />
    </div>
  );
}
