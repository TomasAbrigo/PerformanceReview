import { useTranslations } from "next-intl";
import type { ReactNode } from "react";
import { ReasonBadge } from "@/components/identity/reason-badge";
import { useRunFormat } from "@/components/ingest/use-run-format";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Link } from "@/i18n/navigation";
import type es from "@/messages/es.json";
import type {
  DataQualityIndicator,
  IncompleteSnapshotItem,
  ParticipantItem,
} from "@/modules/analytics/data-quality";

type Column = keyof (typeof es)["DataQuality"]["columns"];

function PersonLink({ id, name }: { id: string; name: string }) {
  return (
    <Link href={`/people/${id}`} className="hover:underline">
      {name}
    </Link>
  );
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
    <Table>
      <TableHeader>
        <TableRow>
          {columns.map((c) => (
            <TableHead key={c}>{t(c)}</TableHead>
          ))}
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row) => (
          <TableRow key={row.key}>
            {row.cells.map((cell, i) => (
              <TableCell key={columns[i]}>{cell ?? "—"}</TableCell>
            ))}
          </TableRow>
        ))}
      </TableBody>
    </Table>
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
          <h2 className="font-medium">
            <Link href={`/cycles/${cycleId}`} className="hover:underline">
              {group.name}
            </Link>{" "}
            <span className="text-sm font-normal text-muted-foreground">
              {t("participantsCount", { count: group.items.length })}
            </span>
          </h2>
          <CaseTable
            columns={["person", ...extras.map((e) => e.column)]}
            rows={group.items.map((item) => ({
              key: item.id,
              cells: [
                <PersonLink
                  key="p"
                  id={item.personId}
                  name={item.displayName}
                />,
                ...extras.map((e) => e.cell(item)),
              ],
            }))}
          />
        </section>
      ))}
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
    case "no_manager":
      return (
        <CaseTable
          columns={["name", "email", "managerRaw"]}
          rows={indicator.items.map((i) => ({
            key: i.id,
            cells: [
              <span key="n" className="flex items-center gap-2">
                <PersonLink id={i.id} name={i.displayName} />
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
              <PersonLink key="p" id={i.personId} name={i.displayName} />,
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
              <PersonLink key="p" id={i.personId} name={i.displayName} />,
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
            cells: [
              <PersonLink key="p" id={i.id} name={i.displayName} />,
              i.workEmail,
            ],
          }))}
        />
      );
    case "goals_without_employment":
      return (
        <CaseTable
          columns={["goal", "owner"]}
          rows={indicator.items.map((i) => ({
            key: i.id,
            cells: [
              i.title,
              <PersonLink key="p" id={i.personId} name={i.displayName} />,
            ],
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
              <PersonLink key="p" id={i.id} name={i.displayName} />,
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
                  <PersonLink
                    key="r"
                    id={item.reviewerPersonId}
                    name={item.reviewerName}
                  />
                ) : null,
            },
            {
              column: "snapshotManager",
              cell: (item) =>
                item.snapManagerId && item.snapManagerName ? (
                  <PersonLink
                    key="m"
                    id={item.snapManagerId}
                    name={item.snapManagerName}
                  />
                ) : null,
            },
          ]}
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
      <Link href="/data-quality" className="text-sm hover:underline">
        {t("back")}
      </Link>
      <div>
        <h1 className="text-2xl font-semibold">
          {t(`indicators.${indicator.key}.title`)}
        </h1>
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
