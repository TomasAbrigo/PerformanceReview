"use client";

import { CardCollection } from "@/components/card-collection";
import { SENTIMENT_COLORS } from "@/components/charts";
import { useFormatter, useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import {
  sentiments,
  type Sentiment,
} from "@/modules/qualitative-analysis/constants";
import type { CommentRow } from "@/modules/qualitative-analysis/types";
import type { CorrectOutcome, CorrectPayload } from "./actions-types";

/** Labeled comments; HR corrects a label inline (appended, audited). */
export function CommentsTable({
  rows,
  dimensionLabel,
  correct,
}: {
  rows: CommentRow[];
  dimensionLabel: Record<string, string>;
  /** Absent: read-only (managers). */
  correct?: (
    answerId: string,
    input: CorrectPayload,
  ) => Promise<CorrectOutcome>;
}) {
  const t = useTranslations("Qualitative");
  if (rows.length === 0)
    return <p className="text-sm text-muted-foreground">{t("empty")}</p>;
  return (
    <CardCollection
      role="group"
      aria-label={t("comments.table")}
      gridClassName="grid gap-2 md:grid-cols-2"
      initialCount={12}
    >
      {rows.map((r) => (
        <Row
          key={r.answerId}
          row={r}
          dimension={dimensionLabel[r.dimension] ?? r.dimension}
          correct={correct}
        />
      ))}
    </CardCollection>
  );
}

function Row({
  row,
  dimension,
  correct,
}: {
  row: CommentRow;
  dimension: string;
  correct?: (
    answerId: string,
    input: CorrectPayload,
  ) => Promise<CorrectOutcome>;
}) {
  const t = useTranslations("Qualitative");
  const [editing, setEditing] = useState(false);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const format = useFormatter();
  const day = (iso: string) =>
    format.dateTime(new Date(`${iso}T00:00:00Z`), {
      dateStyle: "medium",
      timeZone: "UTC",
    });
  return (
    <article
      className="flex flex-col gap-2 rounded-lg border border-border bg-card p-3"
      aria-label={row.personName}
      data-testid="comment-row"
    >
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
        <span
          aria-hidden="true"
          className={`size-2.5 shrink-0 rounded-full ${SENTIMENT_COLORS[row.sentiment].fill}`}
        />
        <strong>{t(`sentiment.${row.sentiment}`)}</strong>
        {row.source === "human" ? (
          <span className="text-xs text-muted-foreground">
            ({t("comments.human")})
          </span>
        ) : null}
        <span className="text-muted-foreground">·</span>
        <h3 className="text-sm font-medium">{row.personName}</h3>
        <span className="rounded border px-1 text-[10px] font-semibold tracking-wide">
          {t(`comments.tags.${row.relationship}` as "comments.tags.self")}
        </span>
      </div>
      <p className="text-xs leading-snug font-medium text-primary">
        {dimension}
      </p>
      <blockquote className="line-clamp-4 border-l-2 border-brand-600 pl-3 text-sm leading-snug whitespace-pre-line">
        {row.text}
      </blockquote>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
        <span title={`${day(row.periodStart)} – ${day(row.periodEnd)}`}>
          {row.cycleName}
        </span>
        {row.confidence !== null ? (
          <span>
            {t("comments.confidence", { value: row.confidence.toFixed(2) })}
          </span>
        ) : null}
        {row.themes.length > 0 ? (
          <ul
            aria-label={t("comments.themeTags")}
            className="flex flex-wrap gap-1"
          >
            {row.themes.map((theme) => (
              <li key={theme} className="rounded-full border px-2">
                {theme}
              </li>
            ))}
          </ul>
        ) : null}
      </div>
      <div className="flex flex-col items-start gap-2">
        {correct && !editing ? (
          <Button size="xs" variant="ghost" onClick={() => setEditing(true)}>
            {t("comments.correct")}
          </Button>
        ) : null}
        {correct && editing ? (
          <form
            className="flex w-full flex-col gap-3 rounded-lg bg-brand-fog p-4"
            onSubmit={(e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              start(async () => {
                const r = await correct(row.answerId, {
                  sentiment: f.get("sentiment") as Sentiment,
                  themes: String(f.get("themes") ?? "")
                    .split(";")
                    .map((s) => s.trim())
                    .filter(Boolean),
                  reason: String(f.get("reason") ?? "") || undefined,
                });
                if (r.ok) setEditing(false);
                else setError(r.code);
              });
            }}
          >
            <label className="flex flex-col text-xs">
              {t("filters.sentiment")}
              <select
                name="sentiment"
                defaultValue={row.sentiment}
                className="control"
              >
                {sentiments.map((s) => (
                  <option key={s} value={s}>
                    {t(`sentiment.${s}`)}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col text-xs">
              {t("comments.themes")}
              <input
                name="themes"
                defaultValue={row.themes.join("; ")}
                className="control"
              />
            </label>
            <label className="flex flex-col text-xs">
              {t("comments.reason")}
              <input name="reason" className="control" />
            </label>
            <div className="flex gap-1">
              <Button size="sm" type="submit" disabled={pending}>
                {t("comments.save")}
              </Button>
              <Button
                size="sm"
                type="button"
                variant="ghost"
                onClick={() => setEditing(false)}
              >
                {t("comments.cancel")}
              </Button>
            </div>
            {error ? (
              <p role="alert" className="text-xs">
                {t(`errors.${error}` as "errors.unknown")}
              </p>
            ) : null}
          </form>
        ) : null}
      </div>
    </article>
  );
}
