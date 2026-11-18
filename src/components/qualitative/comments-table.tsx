"use client";

import { CardCollection } from "@/components/card-collection";
import { Quote } from "lucide-react";
import { IconTile } from "@/components/experience";
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
      gridClassName="record-grid"
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
    <article className="record-card" aria-label={row.personName}>
      <div className="flex flex-wrap items-center gap-2">
        <IconTile>
          <Quote className="size-5" />
        </IconTile>
        <h3 className="text-xl">{row.personName}</h3>
        <span className="rounded border px-1 text-[10px] font-semibold tracking-wide">
          {t(`comments.tags.${row.relationship}` as "comments.tags.self")}
        </span>
      </div>
      <div className="text-xs text-muted-foreground">
        <div>{row.cycleName}</div>
        <div className="text-xs text-muted-foreground">
          {day(row.periodStart)} – {day(row.periodEnd)}
        </div>
      </div>
      <p className="kicker text-primary">{dimension}</p>
      <blockquote className="rounded-lg border-l-4 border-brand-600 bg-brand-fog p-4 text-sm leading-relaxed whitespace-pre-line">
        {row.text}
      </blockquote>
      <div className="flex flex-col items-start gap-3">
        <div>
          <strong>{t(`sentiment.${row.sentiment}`)}</strong>
          {row.source === "human" ? ` (${t("comments.human")})` : null}
        </div>
        {row.confidence !== null ? (
          <div className="text-xs text-muted-foreground">
            {t("comments.confidence", { value: row.confidence.toFixed(2) })}
          </div>
        ) : null}
        {row.themes.length > 0 ? (
          <ul
            aria-label={t("comments.themeTags")}
            className="mt-1 flex flex-wrap gap-1 text-xs"
          >
            {row.themes.map((theme) => (
              <li key={theme} className="rounded-full border px-2">
                {theme}
              </li>
            ))}
          </ul>
        ) : null}
        {correct && !editing ? (
          <Button size="sm" variant="outline" onClick={() => setEditing(true)}>
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
