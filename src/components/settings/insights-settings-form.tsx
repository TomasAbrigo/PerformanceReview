"use client";

import { useTranslations } from "next-intl";
import { type ReactNode, useId, useState } from "react";
import { NativeSelect } from "@/components/imports/native-select";
import {
  type ActionResult,
  ErrorAlert,
  useAction,
} from "@/components/templates/shared";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  analysisProviders,
  type SettingKey,
  type Settings,
  settingRanges,
} from "@/modules/settings/definitions";

/** Saves the form's values (the server validates each one again). */
export type SaveInsightsSettings = (
  values: Record<SettingKey, unknown>,
) => Promise<ActionResult>;

type NumericKey = keyof typeof settingRanges;
const isNumeric = (key: SettingKey): key is NumericKey =>
  Object.hasOwn(settingRanges, key);

/** Numbers are kept as typed (so a field can be emptied) and coerced on save. */
const toValue = (key: SettingKey, raw: string): unknown =>
  isNumeric(key)
    ? raw.trim() === ""
      ? null
      : Number(raw)
    : key === "analysis.includeClosed"
      ? raw === "true"
      : raw;

/** The People-only screen of thresholds, minimum n, semester cuts and provider. */
export function InsightsSettingsForm({
  values,
  save,
}: {
  values: Settings;
  save: SaveInsightsSettings;
}) {
  const t = useTranslations("InsightsSettings");
  const id = useId();
  const [draft, setDraft] = useState(
    () =>
      Object.fromEntries(
        Object.entries(values).map(([key, value]) => [key, String(value)]),
      ) as Record<SettingKey, string>,
  );
  const [saved, setSaved] = useState(false);
  const { pending, error, run, issueAt } = useAction();

  const set = (key: SettingKey, value: string) => {
    setDraft((d) => ({ ...d, [key]: value }));
    setSaved(false);
  };

  function issueText(key: SettingKey): string | null {
    const issue = issueAt(key);
    if (!issue) return null;
    const known = t.has(`errors.${issue.message}` as "errors.invalid");
    const range = isNumeric(key) ? settingRanges[key] : { min: 0, max: 0 };
    return known
      ? t(`errors.${issue.message}` as "errors.out_of_range", range)
      : t("errors.invalid");
  }

  function field(
    key: SettingKey,
    label: string,
    hint: string,
    control: (props: {
      id: string;
      "aria-invalid": boolean;
      "aria-describedby": string;
    }) => ReactNode,
  ) {
    const fieldId = `${id}-${key}`;
    const message = issueText(key);
    return (
      <Field data-invalid={message ? true : undefined}>
        <FieldLabel htmlFor={fieldId}>{label}</FieldLabel>
        {control({
          id: fieldId,
          "aria-invalid": message !== null,
          "aria-describedby": `${fieldId}-hint`,
        })}
        <FieldDescription id={`${fieldId}-hint`}>{hint}</FieldDescription>
        {message ? <FieldError>{message}</FieldError> : null}
      </Field>
    );
  }

  const number = (key: NumericKey, label: string, hint: string) =>
    field(key, label, hint, (props) => (
      <Input
        {...props}
        type="number"
        className="max-w-32"
        min={settingRanges[key].min}
        max={settingRanges[key].max}
        step={1}
        value={draft[key]}
        onChange={(e) => set(key, e.target.value)}
      />
    ));

  const day = (key: "semester.h1Start" | "semester.h2Start", label: string) =>
    field(key, label, t("semester.daysHint"), (props) => (
      <Input
        {...props}
        type="text"
        className="max-w-32"
        placeholder="MM-DD"
        value={draft[key]}
        onChange={(e) => set(key, e.target.value)}
      />
    ));

  return (
    <form
      aria-label={t("title")}
      className="flex flex-col gap-6"
      onSubmit={(e) => {
        e.preventDefault();
        run(
          () =>
            save(
              Object.fromEntries(
                (Object.keys(draft) as SettingKey[]).map((key) => [
                  key,
                  toValue(key, draft[key]),
                ]),
              ) as Record<SettingKey, unknown>,
            ),
          () => setSaved(true),
        );
      }}
    >
      <Section title={t("alerts.title")}>
        {number(
          "alerts.dropThreshold",
          t("alerts.dropThreshold"),
          t("alerts.dropThresholdHint"),
        )}
        {number(
          "alerts.riskThreshold",
          t("alerts.riskThreshold"),
          t("alerts.riskThresholdHint"),
        )}
      </Section>
      <Section title={t("aggregation.title")}>
        {number(
          "aggregation.minGroupSize",
          t("aggregation.minGroupSize"),
          t("aggregation.minGroupSizeHint"),
        )}
      </Section>
      <Section title={t("semester.title")}>
        {day("semester.h1Start", t("semester.h1Start"))}
        {day("semester.h2Start", t("semester.h2Start"))}
        {number(
          "semester.ambiguityDays",
          t("semester.ambiguityDays"),
          t("semester.ambiguityDaysHint"),
        )}
      </Section>
      <Section title={t("engagement.title")}>
        <p className="text-sm text-muted-foreground">{t("engagement.hint")}</p>
        {number(
          "engagement.cutoffAlto",
          t("engagement.cutoffAlto"),
          t("engagement.hint"),
        )}
        {number(
          "engagement.cutoffMedio",
          t("engagement.cutoffMedio"),
          t("engagement.hint"),
        )}
        {number(
          "engagement.cutoffRegular",
          t("engagement.cutoffRegular"),
          t("engagement.hint"),
        )}
      </Section>
      <Section title={t("analysis.title")}>
        {field(
          "analysis.provider",
          t("analysis.provider"),
          t("analysis.providerHint"),
          (props) => (
            <NativeSelect
              {...props}
              className="max-w-64"
              value={draft["analysis.provider"]}
              onChange={(e) => set("analysis.provider", e.target.value)}
            >
              {analysisProviders.map((provider) => (
                <option key={provider} value={provider}>
                  {t(`analysis.providers.${provider}`)}
                </option>
              ))}
            </NativeSelect>
          ),
        )}
        {field(
          "analysis.includeClosed",
          t("analysis.includeClosed"),
          t("analysis.includeClosedHint"),
          (props) => (
            <input
              {...props}
              type="checkbox"
              className="size-4"
              checked={draft["analysis.includeClosed"] === "true"}
              onChange={(e) =>
                set("analysis.includeClosed", String(e.target.checked))
              }
            />
          ),
        )}
      </Section>
      <ErrorAlert error={error} />
      <div className="flex items-center gap-3">
        <Button type="submit" disabled={pending}>
          {t("save")}
        </Button>
        {saved ? (
          <p role="status" className="text-sm text-muted-foreground">
            {t("saved")}
          </p>
        ) : null}
      </div>
    </form>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2>{title}</h2>
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">{children}</CardContent>
    </Card>
  );
}
