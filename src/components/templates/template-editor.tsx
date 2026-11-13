"use client";

import { ArrowDown, ArrowUp, Pencil, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useId, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import { useRouter } from "@/i18n/navigation";
import {
  type QuestionKind,
  questionKinds as KINDS,
  type Relationship,
  relationships as RELATIONSHIPS,
} from "@/modules/templates/constants";
import {
  type ActionResult,
  ErrorAlert,
  type Localized,
  LocalizedInputs,
  useAction,
  useErrorText,
  useLocalized,
} from "./shared";

type Kind = QuestionKind;

export type EditorQuestion = {
  id: string;
  kind: Kind;
  appliesTo: Relationship[];
  visibleToReviewee: boolean;
  required: boolean;
  scaleId: string | null;
  prompt: Localized;
  choices: { value: string; label: Localized }[] | null;
};
export type EditorTemplate = {
  id: string;
  name: Localized;
  description: Localized | null;
  isSystem: boolean;
  sections: { id: string; title: Localized; questions: EditorQuestion[] }[];
};
export type QuestionPayload = Omit<EditorQuestion, "id">;
export type EditorActions = {
  updateTemplate: (
    id: string,
    input: { name: Localized },
  ) => Promise<ActionResult>;
  addSection: (
    templateId: string,
    input: { title: Localized },
  ) => Promise<ActionResult>;
  updateSection: (
    sectionId: string,
    input: { title: Localized },
  ) => Promise<ActionResult>;
  deleteSection: (sectionId: string) => Promise<ActionResult>;
  addQuestion: (
    sectionId: string,
    input: QuestionPayload,
  ) => Promise<ActionResult>;
  updateQuestion: (
    questionId: string,
    input: QuestionPayload,
  ) => Promise<ActionResult>;
  deleteQuestion: (questionId: string) => Promise<ActionResult>;
  reorder: (target: {
    kind: "sections" | "questions";
    parentId: string;
    ids: string[];
  }) => Promise<ActionResult>;
  clone: (templateId: string) => Promise<ActionResult<{ id: string }>>;
};
type Scale = { id: string; name: Localized };

const emptyText: Localized = { es: "", en: "" };

function move<T>(items: T[], index: number, delta: number): T[] {
  const next = [...items];
  const [item] = next.splice(index, 1);
  next.splice(index + delta, 0, item);
  return next;
}

export function TemplateEditor({
  template,
  scales,
  actions,
}: {
  template: EditorTemplate;
  scales: Scale[];
  actions: EditorActions;
}) {
  const t = useTranslations("Editor");
  const tc = useTranslations("Common");
  const router = useRouter();
  const { pending, error, run } = useAction();
  const readOnly = template.isSystem;

  return (
    <div className="flex flex-col gap-6">
      {readOnly ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-4">
          <p className="text-sm">{t("systemNotice")}</p>
          <Button
            disabled={pending}
            onClick={() =>
              run(
                () => actions.clone(template.id),
                (r) => router.push(`/settings/templates/${r.id}`),
              )
            }
          >
            {tc("clone")}
          </Button>
        </div>
      ) : (
        <NameForm template={template} actions={actions} />
      )}
      <ErrorAlert error={error} />

      {template.sections.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("emptySections")}</p>
      ) : (
        template.sections.map((section, index) => (
          <SectionCard
            key={section.id}
            section={section}
            index={index}
            sectionIds={template.sections.map((s) => s.id)}
            templateId={template.id}
            scales={scales}
            actions={actions}
            readOnly={readOnly}
          />
        ))
      )}

      {readOnly ? null : (
        <SectionForm templateId={template.id} actions={actions} />
      )}
    </div>
  );
}

function NameForm({
  template,
  actions,
}: {
  template: EditorTemplate;
  actions: EditorActions;
}) {
  const t = useTranslations("Editor");
  const tc = useTranslations("Common");
  const id = useId();
  const [name, setName] = useState(template.name);
  const { pending, error, run, issueAt } = useAction();
  return (
    <form
      aria-label={t("saveName")}
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        run(() => actions.updateTemplate(template.id, { name }));
      }}
    >
      <LocalizedInputs
        id={id}
        labels={{ es: tc("nameEs"), en: tc("nameEn") }}
        value={name}
        onChange={setName}
        issueAt={issueAt}
        path="name"
      />
      <div>
        <Button type="submit" variant="outline" disabled={pending}>
          {t("saveName")}
        </Button>
      </div>
      <ErrorAlert error={error?.code === "validation" ? null : error} />
    </form>
  );
}

function SectionForm({
  templateId,
  actions,
}: {
  templateId: string;
  actions: EditorActions;
}) {
  const t = useTranslations("Editor");
  const id = useId();
  const [title, setTitle] = useState(emptyText);
  const { pending, error, run, issueAt } = useAction();
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2>{t("newSection")}</h2>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <form
          aria-label={t("newSection")}
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            run(
              () => actions.addSection(templateId, { title }),
              () => setTitle(emptyText),
            );
          }}
        >
          <LocalizedInputs
            id={id}
            labels={{ es: t("sectionTitleEs"), en: t("sectionTitleEn") }}
            value={title}
            onChange={setTitle}
            issueAt={issueAt}
            path="title"
          />
          <div>
            <Button type="submit" disabled={pending}>
              {t("addSection")}
            </Button>
          </div>
          <ErrorAlert error={error?.code === "validation" ? null : error} />
        </form>
      </CardContent>
    </Card>
  );
}

function SectionCard({
  section,
  index,
  sectionIds,
  templateId,
  scales,
  actions,
  readOnly,
}: {
  section: EditorTemplate["sections"][number];
  index: number;
  sectionIds: string[];
  templateId: string;
  scales: Scale[];
  actions: EditorActions;
  readOnly: boolean;
}) {
  const t = useTranslations("Editor");
  const localized = useLocalized();
  const { pending, error, run } = useAction();
  const questionIds = section.questions.map((q) => q.id);
  const [editing, setEditing] = useState<string | null>(null);

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2 className="text-lg font-semibold">{localized(section.title)}</h2>
        </CardTitle>
        {readOnly ? null : (
          <CardAction className="flex gap-1">
            <Button
              size="icon-sm"
              variant="ghost"
              aria-label={t("sectionUp")}
              disabled={pending || index === 0}
              onClick={() =>
                run(() =>
                  actions.reorder({
                    kind: "sections",
                    parentId: templateId,
                    ids: move(sectionIds, index, -1),
                  }),
                )
              }
            >
              <ArrowUp />
            </Button>
            <Button
              size="icon-sm"
              variant="ghost"
              aria-label={t("sectionDown")}
              disabled={pending || index === sectionIds.length - 1}
              onClick={() =>
                run(() =>
                  actions.reorder({
                    kind: "sections",
                    parentId: templateId,
                    ids: move(sectionIds, index, 1),
                  }),
                )
              }
            >
              <ArrowDown />
            </Button>
            <Button
              size="icon-sm"
              variant="ghost"
              aria-label={t("deleteSection")}
              disabled={pending}
              onClick={() => run(() => actions.deleteSection(section.id))}
            >
              <Trash2 />
            </Button>
          </CardAction>
        )}
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <ErrorAlert error={error} />
        {section.questions.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("emptyQuestions")}</p>
        ) : (
          <ol className="flex flex-col gap-3">
            {section.questions.map((q, qIndex) =>
              editing === q.id ? (
                <li key={q.id}>
                  <QuestionForm
                    label={t("editQuestion")}
                    submitLabel={t("saveQuestion")}
                    initial={q}
                    scales={scales}
                    submit={(input) => actions.updateQuestion(q.id, input)}
                    onDone={() => setEditing(null)}
                  />
                </li>
              ) : (
                <li
                  key={q.id}
                  className="flex items-start justify-between gap-3 rounded-lg border p-3"
                >
                  <QuestionSummary question={q} scales={scales} />
                  {readOnly ? null : (
                    <div className="flex shrink-0 gap-1">
                      <Button
                        size="icon-sm"
                        variant="ghost"
                        aria-label={t("questionUp")}
                        disabled={pending || qIndex === 0}
                        onClick={() =>
                          run(() =>
                            actions.reorder({
                              kind: "questions",
                              parentId: section.id,
                              ids: move(questionIds, qIndex, -1),
                            }),
                          )
                        }
                      >
                        <ArrowUp />
                      </Button>
                      <Button
                        size="icon-sm"
                        variant="ghost"
                        aria-label={t("questionDown")}
                        disabled={
                          pending || qIndex === section.questions.length - 1
                        }
                        onClick={() =>
                          run(() =>
                            actions.reorder({
                              kind: "questions",
                              parentId: section.id,
                              ids: move(questionIds, qIndex, 1),
                            }),
                          )
                        }
                      >
                        <ArrowDown />
                      </Button>
                      <Button
                        size="icon-sm"
                        variant="ghost"
                        aria-label={t("editQuestion")}
                        onClick={() => setEditing(q.id)}
                      >
                        <Pencil />
                      </Button>
                      <Button
                        size="icon-sm"
                        variant="ghost"
                        aria-label={t("deleteQuestion")}
                        disabled={pending}
                        onClick={() => run(() => actions.deleteQuestion(q.id))}
                      >
                        <Trash2 />
                      </Button>
                    </div>
                  )}
                </li>
              ),
            )}
          </ol>
        )}
        {readOnly ? null : (
          <QuestionForm
            label={t("newQuestion")}
            submitLabel={t("addQuestion")}
            scales={scales}
            submit={(input) => actions.addQuestion(section.id, input)}
          />
        )}
      </CardContent>
    </Card>
  );
}

function QuestionSummary({
  question,
  scales,
}: {
  question: EditorQuestion;
  scales: Scale[];
}) {
  const t = useTranslations("Editor");
  const localized = useLocalized();
  const scale = scales.find((s) => s.id === question.scaleId);
  const kind = t(`kinds.${question.kind}`);
  return (
    <div className="flex flex-col gap-1.5">
      <p className="font-medium">{localized(question.prompt)}</p>
      <div className="flex flex-wrap gap-1.5">
        <Badge variant="secondary">
          {scale ? `${kind} · ${localized(scale.name)}` : kind}
        </Badge>
        {question.appliesTo.map((r) => (
          <Badge key={r} variant="outline">
            {t(`relationships.${r}`)}
          </Badge>
        ))}
        {question.required ? (
          <Badge variant="outline">{t("required")}</Badge>
        ) : null}
        {question.visibleToReviewee ? null : (
          <Badge variant="outline">{t("hiddenFromReviewee")}</Badge>
        )}
      </div>
      {question.choices?.length ? (
        <ul className="list-disc pl-5 text-sm text-muted-foreground">
          {question.choices.map((c) => (
            <li key={c.value}>{localized(c.label)}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

const blankQuestion: QuestionPayload = {
  kind: "text",
  appliesTo: [],
  visibleToReviewee: true,
  required: false,
  scaleId: null,
  prompt: emptyText,
  choices: null,
};

const selectClass =
  "h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm";

function QuestionForm({
  label,
  submitLabel,
  initial,
  scales,
  submit,
  onDone,
}: {
  label: string;
  submitLabel: string;
  initial?: EditorQuestion;
  scales: Scale[];
  submit: (input: QuestionPayload) => Promise<ActionResult>;
  onDone?: () => void;
}) {
  const t = useTranslations("Editor");
  const tc = useTranslations("Common");
  const localized = useLocalized();
  const text = useErrorText();
  const id = useId();
  const [value, setValue] = useState<QuestionPayload>(initial ?? blankQuestion);
  const { pending, error, run, issueAt } = useAction();
  const set = (patch: Partial<QuestionPayload>) =>
    setValue((v) => ({ ...v, ...patch }));
  const choices = value.choices ?? [];
  const appliesIssue = issueAt("appliesTo");
  const scaleIssue = issueAt("scaleId");
  const choicesIssue = issueAt("choices");

  return (
    <form
      aria-label={label}
      className="flex flex-col gap-3 rounded-lg border border-dashed p-3"
      onSubmit={(e) => {
        e.preventDefault();
        run(
          () =>
            submit({
              ...value,
              scaleId: value.kind === "rating" ? value.scaleId : null,
              choices: value.kind === "single_choice" ? choices : null,
            }),
          () => {
            if (!initial) setValue(blankQuestion);
            onDone?.();
          },
        );
      }}
    >
      <h3 className="text-sm font-semibold">{label}</h3>
      <LocalizedInputs
        id={`${id}-prompt`}
        labels={{ es: t("promptEs"), en: t("promptEn") }}
        value={value.prompt}
        onChange={(prompt) => set({ prompt })}
        issueAt={issueAt}
        path="prompt"
      />
      <div className="grid gap-3 sm:grid-cols-2">
        <Field>
          <FieldLabel htmlFor={`${id}-kind`}>{t("kind")}</FieldLabel>
          <select
            id={`${id}-kind`}
            className={selectClass}
            value={value.kind}
            onChange={(e) => set({ kind: e.target.value as Kind })}
          >
            {KINDS.map((k) => (
              <option key={k} value={k}>
                {t(`kinds.${k}`)}
              </option>
            ))}
          </select>
        </Field>
        {value.kind === "rating" ? (
          <Field data-invalid={scaleIssue ? true : undefined}>
            <FieldLabel htmlFor={`${id}-scale`}>{t("scale")}</FieldLabel>
            <select
              id={`${id}-scale`}
              className={selectClass}
              value={value.scaleId ?? ""}
              aria-invalid={scaleIssue ? true : undefined}
              onChange={(e) => set({ scaleId: e.target.value || null })}
            >
              <option value="">{t("chooseScale")}</option>
              {scales.map((s) => (
                <option key={s.id} value={s.id}>
                  {localized(s.name)}
                </option>
              ))}
            </select>
            {scaleIssue ? (
              <FieldError>{text.issue(scaleIssue)}</FieldError>
            ) : null}
          </Field>
        ) : null}
      </div>
      {value.kind === "single_choice" ? (
        <fieldset className="flex flex-col gap-2">
          <legend className="text-sm font-medium">{t("choices")}</legend>
          {choices.map((choice, i) => (
            <LocalizedInputs
              key={i}
              id={`${id}-choice-${i}`}
              labels={{
                es: t("choiceEs", { n: i + 1 }),
                en: t("choiceEn", { n: i + 1 }),
              }}
              value={choice.label}
              onChange={(label) =>
                set({
                  choices: choices.map((c, j) =>
                    j === i ? { ...c, label } : c,
                  ),
                })
              }
              issueAt={issueAt}
              path={`choices.${i}.label`}
            />
          ))}
          {choicesIssue ? (
            <FieldError>{text.issue(choicesIssue)}</FieldError>
          ) : null}
          <div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() =>
                set({
                  choices: [
                    ...choices,
                    { value: String(choices.length + 1), label: emptyText },
                  ],
                })
              }
            >
              {t("addChoice")}
            </Button>
          </div>
        </fieldset>
      ) : null}
      <fieldset className="flex flex-col gap-2">
        <legend className="text-sm font-medium">{t("appliesTo")}</legend>
        <div className="flex flex-wrap gap-4">
          {RELATIONSHIPS.map((r) => (
            <label key={r} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={value.appliesTo.includes(r)}
                onChange={(e) =>
                  set({
                    appliesTo: e.target.checked
                      ? [...value.appliesTo, r]
                      : value.appliesTo.filter((x) => x !== r),
                  })
                }
              />
              {t(`relationships.${r}`)}
            </label>
          ))}
        </div>
        {appliesIssue ? (
          <FieldError>{text.issue(appliesIssue)}</FieldError>
        ) : null}
      </fieldset>
      <div className="flex flex-wrap gap-4">
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={value.required}
            onChange={(e) => set({ required: e.target.checked })}
          />
          {t("required")}
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={value.visibleToReviewee}
            onChange={(e) => set({ visibleToReviewee: e.target.checked })}
          />
          {t("visibleToReviewee")}
        </label>
      </div>
      <ErrorAlert error={error?.code === "validation" ? null : error} />
      <div className="flex gap-2">
        <Button type="submit" disabled={pending}>
          {submitLabel}
        </Button>
        {onDone ? (
          <Button type="button" variant="outline" onClick={onDone}>
            {tc("cancel")}
          </Button>
        ) : null}
      </div>
    </form>
  );
}
