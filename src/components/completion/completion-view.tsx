import { useFormatter, useTranslations } from "next-intl";
import { Meter, TableView, pct } from "@/components/dashboards/parts";
import type {
  CompletionDelta,
  CompletionDeltaRow,
  CompletionGroup,
} from "@/modules/analytics/completion/types";

type Deltas = Pick<CompletionDeltaRow, "selfDelta" | "managerDelta"> | null;

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
    <span className="whitespace-nowrap tabular-nums" data-testid="delta">
      <span aria-hidden="true">{arrow} </span>
      <span className="sr-only">{word} </span>
      {t("pp", { value: text })}
    </span>
  );
}

/** One side of an assessment of a group: meter, percentage, count and delta. */
function Side({
  side,
  group,
  groupLabel,
  delta,
}: {
  side: "self" | "manager";
  group: CompletionGroup;
  groupLabel: string;
  /** undefined: no earlier cycle. */
  delta: number | null | undefined;
}) {
  const t = useTranslations("Completion.summary");
  const rate = side === "self" ? group.selfRate : group.managerRate;
  const submitted =
    side === "self" ? group.selfSubmitted : group.managerSubmitted;
  const applicable =
    side === "self" ? group.selfApplicable : group.managerApplicable;
  if (rate === null) {
    return (
      <span className="text-sm text-muted-foreground">
        {t("notApplicable")}
      </span>
    );
  }
  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <Meter
        width={140}
        value={rate}
        label={t("meter", {
          side: t(side),
          group: groupLabel,
          submitted,
          applicable,
        })}
      />
      <span className="w-12 tabular-nums">{pct(rate)} %</span>
      <span className="text-muted-foreground tabular-nums">
        {submitted}/{applicable}
      </span>
      <Delta value={delta} />
    </div>
  );
}

function Row({
  group,
  label,
  delta,
  hasPrevious,
}: {
  group: CompletionGroup;
  label: string;
  delta: Deltas;
  hasPrevious: boolean;
}) {
  const t = useTranslations("Completion.summary");
  const change = (v: number | null | undefined) =>
    hasPrevious ? (v ?? null) : undefined;
  return (
    <li
      className="grid items-center gap-x-6 gap-y-1 border-t py-2 first:border-t-0 md:grid-cols-[12rem_1fr_1fr]"
      data-testid="completion-group"
    >
      <div>
        <div className="font-medium">{label}</div>
        <div className="text-sm text-muted-foreground">
          {t("people", { n: group.participants })}
        </div>
      </div>
      <Side
        side="self"
        group={group}
        groupLabel={label}
        delta={change(delta?.selfDelta)}
      />
      <Side
        side="manager"
        group={group}
        groupLabel={label}
        delta={change(delta?.managerDelta)}
      />
    </li>
  );
}

/**
 * Completion of a cycle: the whole cycle and each group with two meters (self
 * and manager assessments submitted), the change in percentage points since
 * the previous cycle, and the same numbers as a table. Direction's data
 * arrives with small groups folded into "Otros" or hidden.
 */
export function CompletionSummaryView({ data }: { data: CompletionDelta }) {
  const t = useTranslations("Completion");
  const { current, previous } = data;
  const hasPrevious = previous !== null;
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
  if (current.participants === 0) {
    return (
      <p className="text-sm text-muted-foreground">{t("summary.empty")}</p>
    );
  }
  const rows = [
    {
      key: "total",
      label: t("summary.total"),
      group: current.total,
      delta: data.total,
    },
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
            delta: data.others,
          },
        ]
      : []),
  ];
  const ratio = (submitted: number, applicable: number) =>
    applicable ? `${submitted}/${applicable}` : t("summary.notApplicable");
  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-muted-foreground" data-testid="delta-hint">
        {previous
          ? t("delta.title", { cycle: previous.cycleName })
          : t("delta.none")}
      </p>
      <ul className="flex flex-col">
        {rows.map((r) => (
          <Row
            key={r.key}
            group={r.group}
            label={r.label}
            delta={r.delta}
            hasPrevious={hasPrevious}
          />
        ))}
      </ul>
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
