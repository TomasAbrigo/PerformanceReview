"use client";

import { useFormatter, useTranslations } from "next-intl";
import { useState } from "react";
import {
  type ActionResult,
  useAction,
  useErrorText,
} from "@/components/templates/shared";
import { Button, buttonVariants } from "@/components/ui/button";
import { Link } from "@/i18n/navigation";
import type {
  AckStatus,
  AckTask,
} from "@/modules/review-core/acknowledge-window";
import { ACK_NOTE_MAX_LENGTH } from "@/modules/review-core/limits";

export type AckViewState = {
  participantId: string;
  status: AckStatus;
  deadline: Date | null;
  acknowledgedAt: Date | null;
  note: string | null;
};

/**
 * The acknowledgement of a shared review. The employee acknowledges (with an
 * optional note) while the window is open, once; the manager only sees the
 * state. Immutable afterwards.
 */
export function AcknowledgeBox({
  state,
  viewer,
  acknowledge,
}: {
  state: AckViewState;
  viewer: "employee" | "manager";
  acknowledge?: (
    participantId: string,
    note: string | null,
  ) => Promise<ActionResult>;
}) {
  const t = useTranslations("Compare.ack");
  const format = useFormatter();
  const text = useErrorText();
  const [note, setNote] = useState("");
  const { pending, error, run } = useAction();
  // UTC: the deadline is computed in UTC and server/client must agree.
  const day = (d: Date) =>
    format.dateTime(d, { dateStyle: "medium", timeZone: "UTC" });
  const mine = viewer === "employee";

  // This feature's messages first, the shared ones (unknown, not_found...) after.
  const errorText = (code: string, issues: { message: string }[]) => {
    const key = code === "validation" ? (issues[0]?.message ?? code) : code;
    return t.has(`errors.${key}` as "errors.forbidden")
      ? t(`errors.${key}` as "errors.forbidden")
      : text.code(code);
  };

  function submit() {
    if (!acknowledge) return;
    run(() =>
      acknowledge(state.participantId, note.trim() === "" ? null : note.trim()),
    );
  }

  let body;
  if (state.status === "acknowledged" && state.acknowledgedAt) {
    const when = day(state.acknowledgedAt);
    body = (
      <>
        <p>
          {mine ? t("done", { date: when }) : t("manager.done", { date: when })}
        </p>
        {state.note ? (
          <p className="whitespace-pre-wrap">
            {mine
              ? t("yourNote", { note: state.note })
              : t("manager.theirNote", { note: state.note })}
          </p>
        ) : null}
      </>
    );
  } else if (state.status === "not_shared" || !state.deadline) {
    body = <p>{mine ? t("notShared") : t("manager.notShared")}</p>;
  } else if (state.status === "expired") {
    const date = day(state.deadline);
    body = (
      <p>{mine ? t("expired", { date }) : t("manager.expired", { date })}</p>
    );
  } else {
    const date = day(state.deadline);
    body = mine ? (
      <>
        <p>{t("open", { date })}</p>
        <label htmlFor="ack-note" className="font-medium">
          {t("noteLabel")}
        </label>
        <textarea
          id="ack-note"
          className="min-h-20 w-full rounded-md border bg-transparent p-2 text-sm"
          value={note}
          maxLength={ACK_NOTE_MAX_LENGTH}
          onChange={(e) => setNote(e.target.value)}
        />
        <div className="flex items-center gap-4">
          <Button onClick={submit} disabled={pending}>
            {t("submit")}
          </Button>
          {error ? (
            <p role="alert" className="text-sm text-destructive">
              {errorText(error.code, error.issues)}
            </p>
          ) : null}
        </div>
      </>
    ) : (
      <p>{t("manager.open", { date })}</p>
    );
  }

  return (
    <section
      id="acknowledge"
      aria-labelledby="ack-title"
      className="flex flex-col gap-2 rounded-md border p-4"
    >
      <h2 id="ack-title" className="text-lg font-medium">
        {t("title")}
      </h2>
      {body}
    </section>
  );
}

export type AckTaskView = Pick<
  AckTask,
  "participantId" | "cycleId" | "cycleName" | "deadline"
>;

/** The "Acusar recibo" tasks of /me: each links to where the review is read. */
export function AcknowledgeTasks({ tasks }: { tasks: AckTaskView[] }) {
  const t = useTranslations("Compare.ack.me");
  const format = useFormatter();
  if (tasks.length === 0) return null;
  return (
    <section aria-labelledby="ack-tasks" className="flex flex-col gap-2">
      <h2 id="ack-tasks" className="text-lg font-medium">
        {t("section")}
      </h2>
      <ul className="flex flex-col gap-2">
        {tasks.map((task) => (
          <li
            key={task.participantId}
            className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-4"
          >
            <div className="flex flex-col">
              <span className="font-medium">
                {t("task", { cycle: task.cycleName })}
              </span>
              <span className="text-sm text-muted-foreground">
                {t("until", {
                  date: format.dateTime(task.deadline, {
                    dateStyle: "medium",
                    timeZone: "UTC",
                  }),
                })}
              </span>
            </div>
            <Link
              href={`/cycles/${task.cycleId}/result#acknowledge`}
              className={buttonVariants({ size: "sm" })}
            >
              {t("action")}
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
