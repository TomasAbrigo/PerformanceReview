"use client";

import { useTranslations } from "next-intl";
import { useId, useState } from "react";
import {
  type ActionResult,
  ErrorAlert,
  useAction,
} from "@/components/form-helpers";
import { Button } from "@/components/ui/button";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { useRouter } from "@/i18n/navigation";

export type CreateCycleValues = {
  name: string;
  periodStart: string;
  periodEnd: string;
};

/** Creates the cycle and returns its id. */
export type CreateCycle = (
  values: CreateCycleValues,
) => Promise<ActionResult<{ id: string }>>;

/**
 * The form of a new cycle: name and period (suggested from the semester
 * cuts) on the Santex template, which is fixed.
 */
export function CreateCycleForm({
  defaults,
  create,
}: {
  defaults: CreateCycleValues;
  create: CreateCycle;
}) {
  const t = useTranslations("Cycles");
  const id = useId();
  const router = useRouter();
  const [values, setValues] = useState(defaults);
  const { pending, error, run, issueAt } = useAction();
  const set = (key: keyof CreateCycleValues, value: string) =>
    setValues((v) => ({ ...v, [key]: value }));

  const field = (key: keyof CreateCycleValues, type: "text" | "date") => {
    const issue = issueAt(key);
    const message = issue
      ? t.has(`errors.${issue.message}` as "errors.invalid")
        ? t(`errors.${issue.message}` as "errors.invalid")
        : t("errors.invalid")
      : null;
    return (
      <Field data-invalid={message ? true : undefined}>
        <FieldLabel htmlFor={`${id}-${key}`}>{t(`create.${key}`)}</FieldLabel>
        <Input
          id={`${id}-${key}`}
          type={type}
          value={values[key]}
          aria-invalid={message !== null}
          onChange={(e) => set(key, e.target.value)}
        />
        {message ? <FieldError>{message}</FieldError> : null}
      </Field>
    );
  };

  return (
    <form
      aria-label={t("create.title")}
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        run(
          () => create(values),
          (result) => router.push(`/settings/cycles/${result.id}`),
        );
      }}
    >
      {field("name", "text")}
      <div className="grid gap-4 sm:grid-cols-2">
        {field("periodStart", "date")}
        {field("periodEnd", "date")}
      </div>
      <Field>
        <FieldLabel htmlFor={`${id}-template`}>
          {t("create.template")}
        </FieldLabel>
        <Input
          id={`${id}-template`}
          value={t("create.templateValue")}
          readOnly
          disabled
        />
        <FieldDescription>{t("create.hint")}</FieldDescription>
      </Field>
      <ErrorAlert error={error && error.issues.length === 0 ? error : null} />
      <div>
        <Button type="submit" disabled={pending}>
          {t("create.submit")}
        </Button>
      </div>
    </form>
  );
}
