"use client";

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
    <table aria-label={t("comments.table")} className="w-full text-sm">
      <thead>
        <tr className="text-left">
          <th className="pr-3">{t("comments.person")}</th>
          <th className="pr-3">{t("comments.period")}</th>
          <th className="pr-3">{t("filters.dimension")}</th>
          <th className="pr-3">{t("comments.text")}</th>
          <th className="pr-3">{t("comments.label")}</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <Row
            key={r.answerId}
            row={r}
            dimension={dimensionLabel[r.dimension] ?? r.dimension}
            correct={correct}
          />
        ))}
      </tbody>
    </table>
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
    <tr className="border-t align-top">
      <td className="py-1 pr-3">
        <div>{row.personName}</div>
        <span className="rounded border px-1 text-[10px] font-semibold tracking-wide">
          {t(`comments.tags.${row.relationship}` as "comments.tags.self")}
        </span>
      </td>
      <td className="py-1 pr-3">
        <div>{row.cycleName}</div>
        <div className="text-xs text-muted-foreground">
          {day(row.periodStart)} – {day(row.periodEnd)}
        </div>
      </td>
      <td className="py-1 pr-3">{dimension}</td>
      <td className="py-1 pr-3 whitespace-pre-line">{row.text}</td>
      <td className="py-1 pr-3">
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
            className="mt-1 flex flex-col gap-1"
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
                className="rounded border px-1"
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
                className="rounded border px-1"
              />
            </label>
            <label className="flex flex-col text-xs">
              {t("comments.reason")}
              <input name="reason" className="rounded border px-1" />
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
      </td>
    </tr>
  );
}
