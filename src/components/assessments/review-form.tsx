"use client";

import { useTranslations } from "next-intl";
import { useId, useState } from "react";
import { ProgressBar } from "@/components/progress-bar";

/** Each question as its own block, so a long form reads one step at a time. */
const BLOCK = "rounded-xl border border-border bg-card p-4";
import { type ActionResult, useAction } from "@/components/form-helpers";
import { Button } from "@/components/ui/button";
import {
  Field,
  FieldError,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from "@/components/ui/field";
import type { FieldIssue } from "@/lib/domain-error";
import type { CaptureAnswer } from "@/modules/review-capture/rules";
import type { QuestionKind } from "@/modules/templates/constants";

/** A question as the form shows it (texts already in the reader's language). */
export type FormQuestion = {
  id: string;
  section: string;
  prompt: string;
  kind: QuestionKind;
  required: boolean;
  /** Rating / single choice: the options (value as a string). */
  options: { value: string; label: string }[];
};

/** Sends the answers; the server validates them again. */
export type SendAnswers = (answers: CaptureAnswer[]) => Promise<ActionResult>;

const issueKeys = [
  "required",
  "out_of_scale",
  "invalid_choice",
  "unknown_question",
] as const;
const errorKeys = [
  "forbidden",
  "cycle_closed",
  "not_editable",
  "not_found",
  "not_submitted",
  "not_shareable",
  "validation",
] as const;

const optionText = (o: { value: string; label: string }) =>
  `${o.value} · ${o.label}`;

/**
 * The form of a review request (self assessment today): open questions as
 * text areas, Likert and choices as radio groups, grouped by section. Saves a
 * draft as is; submitting first checks the required answers (and shows which
 * one is missing), then the server checks everything again. Read-only once
 * submitted (or when the actor may not write it).
 */
export function ReviewForm({
  questions,
  initial,
  readOnly,
  save,
  submit,
}: {
  questions: FormQuestion[];
  initial: Record<string, string>;
  readOnly: boolean;
  save: SendAnswers;
  submit: SendAnswers;
}) {
  const t = useTranslations("Capture");
  const id = useId();
  const [values, setValues] = useState(initial);
  const [issues, setIssues] = useState<FieldIssue[]>([]);
  const [done, setDone] = useState<"saved" | "submitted" | null>(null);
  const { pending, error, run } = useAction();

  const answers = (): CaptureAnswer[] =>
    questions.map((q) => {
      const v = values[q.id]?.trim();
      return { questionRevisionId: q.id, value: v ? values[q.id] : null };
    });
  const set = (qid: string, value: string) => {
    setValues((v) => ({ ...v, [qid]: value }));
    setIssues((list) => list.filter((i) => i.path !== qid));
    setDone(null);
  };
  const send = (action: SendAnswers, outcome: "saved" | "submitted") =>
    run(
      async () => {
        const result = await action(answers());
        if (!result.ok) setIssues(result.issues);
        return result;
      },
      () => {
        setIssues([]);
        setDone(outcome);
      },
    );
  function onSubmit() {
    const missing = questions
      .filter((q) => q.required && !values[q.id]?.trim())
      .map((q) => ({ path: q.id, message: "required" }));
    setIssues(missing);
    setDone(null);
    if (missing.length === 0) send(submit, "submitted");
  }

  const issueText = (qid: string) => {
    const issue = issues.find((i) => i.path === qid);
    if (!issue) return null;
    const key = issueKeys.find((k) => k === issue.message) ?? "required";
    return t(`issues.${key}`);
  };
  const errorText = (code: string) => {
    const key = errorKeys.find((k) => k === code);
    return key ? t(`errors.${key}`) : t("errors.unknown");
  };

  const sections = [...new Set(questions.map((q) => q.section))];
  // How far the form is: the required questions with an answer.
  const required = questions.filter((q) => q.required);
  const answered = required.filter((q) => (values[q.id] ?? "").trim()).length;
  return (
    <form
      className="flex flex-col gap-8"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit();
      }}
    >
      {sections.map((section) => (
        <FieldSet key={section}>
          <FieldLegend>{section}</FieldLegend>
          {questions
            .filter((q) => q.section === section)
            .map((q) => {
              const fieldId = `${id}-${q.id}`;
              const message = issueText(q.id);
              const label = (
                <>
                  {q.prompt}
                  {q.required && !readOnly ? (
                    <span className="text-muted-foreground">
                      {" "}
                      ({t("required")})
                    </span>
                  ) : null}
                </>
              );
              if (readOnly) {
                const v = values[q.id];
                const option = q.options.find((o) => o.value === v);
                return (
                  <Field key={q.id} className={BLOCK}>
                    <FieldLabel>{label}</FieldLabel>
                    <p className="text-sm whitespace-pre-wrap">
                      {v ? (
                        option ? (
                          optionText(option)
                        ) : (
                          v
                        )
                      ) : (
                        <span className="text-muted-foreground">
                          {t("noAnswer")}
                        </span>
                      )}
                    </p>
                  </Field>
                );
              }
              if (q.kind === "text") {
                return (
                  <Field
                    key={q.id}
                    className={BLOCK}
                    data-invalid={message ? true : undefined}
                  >
                    <FieldLabel htmlFor={fieldId}>{label}</FieldLabel>
                    <textarea
                      id={fieldId}
                      className="control h-auto min-h-24 py-2"
                      aria-invalid={message !== null}
                      value={values[q.id] ?? ""}
                      onChange={(e) => set(q.id, e.target.value)}
                    />
                    {message ? <FieldError>{message}</FieldError> : null}
                  </Field>
                );
              }
              return (
                <Field
                  key={q.id}
                  className={BLOCK}
                  data-invalid={message ? true : undefined}
                >
                  <FieldLabel id={`${fieldId}-label`}>{label}</FieldLabel>
                  <div
                    role="radiogroup"
                    aria-labelledby={`${fieldId}-label`}
                    aria-invalid={message !== null}
                    className="grid gap-2 sm:grid-cols-[repeat(auto-fill,minmax(11rem,1fr))]"
                  >
                    {q.options.map((o) => (
                      <label
                        key={o.value}
                        className="flex cursor-pointer items-center gap-2 rounded-lg border border-border bg-background px-3 py-2 text-sm has-[:checked]:border-brand-600 has-[:checked]:bg-brand-fog has-[:focus-visible]:ring-3 has-[:focus-visible]:ring-ring/40"
                      >
                        <input
                          type="radio"
                          name={fieldId}
                          value={o.value}
                          checked={values[q.id] === o.value}
                          onChange={() => set(q.id, o.value)}
                        />
                        {optionText(o)}
                      </label>
                    ))}
                  </div>
                  {message ? <FieldError>{message}</FieldError> : null}
                </Field>
              );
            })}
        </FieldSet>
      ))}
      {readOnly ? null : (
        <div className="flex flex-col gap-4">
          {required.length > 0 ? (
            <div className="flex flex-col gap-1.5" data-testid="form-progress">
              <ProgressBar
                percent={(answered / required.length) * 100}
                label={t("answered", {
                  done: answered,
                  total: required.length,
                })}
              />
              <p className="text-xs text-muted-foreground">
                {t("answered", { done: answered, total: required.length })}
              </p>
            </div>
          ) : null}
          <div className="flex flex-wrap items-center gap-3">
            <Button
              type="button"
              variant="outline"
              disabled={pending}
              onClick={() => send(save, "saved")}
            >
              {t("save")}
            </Button>
            <Button type="submit" disabled={pending}>
              {t("submit")}
            </Button>
            <p aria-live="polite" className="text-sm text-muted-foreground">
              {pending ? t("saving") : done ? t(done) : null}
            </p>
            {error ? (
              <p role="alert" className="text-sm text-destructive">
                {errorText(error.code)}
              </p>
            ) : issues.length > 0 ? (
              <p role="alert" className="text-sm text-destructive">
                {t("errors.validation")}
              </p>
            ) : null}
          </div>
        </div>
      )}
    </form>
  );
}
