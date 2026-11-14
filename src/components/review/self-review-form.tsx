"use client";

import { useFormatter, useTranslations } from "next-intl";
import { type ReactNode, useRef, useState, useTransition } from "react";
import {
  type ActionResult,
  type Localized,
  useLocalized,
} from "@/components/templates/shared";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Link } from "@/i18n/navigation";
import type { AnswerInput, AnswerValue } from "@/modules/review-core/answers";
import type { RequestStatus } from "@/modules/review-core/request-status";
import type { QuestionKind } from "@/modules/templates/constants";
import { useIsoDate } from "./my-tasks";

export type SelfReviewQuestion = {
  id: string;
  sectionTitle: Localized;
  prompt: Localized;
  kind: QuestionKind;
  required: boolean;
  scale: {
    options: { value: number; label: Localized; normalized: number }[];
  } | null;
  choices: { value: string; label: Localized }[] | null;
  /** Manager reviews: whether the reviewee will see the answer. */
  visibleToReviewee?: boolean;
};

/** Overrides for reusing the form for other relationships (manager). */
export type ReviewFormLabels = {
  title?: string;
  back?: string;
  backHref?: string;
  confirmTitle?: string;
  /** Autosave status texts (completing on behalf keeps answers locally). */
  saving?: string;
  saved?: string;
};

export type SelfReviewData = {
  requestId: string;
  cycleName: string;
  dueDate: string | null;
  status: RequestStatus;
  submittedAt: Date | null;
  canWrite: boolean;
  questions: SelfReviewQuestion[];
  answers: Record<string, AnswerValue>;
};

export type SelfReviewActions = {
  save: (requestId: string, answers: AnswerInput[]) => Promise<ActionResult>;
  submit: (requestId: string) => Promise<ActionResult>;
};

/** Options of a rating/single-choice question as {value, label}. */
function optionsOf(q: SelfReviewQuestion) {
  if (q.kind === "rating") return q.scale?.options ?? [];
  if (q.kind === "single_choice") return q.choices ?? [];
  return [];
}

export function SelfReviewForm({
  review,
  actions,
  labels = {},
  questionExtra,
  children,
}: {
  review: SelfReviewData;
  actions: SelfReviewActions;
  labels?: ReviewFormLabels;
  /** Rendered under each question's label (e.g. visibility marks). */
  questionExtra?: (q: SelfReviewQuestion) => ReactNode;
  /** Rendered after the questions, before the submit controls. */
  children?: ReactNode;
}) {
  const t = useTranslations("Review");
  const tErr = useTranslations("Review.errors");
  const localized = useLocalized();
  const format = useFormatter();
  const isoDate = useIsoDate();
  const [values, setValues] = useState(review.answers);
  const lastSaved = useRef<Record<string, AnswerValue>>({ ...review.answers });
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved">(
    "idle",
  );
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [missing, setMissing] = useState<Set<string>>(new Set());
  const [pending, startTransition] = useTransition();
  const readOnly = !review.canWrite;

  const errorText = (code: string) =>
    code === "missing_required"
      ? t("missingRequired")
      : tErr.has(code as "unknown")
        ? tErr(code as "unknown")
        : tErr("unknown");

  /** Autosaves in flight: submit waits for them so no answer is lost. */
  const inFlight = useRef<Set<Promise<unknown>>>(new Set());
  const [savingCount, setSavingCount] = useState(0);

  async function save(questionRevisionId: string, value: AnswerValue) {
    setSaveState("saving");
    const promise = actions.save(review.requestId, [
      { questionRevisionId, value },
    ]);
    inFlight.current.add(promise);
    setSavingCount((n) => n + 1);
    let result;
    try {
      result = await promise;
    } finally {
      inFlight.current.delete(promise);
      setSavingCount((n) => n - 1);
    }
    if (result.ok) {
      lastSaved.current[questionRevisionId] = value;
      setSaveState("saved");
      setError(null);
      setMissing((m) => {
        const next = new Set(m);
        next.delete(questionRevisionId);
        return next;
      });
    } else {
      setSaveState("idle");
      setError(errorText(result.code));
    }
  }

  function submit() {
    startTransition(async () => {
      await Promise.allSettled([...inFlight.current]);
      const result = await actions.submit(review.requestId);
      setConfirming(false);
      if (result.ok) {
        setError(null);
        setMissing(new Set());
      } else {
        setError(errorText(result.code));
        setMissing(new Set(result.issues.map((i) => i.path)));
      }
    });
  }

  const sections: { title: Localized; questions: SelfReviewQuestion[] }[] = [];
  for (const q of review.questions) {
    const last = sections.at(-1);
    if (last && localized(last.title) === localized(q.sectionTitle)) {
      last.questions.push(q);
    } else {
      sections.push({ title: q.sectionTitle, questions: [q] });
    }
  }

  function renderAnswer(q: SelfReviewQuestion) {
    const value = values[q.id];
    if (readOnly) {
      const option = optionsOf(q).find(
        (o) => String(o.value) === String(value),
      );
      const text = option
        ? localized(option.label)
        : value === null || value === undefined || value === ""
          ? null
          : String(value);
      return (
        <p className="whitespace-pre-wrap">
          {text ?? (
            <span className="text-muted-foreground">{t("noAnswer")}</span>
          )}
        </p>
      );
    }
    if (q.kind === "text") {
      return (
        <textarea
          id={`q-${q.id}`}
          className="min-h-24 w-full rounded-md border bg-transparent p-2 text-sm"
          value={typeof value === "string" ? value : ""}
          aria-required={q.required}
          aria-invalid={missing.has(q.id) || undefined}
          aria-describedby={missing.has(q.id) ? `q-${q.id}-error` : undefined}
          onChange={(e) => setValues((v) => ({ ...v, [q.id]: e.target.value }))}
          onBlur={(e) => {
            if ((lastSaved.current[q.id] ?? "") !== e.target.value) {
              void save(q.id, e.target.value);
            }
          }}
        />
      );
    }
    return (
      <div
        role="radiogroup"
        aria-labelledby={`q-${q.id}-label`}
        aria-required={q.required}
        aria-invalid={missing.has(q.id) || undefined}
        className="flex flex-wrap gap-4"
      >
        {optionsOf(q).map((o) => (
          <label key={String(o.value)} className="flex items-center gap-2">
            <input
              type="radio"
              name={`q-${q.id}`}
              value={String(o.value)}
              checked={String(value) === String(o.value)}
              onChange={() => {
                setValues((v) => ({ ...v, [q.id]: o.value }));
                void save(q.id, o.value);
              }}
            />
            {localized(o.label)}
          </label>
        ))}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <Link
          href={labels.backHref ?? "/me"}
          className="text-sm text-muted-foreground hover:underline"
        >
          {labels.back ?? t("back")}
        </Link>
        <h1 className="text-2xl font-semibold">
          {labels.title ?? `${t("selfTitle")}: ${review.cycleName}`}
        </h1>
        {review.status === "submitted" && review.submittedAt ? (
          <p className="text-sm">
            {t("submittedOn", {
              date: format.dateTime(review.submittedAt, {
                dateStyle: "medium",
                timeStyle: "short",
              }),
            })}
          </p>
        ) : review.dueDate ? (
          <p className="text-sm text-muted-foreground">
            {t("due", { date: isoDate(review.dueDate) })}
          </p>
        ) : null}
      </header>

      {sections.map((section, i) => (
        <section key={i} className="flex flex-col gap-4">
          <h2 className="text-lg font-medium">{localized(section.title)}</h2>
          {section.questions.map((q) => (
            <div key={q.id} className="flex flex-col gap-2">
              <label
                id={`q-${q.id}-label`}
                htmlFor={
                  q.kind === "text" && !readOnly ? `q-${q.id}` : undefined
                }
                className="font-medium"
              >
                {localized(q.prompt)}
                {q.required ? (
                  <>
                    {" "}
                    <span aria-hidden="true" className="text-destructive">
                      *
                    </span>
                    <span className="sr-only">({t("required")})</span>
                  </>
                ) : null}
              </label>
              {questionExtra?.(q)}
              {renderAnswer(q)}
              {missing.has(q.id) ? (
                <p id={`q-${q.id}-error`} className="text-sm text-destructive">
                  {t("requiredError")}
                </p>
              ) : null}
            </div>
          ))}
        </section>
      ))}

      {children}

      {!readOnly ? (
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-4">
            <Button
              onClick={() => setConfirming(true)}
              disabled={pending || savingCount > 0}
            >
              {t("submit")}
            </Button>
            <span aria-live="polite" className="text-sm text-muted-foreground">
              {saveState === "saving"
                ? (labels.saving ?? t("saving"))
                : saveState === "saved"
                  ? (labels.saved ?? t("saved"))
                  : ""}
            </span>
          </div>
          {confirming ? (
            <div
              role="alertdialog"
              aria-labelledby="submit-title"
              className="flex flex-col gap-2 rounded-md border p-4"
            >
              <p id="submit-title" className="font-medium">
                {labels.confirmTitle ?? t("confirmTitle")}
              </p>
              <p>{t("confirmBody")}</p>
              <div className="flex gap-2">
                <Button onClick={submit} disabled={pending}>
                  {t("confirm")}
                </Button>
                <Button
                  variant="outline"
                  onClick={() => setConfirming(false)}
                  disabled={pending}
                >
                  {t("cancel")}
                </Button>
              </div>
            </div>
          ) : null}
        </div>
      ) : (
        <Badge variant="secondary" className="self-start">
          {t(`status.${review.status}`)}
        </Badge>
      )}
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}
