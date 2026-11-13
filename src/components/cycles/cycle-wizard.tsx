"use client";

import { useLocale, useTranslations } from "next-intl";
import { useEffect, useId, useState, useTransition } from "react";
import type { ActionResult } from "@/components/templates/shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { LocalizedText } from "@/db/schema/rating-scales";
import { useRouter } from "@/i18n/navigation";
import {
  anonymityModes,
  type AnonymityMode,
  type CycleComponents,
  dueDatePhases,
  type DueDatePhase,
} from "@/modules/review-core/status";
import {
  cycleInput,
  type CycleInput,
  type ParticipantFilterInput,
} from "@/modules/review-core/validation";
import { useCycleError } from "./errors";

export type WizardOptions = {
  departments: string[];
  divisions: string[];
  locations: string[];
  jobTitles: string[];
  statuses: string[];
  people: { id: string; displayName: string }[];
  templates: { id: string; name: LocalizedText }[];
  scales: { id: string; name: LocalizedText }[];
};

type Candidate = {
  personId: string;
  displayName: string;
  department: string | null;
  jobTitle: string | null;
};

export type WizardActions = {
  preview: (
    filter: ParticipantFilterInput,
  ) => Promise<ActionResult<{ count: number; sample: Candidate[] }>>;
  create: (input: CycleInput) => Promise<ActionResult<{ id: string }>>;
  launch: (id: string) => Promise<ActionResult>;
};

const STEPS = ["people", "components", "dates", "review"] as const;
const FILTER_KEYS = [
  "departments",
  "divisions",
  "locations",
  "jobTitles",
  "statuses",
] as const;
type FilterKey = (typeof FILTER_KEYS)[number];
type Mode = "all" | "filter" | "people";
const COMPONENT_KEYS = [
  "self",
  "manager",
  "peer",
  "upward",
  "calibration",
] as const;
const DATE_FIELDS = ["periodStart", "periodEnd", "snapshotDate"] as const;

export function CycleWizard({
  options,
  actions,
}: {
  options: WizardOptions;
  actions: WizardActions;
}) {
  const t = useTranslations("Cycles.wizard");
  const locale = useLocale();
  const router = useRouter();
  const errorText = useCycleError();
  const id = useId();
  const localized = (text: LocalizedText) =>
    locale === "en" ? text.en : text.es;

  const [step, setStep] = useState(0);
  const [mode, setMode] = useState<Mode>("all");
  const [criteria, setCriteria] = useState<Record<FilterKey, string[]>>({
    departments: [],
    divisions: [],
    locations: [],
    jobTitles: [],
    statuses: [],
  });
  const [personIds, setPersonIds] = useState<string[]>([]);
  const [components, setComponents] = useState<CycleComponents>({
    self: true,
    manager: true,
    peer: true,
    upward: false,
    calibration: true,
  });
  const [anonymity, setAnonymity] = useState<{
    peer: AnonymityMode;
    upward: AnonymityMode;
  }>({ peer: "anonymous_to_employee", upward: "fully_anonymous" });
  const [templateId, setTemplateId] = useState(options.templates[0]?.id ?? "");
  const [finalScaleId, setFinalScaleId] = useState(options.scales[0]?.id ?? "");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [dates, setDates] = useState<
    Record<(typeof DATE_FIELDS)[number], string>
  >({ periodStart: "", periodEnd: "", snapshotDate: "" });
  const [dueDates, setDueDates] = useState<
    Partial<Record<DueDatePhase, string>>
  >({});
  const [issues, setIssues] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<{
    count: number;
    sample: Candidate[];
  } | null>(null);
  const [pending, startTransition] = useTransition();

  const filter: ParticipantFilterInput =
    mode === "all"
      ? { kind: "all" }
      : mode === "filter"
        ? { kind: "filter", ...criteria }
        : { kind: "people", personIds };
  const filterKey = JSON.stringify(filter);

  useEffect(() => {
    let current = true;
    const parsed = JSON.parse(filterKey) as ParticipantFilterInput;
    if (parsed.kind === "people" && parsed.personIds.length === 0) {
      Promise.resolve().then(() => {
        if (current) setPreview({ count: 0, sample: [] });
      });
      return () => {
        current = false;
      };
    }
    actions.preview(parsed).then((result) => {
      if (current && result.ok) {
        setPreview({ count: result.count, sample: result.sample });
      }
    });
    return () => {
      current = false;
    };
  }, [filterKey, actions]);

  function buildInput(): CycleInput {
    const due = Object.fromEntries(
      Object.entries(dueDates).filter(([, v]) => v),
    );
    return {
      name,
      description: description || null,
      ...dates,
      components,
      anonymity,
      templateId: templateId || null,
      finalScaleId: finalScaleId || null,
      dueDates: due,
      participantFilter: filter,
    };
  }

  function validateDates(): boolean {
    const result = cycleInput.safeParse(buildInput());
    const found: Record<string, string> = {};
    if (!result.success) {
      for (const issue of result.error.issues) {
        const path = issue.path.join(".");
        if (
          path === "name" ||
          DATE_FIELDS.some((f) => path === f) ||
          path.startsWith("dueDates.")
        ) {
          found[path] =
            issue.message === "date_order"
              ? "date_order"
              : issue.message === "required"
                ? "required"
                : "invalid";
        }
      }
    }
    setIssues(found);
    return Object.keys(found).length === 0;
  }

  function next() {
    if (STEPS[step] === "dates" && !validateDates()) return;
    setStep((s) => Math.min(s + 1, STEPS.length - 1));
  }

  function submit(launch: boolean) {
    startTransition(async () => {
      const created = await actions.create(buildInput());
      if (!created.ok) {
        setError(errorText(created.code));
        return;
      }
      if (launch) {
        const launched = await actions.launch(created.id);
        if (!launched.ok) {
          setError(errorText(launched.code));
          router.push(`/cycles/${created.id}`);
          return;
        }
      }
      router.push(`/cycles/${created.id}`);
    });
  }

  const toggle = (list: string[], value: string) =>
    list.includes(value) ? list.filter((v) => v !== value) : [...list, value];

  const fieldError = (path: string) =>
    issues[path] ? (
      <p className="text-sm text-destructive">{errorText(issues[path])}</p>
    ) : null;

  const countText = preview
    ? t("count", { count: preview.count })
    : t("counting");

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold">{t("title")}</h1>
        <ol
          aria-label={t("stepsLabel")}
          className="flex flex-wrap gap-3 text-sm"
        >
          {STEPS.map((s, i) => (
            <li
              key={s}
              aria-current={i === step ? "step" : undefined}
              className={i === step ? "font-semibold" : "text-muted-foreground"}
            >
              {i + 1}. {t(`steps.${s}`)}
            </li>
          ))}
        </ol>
        <p className="text-sm text-muted-foreground">
          {t("stepOf", { current: step + 1, total: STEPS.length })}
        </p>
      </header>

      <section
        aria-label={t(`steps.${STEPS[step]}`)}
        className="flex flex-col gap-4"
      >
        {STEPS[step] === "people" ? (
          <>
            <fieldset className="flex flex-col gap-2">
              <legend className="mb-2 font-medium">{t("mode")}</legend>
              {(["all", "filter", "people"] as const).map((m) => (
                <label key={m} className="flex items-center gap-2">
                  <input
                    type="radio"
                    name={`${id}-mode`}
                    checked={mode === m}
                    onChange={() => setMode(m)}
                  />
                  {t(
                    m === "all"
                      ? "modeAll"
                      : m === "filter"
                        ? "modeFilter"
                        : "modePeople",
                  )}
                </label>
              ))}
            </fieldset>
            {mode === "filter" ? (
              <div className="grid gap-4 sm:grid-cols-2">
                {FILTER_KEYS.map((key) => (
                  <fieldset key={key} className="flex flex-col gap-1">
                    <legend className="mb-1 font-medium">
                      {t(`filters.${key}`)}
                    </legend>
                    {options[key].map((value) => (
                      <label
                        key={value}
                        className="flex items-center gap-2 text-sm"
                      >
                        <input
                          type="checkbox"
                          checked={criteria[key].includes(value)}
                          onChange={() =>
                            setCriteria({
                              ...criteria,
                              [key]: toggle(criteria[key], value),
                            })
                          }
                        />
                        {value}
                      </label>
                    ))}
                  </fieldset>
                ))}
              </div>
            ) : null}
            {mode === "people" ? (
              <fieldset className="flex flex-col gap-1">
                <legend className="sr-only">{t("modePeople")}</legend>
                {options.people.map((p) => (
                  <label key={p.id} className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={personIds.includes(p.id)}
                      onChange={() => setPersonIds(toggle(personIds, p.id))}
                    />
                    {p.displayName}
                  </label>
                ))}
              </fieldset>
            ) : null}
            <div aria-live="polite" className="flex flex-col gap-1">
              <p className="font-medium">{countText}</p>
              {preview && preview.sample.length > 0 ? (
                <ul
                  aria-label={t("sample")}
                  className="text-sm text-muted-foreground"
                >
                  {preview.sample.map((p) => (
                    <li key={p.personId}>{p.displayName}</li>
                  ))}
                </ul>
              ) : null}
            </div>
          </>
        ) : null}

        {STEPS[step] === "components" ? (
          <>
            <fieldset className="flex flex-col gap-2">
              <legend className="mb-2 font-medium">{t("components")}</legend>
              {COMPONENT_KEYS.map((key) => (
                <label key={key} className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={components[key]}
                    onChange={() =>
                      setComponents({ ...components, [key]: !components[key] })
                    }
                  />
                  {t(`componentNames.${key}`)}
                </label>
              ))}
            </fieldset>
            {(["peer", "upward"] as const).map((key) =>
              components[key] ? (
                <div key={key} className="flex flex-col gap-1">
                  <Label htmlFor={`${id}-anon-${key}`}>
                    {t(key === "peer" ? "anonymityPeer" : "anonymityUpward")}
                  </Label>
                  <select
                    id={`${id}-anon-${key}`}
                    className="h-9 rounded-md border bg-transparent px-2"
                    value={anonymity[key]}
                    onChange={(e) =>
                      setAnonymity({
                        ...anonymity,
                        [key]: e.target.value as AnonymityMode,
                      })
                    }
                  >
                    {anonymityModes.map((m) => (
                      <option key={m} value={m}>
                        {t(`anonymityModes.${m}`)}
                      </option>
                    ))}
                  </select>
                </div>
              ) : null,
            )}
            <div className="flex flex-col gap-1">
              <Label htmlFor={`${id}-template`}>{t("template")}</Label>
              <select
                id={`${id}-template`}
                className="h-9 rounded-md border bg-transparent px-2"
                value={templateId}
                onChange={(e) => setTemplateId(e.target.value)}
              >
                <option value="">{t("none")}</option>
                {options.templates.map((o) => (
                  <option key={o.id} value={o.id}>
                    {localized(o.name)}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor={`${id}-scale`}>{t("finalScale")}</Label>
              <select
                id={`${id}-scale`}
                className="h-9 rounded-md border bg-transparent px-2"
                value={finalScaleId}
                onChange={(e) => setFinalScaleId(e.target.value)}
              >
                <option value="">{t("none")}</option>
                {options.scales.map((o) => (
                  <option key={o.id} value={o.id}>
                    {localized(o.name)}
                  </option>
                ))}
              </select>
            </div>
          </>
        ) : null}

        {STEPS[step] === "dates" ? (
          <>
            <div className="flex flex-col gap-1">
              <Label htmlFor={`${id}-name`}>{t("name")}</Label>
              <Input
                id={`${id}-name`}
                value={name}
                aria-invalid={issues.name ? true : undefined}
                onChange={(e) => setName(e.target.value)}
              />
              {fieldError("name")}
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor={`${id}-description`}>{t("description")}</Label>
              <Input
                id={`${id}-description`}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            </div>
            <div className="grid gap-4 sm:grid-cols-3">
              {DATE_FIELDS.map((field) => (
                <div key={field} className="flex flex-col gap-1">
                  <Label htmlFor={`${id}-${field}`}>{t(field)}</Label>
                  <Input
                    id={`${id}-${field}`}
                    type="date"
                    value={dates[field]}
                    aria-invalid={issues[field] ? true : undefined}
                    onChange={(e) =>
                      setDates({ ...dates, [field]: e.target.value })
                    }
                  />
                  {fieldError(field)}
                </div>
              ))}
            </div>
            <fieldset className="grid gap-4 sm:grid-cols-3">
              <legend className="mb-2 font-medium">{t("dueDates")}</legend>
              {dueDatePhases.map((phase) => (
                <div key={phase} className="flex flex-col gap-1">
                  <Label htmlFor={`${id}-due-${phase}`}>
                    {t(`phases.${phase}`)}
                  </Label>
                  <Input
                    id={`${id}-due-${phase}`}
                    type="date"
                    value={dueDates[phase] ?? ""}
                    aria-invalid={
                      issues[`dueDates.${phase}`] ? true : undefined
                    }
                    onChange={(e) =>
                      setDueDates({ ...dueDates, [phase]: e.target.value })
                    }
                  />
                  {fieldError(`dueDates.${phase}`)}
                </div>
              ))}
            </fieldset>
          </>
        ) : null}

        {STEPS[step] === "review" ? (
          <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-sm">
            <dt className="font-medium">{t("name")}</dt>
            <dd>{name}</dd>
            <dt className="font-medium">{t("periodStart")}</dt>
            <dd>
              {dates.periodStart} → {dates.periodEnd}
            </dd>
            <dt className="font-medium">{t("snapshotDate")}</dt>
            <dd>{dates.snapshotDate}</dd>
            <dt className="font-medium">{t("components")}</dt>
            <dd>
              {COMPONENT_KEYS.filter((k) => components[k])
                .map((k) => t(`componentNames.${k}`))
                .join(", ")}
            </dd>
            <dt className="font-medium">{t("dueDates")}</dt>
            <dd>
              {dueDatePhases
                .filter((p) => dueDates[p])
                .map((p) => `${t(`phases.${p}`)}: ${dueDates[p]}`)
                .join(" · ")}
            </dd>
            <dt className="font-medium">{t("steps.people")}</dt>
            <dd aria-live="polite">
              {preview
                ? t("participantsToLaunch", { count: preview.count })
                : t("counting")}
            </dd>
          </dl>
        ) : null}
      </section>

      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}

      <div className="flex flex-wrap gap-2">
        {step > 0 ? (
          <Button
            variant="outline"
            onClick={() => setStep(step - 1)}
            disabled={pending}
          >
            {t("previous")}
          </Button>
        ) : null}
        {step < STEPS.length - 1 ? (
          <Button onClick={next}>{t("next")}</Button>
        ) : (
          <>
            <Button
              variant="outline"
              onClick={() => submit(false)}
              disabled={pending}
            >
              {t("saveDraft")}
            </Button>
            <Button
              onClick={() => submit(true)}
              disabled={pending || !preview || preview.count === 0}
            >
              {t("launch")}
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
