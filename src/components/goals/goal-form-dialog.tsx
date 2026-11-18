"use client";

import { useTranslations } from "next-intl";
import { useId, useState } from "react";
import {
  type ActionResult,
  ErrorAlert,
  useAction,
} from "@/components/form-helpers";
import { NativeSelect } from "@/components/imports/native-select";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import type { GoalOwnerOption } from "@/modules/goals/write";

export type GoalFormValues = {
  personId?: string;
  title: string;
  description: string;
  dueDate: string;
};

/** Saves the form (the server validates and re-checks who may). */
export type SaveGoal = (values: GoalFormValues) => Promise<ActionResult>;

/**
 * The "New goal" and "Edit goal" dialog: title, description and due date;
 * when creating, also the owner when the actor may pick more than themself.
 */
export function GoalFormDialog({
  mode,
  owners = [],
  initial,
  save,
  onSaved,
}: {
  mode: "create" | "edit";
  owners?: GoalOwnerOption[];
  initial?: Omit<GoalFormValues, "personId">;
  save: SaveGoal;
  onSaved?: (result: { ok: true } & Record<string, unknown>) => void;
}) {
  const t = useTranslations("Goals.form");
  const id = useId();
  const [open, setOpen] = useState(false);
  const [values, setValues] = useState<GoalFormValues>(() => ({
    personId: owners[0]?.id,
    title: initial?.title ?? "",
    description: initial?.description ?? "",
    dueDate: initial?.dueDate ?? "",
  }));
  const { pending, error, run, issueAt } = useAction();
  const set = (patch: Partial<GoalFormValues>) =>
    setValues((v) => ({ ...v, ...patch }));

  const issue = (path: string) => {
    const found = issueAt(path);
    if (!found) return null;
    const key = `errors.${found.message}`;
    return t.has(key as "errors.required")
      ? t(key as "errors.required")
      : t("errors.invalid");
  };
  const showOwner = mode === "create" && owners.length > 1;

  return (
    <>
      <Button
        type="button"
        variant={mode === "create" ? "default" : "outline"}
        onClick={() => setOpen(true)}
      >
        {t(mode === "create" ? "new" : "edit")}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {t(mode === "create" ? "newTitle" : "editTitle")}
            </DialogTitle>
            <DialogDescription>{t("description")}</DialogDescription>
          </DialogHeader>
          <form
            aria-label={t(mode === "create" ? "newTitle" : "editTitle")}
            className="flex flex-col gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              run(
                () => save(values),
                (result) => {
                  setOpen(false);
                  if (mode === "create") {
                    setValues((v) => ({
                      ...v,
                      title: "",
                      description: "",
                      dueDate: "",
                    }));
                  }
                  onSaved?.(result);
                },
              );
            }}
          >
            {showOwner ? (
              <Field data-invalid={issue("personId") ? true : undefined}>
                <FieldLabel htmlFor={`${id}-owner`}>{t("owner")}</FieldLabel>
                <NativeSelect
                  id={`${id}-owner`}
                  value={values.personId ?? ""}
                  onChange={(e) => set({ personId: e.target.value })}
                >
                  {owners.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.name}
                    </option>
                  ))}
                </NativeSelect>
                {issue("personId") ? (
                  <FieldError>{issue("personId")}</FieldError>
                ) : null}
              </Field>
            ) : null}
            <Field data-invalid={issue("title") ? true : undefined}>
              <FieldLabel htmlFor={`${id}-title`}>{t("title")}</FieldLabel>
              <Input
                id={`${id}-title`}
                value={values.title}
                maxLength={300}
                aria-invalid={issue("title") !== null}
                onChange={(e) => set({ title: e.target.value })}
              />
              {issue("title") ? (
                <FieldError>{issue("title")}</FieldError>
              ) : null}
            </Field>
            <Field data-invalid={issue("description") ? true : undefined}>
              <FieldLabel htmlFor={`${id}-description`}>
                {t("descriptionLabel")}
              </FieldLabel>
              <textarea
                id={`${id}-description`}
                rows={4}
                value={values.description}
                aria-invalid={issue("description") !== null}
                className="w-full min-w-0 rounded-lg border border-input bg-transparent px-2.5 py-1.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 aria-invalid:border-destructive"
                onChange={(e) => set({ description: e.target.value })}
              />
              {issue("description") ? (
                <FieldError>{issue("description")}</FieldError>
              ) : null}
            </Field>
            <Field data-invalid={issue("dueDate") ? true : undefined}>
              <FieldLabel htmlFor={`${id}-due`}>{t("dueDate")}</FieldLabel>
              <Input
                id={`${id}-due`}
                type="date"
                className="max-w-48"
                value={values.dueDate}
                aria-invalid={issue("dueDate") !== null}
                onChange={(e) => set({ dueDate: e.target.value })}
              />
              <FieldDescription>{t("dueDateHint")}</FieldDescription>
              {issue("dueDate") ? (
                <FieldError>{issue("dueDate")}</FieldError>
              ) : null}
            </Field>
            <ErrorAlert error={error} />
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setOpen(false)}
              >
                {t("cancel")}
              </Button>
              <Button type="submit" disabled={pending}>
                {t("save")}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
