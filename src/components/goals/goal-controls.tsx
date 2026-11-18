"use client";

import { Check, Circle } from "lucide-react";
import { useTranslations } from "next-intl";
import { useId, useState } from "react";
import {
  type ActionResult,
  ErrorAlert,
  useAction,
} from "@/components/form-helpers";
import { Button } from "@/components/ui/button";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import type { GoalStatus } from "@/db/schema/goals";

/** The server actions the controls call (passed in so they are testable). */
export type GoalControlActions = {
  setProgress: (percent: number) => Promise<ActionResult>;
  setStatus: (status: GoalStatus) => Promise<ActionResult>;
  addMilestone: (title: string) => Promise<ActionResult>;
};

/**
 * Progress, status buttons (complete, close, reopen) and the new-milestone
 * field of a goal. Only rendered when the actor may edit it; the actions
 * check that again.
 */
export function GoalControls({
  status,
  percent,
  actions,
}: {
  status: GoalStatus;
  percent: number;
  actions: GoalControlActions;
}) {
  const t = useTranslations("Goals.controls");
  const id = useId();
  const [draft, setDraft] = useState(String(percent));
  const [title, setTitle] = useState("");
  const progress = useAction();
  const state = useAction();
  const milestone = useAction();
  const value = Number(draft);
  const validPercent =
    draft.trim() !== "" &&
    Number.isInteger(value) &&
    value >= 0 &&
    value <= 100;

  return (
    <div className="flex flex-col gap-6">
      <form
        className="flex flex-wrap items-end gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (validPercent) progress.run(() => actions.setProgress(value));
        }}
      >
        <Field data-invalid={!validPercent ? true : undefined} className="w-40">
          <FieldLabel htmlFor={`${id}-percent`}>{t("progress")}</FieldLabel>
          <Input
            id={`${id}-percent`}
            type="number"
            min={0}
            max={100}
            step={1}
            value={draft}
            aria-invalid={!validPercent}
            onChange={(e) => setDraft(e.target.value)}
          />
          {!validPercent ? (
            <FieldError>{t("progressInvalid")}</FieldError>
          ) : null}
        </Field>
        <Button type="submit" variant="outline" disabled={progress.pending}>
          {t("saveProgress")}
        </Button>
        <ErrorAlert error={progress.error} />
      </form>

      <div className="flex flex-wrap items-center gap-2">
        {status === "in_progress" ? (
          <>
            <Button
              type="button"
              disabled={state.pending}
              onClick={() => state.run(() => actions.setStatus("completed"))}
            >
              {t("complete")}
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={state.pending}
              onClick={() => state.run(() => actions.setStatus("closed"))}
            >
              {t("close")}
            </Button>
          </>
        ) : (
          <Button
            type="button"
            variant="outline"
            disabled={state.pending}
            onClick={() => state.run(() => actions.setStatus("in_progress"))}
          >
            {t("reopen")}
          </Button>
        )}
        <ErrorAlert error={state.error} />
      </div>

      <form
        className="flex flex-wrap items-end gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (title.trim() === "") return;
          milestone.run(
            () => actions.addMilestone(title),
            () => setTitle(""),
          );
        }}
      >
        <Field className="w-full max-w-md">
          <FieldLabel htmlFor={`${id}-milestone`}>
            {t("addMilestone")}
          </FieldLabel>
          <Input
            id={`${id}-milestone`}
            value={title}
            maxLength={300}
            onChange={(e) => setTitle(e.target.value)}
          />
        </Field>
        <Button
          type="submit"
          variant="outline"
          disabled={milestone.pending || title.trim() === ""}
        >
          {t("add")}
        </Button>
        <ErrorAlert error={milestone.error} />
      </form>
    </div>
  );
}

/** A milestone's check: a button that toggles done / pending. */
export function MilestoneToggle({
  done,
  label,
  toggle,
}: {
  done: boolean;
  label: string;
  toggle: (done: boolean) => Promise<ActionResult>;
}) {
  const t = useTranslations("Goals.controls");
  const { pending, error, run } = useAction();
  return (
    <>
      <button
        type="button"
        role="checkbox"
        aria-checked={done}
        aria-label={t("toggleMilestone", { title: label })}
        disabled={pending}
        className="mt-0.5 shrink-0 rounded-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
        onClick={() => run(() => toggle(!done))}
      >
        {done ? (
          <Check className="size-4 text-status-done" aria-hidden="true" />
        ) : (
          <Circle className="size-4 text-muted-foreground" aria-hidden="true" />
        )}
      </button>
      <ErrorAlert error={error} />
    </>
  );
}
