import { CardCollection } from "@/components/card-collection";
import { useTranslations } from "next-intl";
import type { ReactNode } from "react";
import { ReasonBadge } from "@/components/identity/reason-badge";
import { useRunFormat } from "@/components/ingest/use-run-format";
import { Badge } from "@/components/ui/badge";
import { Link } from "@/i18n/navigation";
import type es from "@/messages/es.json";
import type {
  DataQualityIndicator,
  IncompleteSnapshotItem,
  ParticipantItem,
  RetainedRowItem,
} from "@/modules/analytics/data-quality";

type Column = keyof (typeof es)["DataQuality"]["columns"];

function PersonName({ name }: { name: string }) {
  return <span>{name}</span>;
}

/** A table with a localized header row; `rows` are keyed cells. */
function CaseTable({
  columns,
  rows,
}: {
  columns: Column[];
  rows: { key: string; cells: ReactNode[] }[];
}) {
  const t = useTranslations("DataQuality.columns");
  return (
    <CardCollection gridClassName="dense-list" role="group" initialCount={20}>
      {rows.map((row) => (
        <article
          key={row.key}
          className="dense-row md:!grid-cols-[minmax(0,1fr)_minmax(0,2.5fr)]"
          aria-labelledby={`case-${row.key}`}
        >
          <div className="dense-name min-w-0 break-words">
            <small>{t(columns[0])}</small>
            <div id={`case-${row.key}`} className="font-medium">
              {row.cells[0] ?? "—"}
            </div>
          </div>
          <dl className="dense-facts">
            {row.cells.slice(1).map((cell, i) => (
              <div key={columns[i + 1]} className="min-w-0 break-words">
                <dt>{t(columns[i + 1])}</dt>
                <dd>{cell ?? "—"}</dd>
              </div>
            ))}
          </dl>
        </article>
      ))}
    </CardCollection>
  );
}

/** Participants grouped by cycle (items come ordered by cycle), one table each. */
function ByCycle<T extends ParticipantItem>({
  items,
  extras = [],
}: {
  items: T[];
  extras?: { column: Column; cell: (item: T) => ReactNode }[];
}) {
  const t = useTranslations("DataQuality");
  const groups = new Map<string, { name: string; items: T[] }>();
  for (const item of items) {
    const group = groups.get(item.cycleId);
    if (group) group.items.push(item);
    else groups.set(item.cycleId, { name: item.cycleName, items: [item] });
  }
  return (
    <div className="flex flex-col gap-6">
      {[...groups].map(([cycleId, group]) => (
        <section key={cycleId} className="flex flex-col gap-2">
          <h2 className="text-lg">
            {group.name}{" "}
            <span className="text-sm font-normal text-muted-foreground">
              {t("participantsCount", { count: group.items.length })}
            </span>
          </h2>
          <CaseTable
            columns={["person", ...extras.map((e) => e.column)]}
            rows={group.items.map((item) => ({
              key: item.id,
              cells: [
                <PersonName key="p" name={item.displayName} />,
                ...extras.map((e) => e.cell(item)),
              ],
            }))}
          />
        </section>
      ))}
    </div>
  );
}

/** Held-back report rows per cycle, with what they hold back and their share of the file. */
function RetainedByCycle({ items }: { items: RetainedRowItem[] }) {
  const t = useTranslations("DataQuality");
  const groups = new Map<string, RetainedRowItem[]>();
  for (const item of items) {
    groups.set(item.cycleId, [...(groups.get(item.cycleId) ?? []), item]);
  }
  return (
    <div className="flex flex-col gap-6">
      {[...groups].map(([cycleId, rows]) => {
        const fileRows = rows[0].fileRows;
        const sides = rows.reduce((s, r) => s + r.sides, 0);
        const answers = rows.reduce((s, r) => s + r.answers, 0);
        const pct =
          fileRows > 0 ? Math.round((rows.length / fileRows) * 1000) / 10 : 0;
        return (
          <section key={cycleId} className="flex flex-col gap-2">
            <h2 className="text-lg">{rows[0].cycleName}</h2>
            <p className="text-sm text-muted-foreground">
              {t("retainedCycle", {
                rows: rows.length,
                fileRows,
                pct,
                sides,
                answers,
              })}
            </p>
            <CaseTable
              columns={["name", "email", "sourceId", "sides", "answers"]}
              rows={rows.map((r) => ({
                key: r.id,
                cells: [
                  <Link
                    key="n"
                    href={`/imports/identity/${r.id}`}
                    className="hover:underline"
                  >
                    {r.displayName ?? t("unnamed")}
                  </Link>,
                  r.workEmail,
                  r.sourceId,
                  r.sides,
                  r.answers,
                ],
              }))}
            />
          </section>
        );
      })}
    </div>
  );
}

function Cases({ indicator }: { indicator: DataQualityIndicator }) {
  const t = useTranslations("DataQuality");
  const { dateTime } = useRunFormat();

  switch (indicator.key) {
    case "identity_open":
      return (
        <CaseTable
          columns={["name", "sourceId", "reason", "detected"]}
          rows={indicator.items.map((i) => ({
            key: i.id,
            cells: [
              <Link
                key="n"
                href={`/imports/identity/${i.id}`}
                className="hover:underline"
              >
                {i.displayName ?? t("unnamed")}
              </Link>,
              i.sourceId,
              <ReasonBadge key="r" reason={i.reason} />,
              dateTime(i.createdAt),
            ],
          }))}
        />
      );
    case "identity_retained_rows":
      return <RetainedByCycle items={indicator.items} />;
    case "no_manager":
      return (
        <CaseTable
          columns={["name", "email", "managerRaw"]}
          rows={indicator.items.map((i) => ({
            key: i.id,
            cells: [
              <span key="n" className="flex items-center gap-2">
                <PersonName name={i.displayName} />
                {i.isTop ? (
                  <Badge variant="secondary" title={t("topHelp")}>
                    {t("badges.top")}
                  </Badge>
                ) : null}
              </span>,
              i.workEmail,
              i.managerRaw,
            ],
          }))}
        />
      );
    case "participants_no_manager":
      return <ByCycle items={indicator.items} />;
    case "participants_incomplete_snapshot":
      return (
        <ByCycle<IncompleteSnapshotItem>
          items={indicator.items}
          extras={[
            {
              column: "missing",
              cell: (item) =>
                item.missing.map((m) => t(`missing.${m}`)).join(", "),
            },
          ]}
        />
      );
    case "job_history_overlap_gap":
      return (
        <CaseTable
          columns={["person", "kind", "from", "to"]}
          rows={indicator.items.map((i) => ({
            key: i.id,
            cells: [
              <PersonName key="p" name={i.displayName} />,
              t(`kinds.${i.kind}`),
              i.from,
              i.to ?? t("noEnd"),
            ],
          }))}
        />
      );
    case "job_history_open_after_exit":
      return (
        <CaseTable
          columns={["person", "openSince", "terminationDate"]}
          rows={indicator.items.map((i) => ({
            key: i.id,
            cells: [
              <PersonName key="p" name={i.displayName} />,
              i.validFrom,
              i.terminationDate,
            ],
          }))}
        />
      );
    case "active_without_job_history":
      return (
        <CaseTable
          columns={["name", "email"]}
          rows={indicator.items.map((i) => ({
            key: i.id,
            cells: [<PersonName key="p" name={i.displayName} />, i.workEmail],
          }))}
        />
      );
    case "goals_without_employment":
      return (
        <CaseTable
          columns={["goal", "owner"]}
          rows={indicator.items.map((i) => ({
            key: i.id,
            cells: [i.title, <PersonName key="p" name={i.displayName} />],
          }))}
        />
      );
    case "duplicate_names":
      return (
        <CaseTable
          columns={["name", "email", "duplicates"]}
          rows={indicator.items.map((i) => ({
            key: i.id,
            cells: [
              <PersonName key="p" name={i.displayName} />,
              i.workEmail,
              t("duplicatesCount", { count: i.duplicates }),
            ],
          }))}
        />
      );
    case "failed_runs":
      return (
        <CaseTable
          columns={["started", "entity", "source", "error"]}
          rows={indicator.items.map((i) => ({
            key: i.id,
            cells: [
              <Link
                key="s"
                href={`/imports/runs/${i.id}`}
                className="hover:underline"
              >
                {dateTime(i.startedAt)}
              </Link>,
              i.entity,
              i.sourceSystem,
              i.error,
            ],
          }))}
        />
      );
    case "reviewer_mismatch":
      return (
        <ByCycle
          items={indicator.items}
          extras={[
            {
              column: "reviewer",
              cell: (item) =>
                item.reviewerPersonId && item.reviewerName ? (
                  <PersonName key="r" name={item.reviewerName} />
                ) : null,
            },
            {
              column: "snapshotManager",
              cell: (item) =>
                item.snapManagerId && item.snapManagerName ? (
                  <PersonName key="m" name={item.snapManagerName} />
                ) : null,
            },
          ]}
        />
      );
    case "unmapped_answers":
      return (
        <CaseTable
          columns={["cycle", "column", "rawValue", "answerReason", "detected"]}
          rows={indicator.items.map((i) => ({
            key: i.id,
            cells: [
              i.cycleName,
              <code key="k">{i.columnKey}</code>,
              i.rawValue,
              t(`answerReasons.${i.reason}`),
              dateTime(i.createdAt),
            ],
          }))}
        />
      );
  }
}

/** The full list of cases behind one indicator. */
export function IndicatorDetail({
  indicator,
}: {
  indicator: DataQualityIndicator;
}) {
  const t = useTranslations("DataQuality");
  return (
    <div className="flex flex-col gap-4">
      <Link href="/data-quality" className="text-sm underline">
        {t("back")}
      </Link>
      <div>
        <h1>{t(`indicators.${indicator.key}.title`)}</h1>
        <p className="text-muted-foreground">
          {t(`indicators.${indicator.key}.description`)}
        </p>
      </div>
      <p className="text-sm text-muted-foreground">
        {t("count", { count: indicator.count })}
      </p>
      {indicator.count === 0 ? (
        <p>{t("empty")}</p>
      ) : (
        <Cases indicator={indicator} />
      )}
    </div>
  );
}
