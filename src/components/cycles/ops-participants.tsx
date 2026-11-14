"use client";

import { useTranslations } from "next-intl";
import { useId, useState, useTransition } from "react";
import type { ActionResult } from "@/components/templates/shared";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Link } from "@/i18n/navigation";
import type {
  CycleOps,
  ManagerChange,
  OpsParticipantItem,
  OpsRequestItem,
} from "@/modules/review-core/ops";
import type { AssessorMode } from "@/modules/review-core/ops-constants";
import { OpsAssessorDialog } from "./ops-assessor-dialog";
import { useOpsError } from "./ops-error";

export type OpsParticipantsActions = {
  add: (
    cycleId: string,
    personId: string,
    note: string | null,
  ) => Promise<ActionResult>;
  remove: (
    cycleId: string,
    personId: string,
    note: string | null,
  ) => Promise<ActionResult>;
  assign: (
    participantId: string,
    personId: string,
    mode: AssessorMode,
    note: string | null,
  ) => Promise<ActionResult>;
  unlock: (requestId: string, note: string | null) => Promise<ActionResult>;
};

type Confirming =
  | { kind: "remove"; participant: OpsParticipantItem }
  | { kind: "unlock"; requestId: string };

/** The assessor the manager change points at, when it still needs acting on. */
function suggestionOf(change: ManagerChange | null) {
  if (
    !change ||
    change.suggestedAction === "none" ||
    !change.currentManagerId
  ) {
    return null;
  }
  return {
    personId: change.currentManagerId,
    mode: (change.suggestedAction === "reassign"
      ? "replace"
      : "additional") as AssessorMode,
  };
}

/**
 * HR's view of a cycle's participants (#17): add/remove people, assign
 * alternate or additional assessors, unlock or complete reviews on behalf, with
 * badges for missing assessors, reviewer mismatches and manager changes.
 */
export function OpsParticipantsView({
  data,
  actions,
}: {
  data: CycleOps;
  actions: OpsParticipantsActions;
}) {
  const t = useTranslations("Ops.participants");
  const tReview = useTranslations("Review.status");
  const errorText = useOpsError();
  const id = useId();
  const cycleId = data.cycle.id;
  const [personId, setPersonId] = useState("");
  const [addNote, setAddNote] = useState("");
  const [confirming, setConfirming] = useState<Confirming | null>(null);
  const [confirmNote, setConfirmNote] = useState("");
  const [assessorFor, setAssessorFor] = useState<OpsParticipantItem | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  /** Runs an action; on success clears what it came from. */
  function run(
    action: () => Promise<ActionResult>,
    onSuccess: () => void = () => {},
  ) {
    startTransition(async () => {
      const result = await action();
      if (result.ok) {
        setError(null);
        onSuccess();
      } else {
        setError(errorText(result.code));
      }
    });
  }

  function add(e: React.FormEvent) {
    e.preventDefault();
    run(
      () => actions.add(cycleId, personId, addNote.trim() || null),
      () => {
        setPersonId("");
        setAddNote("");
      },
    );
  }

  function confirm() {
    if (!confirming) return;
    const note = confirmNote.trim() || null;
    run(
      () =>
        confirming.kind === "remove"
          ? actions.remove(cycleId, confirming.participant.personId, note)
          : actions.unlock(confirming.requestId, note),
      () => {
        setConfirming(null);
        setConfirmNote("");
      },
    );
  }

  const statusBadge = (r: OpsRequestItem) => (
    <Badge variant={r.status === "submitted" ? "default" : "secondary"}>
      {tReview(r.status)}
    </Badge>
  );

  function requestActions(p: OpsParticipantItem, r: OpsRequestItem) {
    if (p.removed) return null;
    return (
      <>
        {r.status === "submitted" ? (
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              setConfirming({ kind: "unlock", requestId: r.id });
              setConfirmNote("");
            }}
          >
            {t("unlock")}
          </Button>
        ) : null}
        {r.canComplete ? (
          <Link
            href={`/cycles/${cycleId}/participants/complete/${r.id}`}
            className="text-sm underline"
          >
            {t("complete")}
          </Link>
        ) : null}
      </>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <Link
          href={`/cycles/${cycleId}`}
          className="text-sm text-muted-foreground hover:underline"
        >
          {t("back")}
        </Link>
        <h1 className="text-2xl font-semibold">
          {t("title", { cycle: data.cycle.name })}
        </h1>
      </header>

      <section aria-labelledby={`${id}-add`} className="flex flex-col gap-2">
        <h2 id={`${id}-add`} className="text-lg font-medium">
          {t("addTitle")}
        </h2>
        {data.candidates.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("noCandidates")}</p>
        ) : (
          <form
            aria-label={t("addTitle")}
            onSubmit={add}
            className="flex flex-wrap items-end gap-3"
          >
            <div className="flex flex-col gap-1">
              <label htmlFor={`${id}-person`} className="text-sm font-medium">
                {t("person")}
              </label>
              <select
                id={`${id}-person`}
                className="h-9 rounded-md border bg-transparent px-2"
                value={personId}
                onChange={(e) => setPersonId(e.target.value)}
              >
                <option value="">{t("choosePerson")}</option>
                {data.candidates.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.displayName}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <label htmlFor={`${id}-note`} className="text-sm font-medium">
                {t("note")}
              </label>
              <Input
                id={`${id}-note`}
                value={addNote}
                onChange={(e) => setAddNote(e.target.value)}
              />
            </div>
            <Button type="submit" disabled={pending || !personId}>
              {t("add")}
            </Button>
          </form>
        )}
        <p className="text-sm text-muted-foreground">{t("addHint")}</p>
      </section>

      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}

      {data.participants.length === 0 ? (
        <p>{t("empty")}</p>
      ) : (
        <Table aria-label={t("tableLabel")}>
          <TableHeader>
            <TableRow>
              <TableHead>{t("columns.person")}</TableHead>
              <TableHead>{t("columns.snapshotManager")}</TableHead>
              <TableHead>{t("columns.self")}</TableHead>
              <TableHead>{t("columns.manager")}</TableHead>
              <TableHead>{t("columns.change")}</TableHead>
              <TableHead>{t("columns.actions")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.participants.map((p) => {
              const self = p.requests.filter((r) => r.relationship === "self");
              const manager = p.requests.filter(
                (r) => r.relationship === "manager",
              );
              return (
                <TableRow
                  key={p.participantId}
                  className={p.removed ? "opacity-60" : undefined}
                >
                  <TableCell>
                    {p.displayName}{" "}
                    {p.removed ? (
                      <Badge variant="secondary">{t("removed")}</Badge>
                    ) : null}
                  </TableCell>
                  <TableCell>
                    {p.snapManagerName ?? (
                      <Badge variant="destructive">{t("noManager")}</Badge>
                    )}
                  </TableCell>
                  <TableCell>
                    {self.length === 0 ? t("noRequest") : null}
                    {self.map((r) => (
                      <div
                        key={r.id}
                        className="flex flex-wrap items-center gap-2"
                      >
                        {statusBadge(r)}
                        {r.submittedOnBehalf ? (
                          <Badge variant="outline">{t("onBehalf")}</Badge>
                        ) : null}
                        {requestActions(p, r)}
                      </div>
                    ))}
                  </TableCell>
                  <TableCell>
                    {manager.length === 0 ? t("noRequest") : null}
                    <div className="flex flex-col gap-2">
                      {manager.map((r) => (
                        <div
                          key={r.id}
                          className="flex flex-wrap items-center gap-2"
                        >
                          {r.reviewerName ? (
                            <span>{r.reviewerName}</span>
                          ) : (
                            <Badge variant="destructive">
                              {t("noAssessor")}
                            </Badge>
                          )}
                          {r.additional ? (
                            <Badge variant="outline">{t("additional")}</Badge>
                          ) : null}
                          {r.reviewerMismatch ? (
                            <Badge variant="destructive">{t("mismatch")}</Badge>
                          ) : null}
                          {statusBadge(r)}
                          {r.submittedOnBehalf ? (
                            <Badge variant="outline">{t("onBehalf")}</Badge>
                          ) : null}
                          {requestActions(p, r)}
                        </div>
                      ))}
                    </div>
                  </TableCell>
                  <TableCell>
                    {p.change ? (
                      <div className="flex flex-col gap-1 text-sm">
                        <p>
                          {t("changed", {
                            current:
                              p.change.currentManagerName ??
                              t("noCurrentManager"),
                            snapshot:
                              p.change.snapshotManagerName ??
                              t("noSnapshotManager"),
                          })}
                        </p>
                        {p.change.suggestedAction !== "none" ? (
                          <p className="text-muted-foreground">
                            {t(`suggest.${p.change.suggestedAction}`, {
                              name: p.change.currentManagerName ?? "",
                            })}
                          </p>
                        ) : p.change.currentManagerId ? (
                          <p className="text-muted-foreground">
                            {t("suggest.none")}
                          </p>
                        ) : null}
                      </div>
                    ) : null}
                  </TableCell>
                  <TableCell>
                    {p.removed ? null : (
                      <div className="flex flex-wrap gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => setAssessorFor(p)}
                        >
                          {t("assign")}
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => {
                            setConfirming({ kind: "remove", participant: p });
                            setConfirmNote("");
                          }}
                        >
                          {t("remove")}
                        </Button>
                      </div>
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}

      {assessorFor ? (
        <OpsAssessorDialog
          key={assessorFor.participantId}
          participant={{
            participantId: assessorFor.participantId,
            displayName: assessorFor.displayName,
            needsAssessor: assessorFor.requests.some(
              (r) =>
                r.relationship === "manager" &&
                !r.additional &&
                r.reviewerMissing,
            ),
            suggestion: suggestionOf(assessorFor.change),
          }}
          people={data.people}
          assign={actions.assign}
          onClose={() => setAssessorFor(null)}
        />
      ) : null}

      {confirming ? (
        <div
          role="alertdialog"
          aria-labelledby={`${id}-confirm`}
          className="flex flex-col gap-3 rounded-md border p-4"
        >
          <p id={`${id}-confirm`} className="font-medium">
            {confirming.kind === "remove"
              ? t("removeTitle", { name: confirming.participant.displayName })
              : t("unlockTitle")}
          </p>
          {confirming.kind === "remove" ? <p>{t("removeBody")}</p> : null}
          <div className="flex flex-col gap-1">
            <label
              htmlFor={`${id}-confirm-note`}
              className="text-sm font-medium"
            >
              {t("note")}
            </label>
            <Input
              id={`${id}-confirm-note`}
              value={confirmNote}
              onChange={(e) => setConfirmNote(e.target.value)}
            />
          </div>
          <div className="flex gap-2">
            <Button onClick={confirm} disabled={pending}>
              {confirming.kind === "remove"
                ? t("removeConfirm")
                : t("unlockConfirm")}
            </Button>
            <Button
              variant="outline"
              onClick={() => setConfirming(null)}
              disabled={pending}
            >
              {t("cancel")}
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
