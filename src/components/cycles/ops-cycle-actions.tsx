"use client";

import { useTranslations } from "next-intl";
import { useId, useState, useTransition } from "react";
import type { ActionResult } from "@/components/templates/shared";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Link } from "@/i18n/navigation";
import {
  type CycleDueDates,
  type CycleStatus,
  type DueDatePhase,
  dueDatePhases,
} from "@/modules/review-core/status";
import { useOpsError } from "./ops-error";

/**
 * HR's operations on a cycle (#17), mounted on the cycle detail: links to the
 * participants/assessors page and the audit log, and the audited extension of
 * a phase's due date (forward only, only phases that have one).
 */
export function OpsCycleActions({
  cycleId,
  status,
  dueDates,
  extendDueDate,
}: {
  cycleId: string;
  status: CycleStatus;
  dueDates: CycleDueDates;
  extendDueDate: (
    cycleId: string,
    phase: DueDatePhase,
    date: string,
    note: string | null,
  ) => Promise<ActionResult>;
}) {
  const t = useTranslations("Ops.actions");
  const tPhase = useTranslations("Cycles.wizard.phases");
  const errorText = useOpsError();
  const id = useId();
  const phases = dueDatePhases.filter((p) => dueDates[p]);
  const canExtend =
    status !== "draft" && status !== "closed" && phases.length > 0;
  const [open, setOpen] = useState(false);
  const [phase, setPhase] = useState<DueDatePhase | "">("");
  const [date, setDate] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [pending, startTransition] = useTransition();

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const chosen = phase || phases[0];
    startTransition(async () => {
      const result = await extendDueDate(
        cycleId,
        chosen,
        date,
        note.trim() || null,
      );
      if (result.ok) {
        setError(null);
        setDone(true);
        setOpen(false);
        setDate("");
        setNote("");
      } else {
        setDone(false);
        setError(errorText(result.code));
      }
    });
  }

  return (
    <section aria-labelledby={`${id}-title`} className="flex flex-col gap-2">
      <h2 id={`${id}-title`} className="text-lg font-medium">
        {t("title")}
      </h2>
      <div className="flex flex-wrap gap-2">
        <Link
          href={`/cycles/${cycleId}/participants`}
          className={buttonVariants({ variant: "outline" })}
        >
          {t("participants")}
        </Link>
        <Link
          href={`/cycles/${cycleId}/audit`}
          className={buttonVariants({ variant: "outline" })}
        >
          {t("audit")}
        </Link>
        {canExtend ? (
          <Button variant="outline" onClick={() => setOpen(true)}>
            {t("extend")}
          </Button>
        ) : null}
      </div>
      {open ? (
        <form
          aria-label={t("extendTitle")}
          onSubmit={submit}
          className="flex flex-col gap-3 rounded-md border p-4"
        >
          <div className="flex flex-col gap-1">
            <label htmlFor={`${id}-phase`} className="text-sm font-medium">
              {t("phase")}
            </label>
            <select
              id={`${id}-phase`}
              className="h-9 rounded-md border bg-transparent px-2"
              value={phase || phases[0]}
              onChange={(e) => setPhase(e.target.value as DueDatePhase)}
            >
              {phases.map((p) => (
                <option key={p} value={p}>
                  {t("phaseOption", { phase: tPhase(p), date: dueDates[p]! })}
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor={`${id}-date`} className="text-sm font-medium">
              {t("newDate")}
            </label>
            <Input
              id={`${id}-date`}
              type="date"
              required
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor={`${id}-note`} className="text-sm font-medium">
              {t("note")}
            </label>
            <Input
              id={`${id}-note`}
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </div>
          <div className="flex gap-2">
            <Button type="submit" disabled={pending || !date}>
              {t("confirm")}
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => setOpen(false)}
              disabled={pending}
            >
              {t("cancel")}
            </Button>
          </div>
        </form>
      ) : null}
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
      {done && !open ? (
        <p role="status" className="text-sm">
          {t("extended")}
        </p>
      ) : null}
    </section>
  );
}
