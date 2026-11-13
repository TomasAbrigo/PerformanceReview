"use client";

import { Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useId, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  type ActionResult,
  ErrorAlert,
  type Localized,
  LocalizedInputs,
  useAction,
  useLocalized,
} from "./shared";

export type ScaleRow = {
  id: string;
  name: Localized;
  isSystem: boolean;
  options: { value: number; normalized: number; label: Localized }[];
};
export type ScaleActions = {
  create: (input: {
    name: Localized;
    options: { value: number; label: Localized }[];
  }) => Promise<ActionResult>;
  remove: (id: string) => Promise<ActionResult>;
};

const emptyText: Localized = { es: "", en: "" };
const blankOptions = () => [
  { value: 1, label: emptyText },
  { value: 2, label: emptyText },
];

export function ScalesView({
  scales,
  actions,
}: {
  scales: ScaleRow[];
  actions: ScaleActions;
}) {
  const t = useTranslations("Scales");
  const tc = useTranslations("Common");
  const localized = useLocalized();
  const { pending, error, run } = useAction();

  return (
    <div className="flex flex-col gap-6">
      <ErrorAlert error={error} />
      {scales.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("empty")}</p>
      ) : (
        <ul className="grid gap-4 md:grid-cols-2">
          {scales.map((scale) => (
            <li key={scale.id}>
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center justify-between gap-2">
                    <span className="flex items-center gap-2">
                      {localized(scale.name)}
                      {scale.isSystem ? (
                        <Badge variant="secondary">{tc("system")}</Badge>
                      ) : null}
                    </span>
                    {scale.isSystem ? null : (
                      <Button
                        size="icon-sm"
                        variant="ghost"
                        aria-label={t("deleteScale")}
                        disabled={pending}
                        onClick={() => run(() => actions.remove(scale.id))}
                      >
                        <Trash2 />
                      </Button>
                    )}
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <ol className="flex flex-col gap-1 text-sm">
                    {scale.options.map((o) => (
                      <li key={o.value}>
                        {`${localized(o.label)} (${o.value} · ${t(
                          "normalized",
                          {
                            value: Math.round(o.normalized * 100) / 100,
                          },
                        )})`}
                      </li>
                    ))}
                  </ol>
                </CardContent>
              </Card>
            </li>
          ))}
        </ul>
      )}
      <ScaleForm create={actions.create} />
    </div>
  );
}

function ScaleForm({ create }: { create: ScaleActions["create"] }) {
  const t = useTranslations("Scales");
  const tc = useTranslations("Common");
  const id = useId();
  const [name, setName] = useState(emptyText);
  const [options, setOptions] = useState(blankOptions);
  const { pending, error, run, issueAt } = useAction();

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2>{t("new")}</h2>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <form
          aria-label={t("new")}
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            run(
              () => create({ name, options }),
              () => {
                setName(emptyText);
                setOptions(blankOptions());
              },
            );
          }}
        >
          <LocalizedInputs
            id={`${id}-name`}
            labels={{ es: tc("nameEs"), en: tc("nameEn") }}
            value={name}
            onChange={setName}
            issueAt={issueAt}
            path="name"
          />
          {options.map((option, i) => (
            <div key={i} className="flex flex-col gap-2 rounded-lg border p-3">
              <Field className="max-w-32">
                <FieldLabel htmlFor={`${id}-value-${i}`}>
                  {t("value")}
                </FieldLabel>
                <Input
                  id={`${id}-value-${i}`}
                  type="number"
                  step="any"
                  value={option.value}
                  onChange={(e) =>
                    setOptions(
                      options.map((o, j) =>
                        j === i ? { ...o, value: Number(e.target.value) } : o,
                      ),
                    )
                  }
                />
              </Field>
              <LocalizedInputs
                id={`${id}-label-${i}`}
                labels={{ es: t("labelEs"), en: t("labelEn") }}
                value={option.label}
                onChange={(label) =>
                  setOptions(
                    options.map((o, j) => (j === i ? { ...o, label } : o)),
                  )
                }
                issueAt={issueAt}
                path={`options.${i}.label`}
              />
              {options.length > 2 ? (
                <div>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={() =>
                      setOptions(options.filter((_, j) => j !== i))
                    }
                  >
                    {t("removeOption")}
                  </Button>
                </div>
              ) : null}
            </div>
          ))}
          <div className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() =>
                setOptions([
                  ...options,
                  {
                    value: Math.max(...options.map((o) => o.value)) + 1,
                    label: emptyText,
                  },
                ])
              }
            >
              {t("addOption")}
            </Button>
            <Button type="submit" disabled={pending}>
              {t("create")}
            </Button>
          </div>
          <ErrorAlert error={error} />
        </form>
      </CardContent>
    </Card>
  );
}
