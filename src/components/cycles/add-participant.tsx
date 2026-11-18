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
import { Field, FieldLabel } from "@/components/ui/field";

/** Adds one of `options` (people not in the cycle) to an open cycle. */
export function AddParticipant({
  options,
  add,
}: {
  options: { personId: string; displayName: string }[];
  add: (personId: string) => Promise<ActionResult>;
}) {
  const t = useTranslations("Cycles.participants");
  const id = useId();
  const [personId, setPersonId] = useState("");
  const { pending, error, run } = useAction();
  return (
    <form
      aria-label={t("addLabel")}
      className="flex flex-wrap items-end gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        run(
          () => add(personId),
          () => setPersonId(""),
        );
      }}
    >
      <Field className="w-64">
        <FieldLabel htmlFor={id}>{t("addLabel")}</FieldLabel>
        <NativeSelect
          id={id}
          value={personId}
          onChange={(e) => setPersonId(e.target.value)}
        >
          <option value="" />
          {options.map((o) => (
            <option key={o.personId} value={o.personId}>
              {o.displayName}
            </option>
          ))}
        </NativeSelect>
      </Field>
      <Button type="submit" variant="outline" disabled={pending || !personId}>
        {t("add")}
      </Button>
      <ErrorAlert error={error} />
    </form>
  );
}
