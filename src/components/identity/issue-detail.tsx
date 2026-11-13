"use client";

import { useFormatter, useTranslations } from "next-intl";
import { useId, useState, useTransition, type ReactNode } from "react";
import { StatusBadge } from "@/components/people/status-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Link, useRouter } from "@/i18n/navigation";
import type { CandidateDetail, IssueDetailData } from "@/modules/identity";
import { ReasonBadge } from "./reason-badge";

export type ActionResult = { ok: true } | { ok: false; code: string };
export type PersonOption = {
  id: string;
  displayName: string;
  workEmail: string | null;
};
export type IssueActions = {
  link: (
    issueId: string,
    personId: string,
    note: string,
  ) => Promise<ActionResult>;
  create: (issueId: string, note: string) => Promise<ActionResult>;
  ignore: (issueId: string, note: string) => Promise<ActionResult>;
  searchPeople: (query: string) => Promise<PersonOption[]>;
};

function Section({ title, children }: { title: string; children: ReactNode }) {
  const id = useId();
  return (
    <section aria-labelledby={id} className="flex flex-col gap-2">
      <h2 id={id} className="text-lg font-medium">
        {title}
      </h2>
      {children}
    </section>
  );
}

export function IssueDetail({
  issue,
  actions,
}: {
  issue: IssueDetailData;
  actions: IssueActions;
}) {
  const t = useTranslations("Identity");
  const router = useRouter();
  const noteId = useId();
  const [note, setNote] = useState("");
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const open = issue.status === "open";
  const conflict = issue.reason === "conflict";
  const { summary } = issue;

  function run(action: () => Promise<ActionResult>) {
    startTransition(async () => {
      const result = await action();
      if (result.ok) {
        setErrorCode(null);
        router.push("/imports/identity");
      } else {
        setErrorCode(result.code);
      }
    });
  }
  const link = (personId: string) =>
    run(() => actions.link(issue.id, personId, note.trim()));
  const errorText = (code: string) => {
    const key = `errors.${code}` as "errors.unknown";
    return t.has(key) ? t(key) : t("errors.unknown");
  };

  const fields: [string, ReactNode][] = [
    [t("detail.fields.sourceId"), issue.sourceId],
    [t("detail.fields.employeeNumber"), summary.employeeNumber ?? "—"],
    [t("detail.fields.workEmail"), summary.workEmail ?? "—"],
    [t("detail.fields.hireDate"), summary.hireDate ?? "—"],
    [t("detail.fields.terminationDate"), summary.terminationDate ?? "—"],
    [
      t("detail.fields.status"),
      <StatusBadge key="status" status={summary.status} />,
    ],
  ];

  return (
    <div className="flex flex-col gap-6">
      <Link href="/imports/identity" className="text-sm hover:underline">
        {t("detail.back")}
      </Link>
      <header className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold">
            {summary.displayName ?? t("unnamed")}
          </h1>
          <ReasonBadge reason={issue.reason} />
        </div>
        <p className="text-sm text-muted-foreground">
          {t(`reasonHelp.${issue.reason}`)}
        </p>
      </header>

      <Section title={t("detail.record")}>
        <dl className="grid max-w-xl grid-cols-[max-content_1fr] gap-x-6 gap-y-1 text-sm">
          {fields.map(([label, value]) => (
            <div key={label} className="contents">
              <dt className="text-muted-foreground">{label}</dt>
              <dd className="font-mono">{value}</dd>
            </div>
          ))}
        </dl>
      </Section>

      {open ? (
        <>
          <Section
            title={t(conflict ? "detail.involved" : "detail.candidates")}
          >
            {issue.candidates.length === 0 ? (
              <p>{t("detail.noCandidates")}</p>
            ) : (
              <ul className="flex flex-col gap-3">
                {issue.candidates.map((c) => (
                  <CandidateItem
                    key={c.personId}
                    candidate={c}
                    onLink={conflict ? undefined : () => link(c.personId)}
                    disabled={pending}
                  />
                ))}
              </ul>
            )}
          </Section>

          <Section title={t("actions.title")}>
            <Field className="max-w-xl">
              <FieldLabel htmlFor={noteId}>{t("actions.note")}</FieldLabel>
              <Input
                id={noteId}
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
            </Field>
            {conflict ? null : (
              <PersonSearch
                search={actions.searchPeople}
                onLink={link}
                disabled={pending}
              />
            )}
            <div className="flex flex-wrap gap-2">
              {conflict ? null : (
                <Button
                  disabled={pending}
                  onClick={() =>
                    run(() => actions.create(issue.id, note.trim()))
                  }
                >
                  {t("actions.create")}
                </Button>
              )}
              <Button
                variant="outline"
                disabled={pending}
                onClick={() => run(() => actions.ignore(issue.id, note.trim()))}
              >
                {t("actions.ignore")}
              </Button>
            </div>
            {errorCode ? (
              <p role="alert" className="text-sm text-destructive">
                {errorText(errorCode)}
              </p>
            ) : null}
          </Section>
        </>
      ) : (
        <ResolutionSummary issue={issue} />
      )}
    </div>
  );
}

function CandidateItem({
  candidate,
  onLink,
  disabled,
}: {
  candidate: CandidateDetail;
  onLink?: () => void;
  disabled: boolean;
}) {
  const t = useTranslations("Identity");
  return (
    <li
      aria-label={candidate.displayName}
      className="flex flex-col gap-2 rounded-lg border p-3"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <Link
            href={`/people/${candidate.personId}`}
            className="font-medium hover:underline"
          >
            {candidate.displayName}
          </Link>
          <p className="text-sm text-muted-foreground">
            {candidate.workEmail ?? "—"}
          </p>
        </div>
        {onLink ? (
          <Button
            variant="outline"
            size="sm"
            disabled={disabled}
            aria-label={t("actions.linkTo", { name: candidate.displayName })}
            onClick={onLink}
          >
            {t("actions.link")}
          </Button>
        ) : null}
      </div>
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="text-muted-foreground">{t("detail.matchedOn")}</span>
        {candidate.matchedOn.map((kind) => (
          <Badge key={kind} variant="secondary">
            {t(`detail.match.${kind}`)}
          </Badge>
        ))}
        <span className="text-muted-foreground">
          {t("detail.score", { score: Math.round(candidate.score * 100) })}
        </span>
      </div>
      {candidate.employments.length > 0 ? (
        <div className="text-sm">
          <span className="text-muted-foreground">
            {t("detail.employments")}
          </span>
          <ul>
            {candidate.employments.map((e, i) => (
              <li key={i} className="font-mono">
                {t("detail.employmentLine", {
                  hire: e.hireDate ?? t("detail.noDate"),
                  end: e.terminationDate ?? t("detail.noDate"),
                })}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </li>
  );
}

function PersonSearch({
  search,
  onLink,
  disabled,
}: {
  search: IssueActions["searchPeople"];
  onLink: (personId: string) => void;
  disabled: boolean;
}) {
  const t = useTranslations("Identity.actions");
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<PersonOption[] | null>(null);
  const [searching, startSearch] = useTransition();

  return (
    <div className="flex max-w-xl flex-col gap-2">
      <p className="text-sm font-medium">{t("search")}</p>
      <form
        role="search"
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          startSearch(async () => {
            setResults(await search(query.trim()));
          });
        }}
      >
        <Input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label={t("searchLabel")}
        />
        <Button type="submit" variant="secondary" disabled={searching}>
          {t("searchButton")}
        </Button>
      </form>
      {results === null ? null : results.length === 0 ? (
        <p className="text-sm">{t("noResults")}</p>
      ) : (
        <ul aria-label={t("searchResults")} className="flex flex-col gap-2">
          {results.map((p) => (
            <li
              key={p.id}
              className="flex items-center justify-between gap-2 rounded-lg border p-2 text-sm"
            >
              <span>
                <span className="font-medium">{p.displayName}</span>{" "}
                <span className="text-muted-foreground">
                  {p.workEmail ?? ""}
                </span>
              </span>
              <Button
                variant="outline"
                size="sm"
                disabled={disabled}
                aria-label={t("linkTo", { name: p.displayName })}
                onClick={() => onLink(p.id)}
              >
                {t("link")}
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ResolutionSummary({ issue }: { issue: IssueDetailData }) {
  const t = useTranslations("Identity");
  const format = useFormatter();
  const { resolution, resolvedPerson, resolvedAt } = issue;
  const name = resolvedPerson?.displayName ?? t("resolution.unknownPerson");
  const text = !resolution
    ? null
    : resolution.auto
      ? t("resolution.auto")
      : resolution.action === "ignore"
        ? t("resolution.ignore")
        : t(`resolution.${resolution.action}`, { name });

  return (
    <Section title={t("detail.resolutionTitle")}>
      {text ? <p>{text}</p> : null}
      {resolution?.actorNote ? (
        <p>{t("resolution.note", { note: resolution.actorNote })}</p>
      ) : null}
      {resolvedAt ? (
        <p className="text-sm text-muted-foreground">
          {t("detail.resolvedAt", {
            date: format.dateTime(resolvedAt, {
              dateStyle: "medium",
              timeZone: "UTC",
            }),
          })}
        </p>
      ) : null}
      {resolvedPerson ? (
        <Link
          href={`/people/${resolvedPerson.id}`}
          className="text-sm hover:underline"
        >
          {t("detail.viewPerson")}
        </Link>
      ) : null}
    </Section>
  );
}
