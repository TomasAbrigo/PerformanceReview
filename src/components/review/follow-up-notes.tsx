"use client";

import { useFormatter, useTranslations } from "next-intl";
import { useState } from "react";
import {
  type ActionResult,
  useAction,
  useErrorText,
} from "@/components/templates/shared";
import { Button } from "@/components/ui/button";
import { FOLLOW_UP_MAX_LENGTH } from "@/modules/review-core/limits";

export type FollowUpNoteView = {
  id: string;
  body: string;
  /** Null: People wrote it. */
  authorName: string | null;
  createdAt: Date;
};

/**
 * Follow-up notes of a participant, newest first as received, and (for the
 * manager/HR) a form to add one. Append-only: there is no edit or delete.
 */
export function FollowUpNotes({
  participantId,
  notes,
  canAdd,
  add,
}: {
  participantId: string;
  notes: FollowUpNoteView[];
  canAdd: boolean;
  add?: (participantId: string, body: string) => Promise<ActionResult>;
}) {
  const t = useTranslations("Compare.followUp");
  const format = useFormatter();
  const text = useErrorText();
  const [body, setBody] = useState("");
  const [missing, setMissing] = useState(false);
  const { pending, error, run } = useAction();

  // This feature's messages first, the shared ones (unknown, not_found...) after.
  const errorText = (code: string, issues: { message: string }[]) => {
    const key = code === "validation" ? (issues[0]?.message ?? code) : code;
    return t.has(`errors.${key}` as "errors.required")
      ? t(`errors.${key}` as "errors.required")
      : text.code(code);
  };

  function submit() {
    if (!add) return;
    const empty = body.trim() === "";
    setMissing(empty);
    if (empty) return;
    run(
      () => add(participantId, body),
      () => setBody(""),
    );
  }

  return (
    <section aria-labelledby="follow-up" className="flex flex-col gap-3">
      <div>
        <h2 id="follow-up" className="text-lg font-medium">
          {t("title")}
        </h2>
        <p className="text-sm text-muted-foreground">{t("hint")}</p>
      </div>
      {notes.length === 0 ? (
        <p className="text-muted-foreground">{t("empty")}</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {notes.map((note) => {
            const date = format.dateTime(note.createdAt, {
              dateStyle: "medium",
              timeStyle: "short",
            });
            return (
              <li
                key={note.id}
                className="flex flex-col gap-1 rounded-md border p-3"
              >
                <p className="whitespace-pre-wrap">{note.body}</p>
                <p className="text-sm text-muted-foreground">
                  {note.authorName
                    ? t("by", { name: note.authorName, date })
                    : t("byPeople", { date })}
                </p>
              </li>
            );
          })}
        </ul>
      )}
      {canAdd ? (
        <div className="flex flex-col gap-2">
          <label htmlFor="follow-up-body" className="font-medium">
            {t("label")}
          </label>
          <textarea
            id="follow-up-body"
            className="min-h-20 w-full rounded-md border bg-transparent p-2 text-sm"
            value={body}
            maxLength={FOLLOW_UP_MAX_LENGTH}
            aria-invalid={error || missing ? true : undefined}
            onChange={(e) => setBody(e.target.value)}
          />
          <div className="flex items-center gap-4">
            <Button onClick={submit} disabled={pending}>
              {t("add")}
            </Button>
            {missing || error ? (
              <p role="alert" className="text-sm text-destructive">
                {missing
                  ? t("errors.required")
                  : errorText(error!.code, error!.issues)}
              </p>
            ) : null}
          </div>
        </div>
      ) : null}
    </section>
  );
}
