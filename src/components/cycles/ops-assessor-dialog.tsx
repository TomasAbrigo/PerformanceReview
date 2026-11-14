"use client";

import { useTranslations } from "next-intl";
import { useId, useState, useTransition } from "react";
import type { ActionResult } from "@/components/templates/shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  type AssessorMode,
  assessorModes,
} from "@/modules/review-core/ops-constants";
import { useOpsError } from "./ops-error";

export type AssessorDialogParticipant = {
  participantId: string;
  displayName: string;
  /** The participant has no manager: the assessor must replace the gap. */
  needsAssessor: boolean;
  /** Who the manager change suggests (the current manager) and how. */
  suggestion: { personId: string; mode: AssessorMode } | null;
};

/**
 * Assign an alternate (replace the manager's review) or additional assessor to
 * a participant (manager on leave, dotted line, CEO without manager).
 */
export function OpsAssessorDialog({
  participant,
  people,
  assign,
  onClose,
}: {
  participant: AssessorDialogParticipant;
  people: { id: string; displayName: string }[];
  assign: (
    participantId: string,
    personId: string,
    mode: AssessorMode,
    note: string | null,
  ) => Promise<ActionResult>;
  onClose: () => void;
}) {
  const t = useTranslations("Ops.participants");
  const errorText = useOpsError();
  const id = useId();
  const [personId, setPersonId] = useState(
    participant.suggestion?.personId ?? "",
  );
  const [mode, setMode] = useState<AssessorMode>(
    participant.needsAssessor
      ? "replace"
      : (participant.suggestion?.mode ?? "replace"),
  );
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submit(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      const result = await assign(
        participant.participantId,
        personId,
        mode,
        note.trim() || null,
      );
      if (result.ok) onClose();
      else setError(errorText(result.code));
    });
  }

  return (
    <div
      role="dialog"
      aria-labelledby={`${id}-title`}
      className="flex flex-col gap-3 rounded-md border p-4"
    >
      <h2 id={`${id}-title`} className="font-medium">
        {t("assessorTitle", { name: participant.displayName })}
      </h2>
      <form onSubmit={submit} className="flex flex-col gap-3">
        {participant.needsAssessor ? (
          <p className="text-sm">
            {t("replaceRequired", { name: participant.displayName })}
          </p>
        ) : null}
        <div className="flex flex-col gap-1">
          <label htmlFor={`${id}-person`} className="text-sm font-medium">
            {t("assessor")}
          </label>
          <select
            id={`${id}-person`}
            className="h-9 rounded-md border bg-transparent px-2"
            value={personId}
            onChange={(e) => setPersonId(e.target.value)}
          >
            <option value="">{t("choosePerson")}</option>
            {people.map((p) => (
              <option key={p.id} value={p.id}>
                {p.displayName}
              </option>
            ))}
          </select>
        </div>
        <fieldset className="flex flex-col gap-1">
          <legend className="text-sm font-medium">{t("mode")}</legend>
          {assessorModes.map((m) => (
            <label key={m} className="flex items-center gap-2 text-sm">
              <input
                type="radio"
                name={`${id}-mode`}
                value={m}
                checked={mode === m}
                disabled={m === "additional" && participant.needsAssessor}
                onChange={() => setMode(m)}
              />
              {t(m === "replace" ? "modeReplace" : "modeAdditional")}
            </label>
          ))}
        </fieldset>
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
        {error ? (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        ) : null}
        <div className="flex gap-2">
          <Button type="submit" disabled={pending || !personId}>
            {t("assessorConfirm")}
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={onClose}
            disabled={pending}
          >
            {t("cancel")}
          </Button>
        </div>
      </form>
    </div>
  );
}
