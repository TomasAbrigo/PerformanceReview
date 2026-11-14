"use client";

import { useTranslations } from "next-intl";
import { useId } from "react";
import { useLocalized } from "@/components/templates/shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { LocalizedText } from "@/db/schema/rating-scales";
import type { ParticipantFilterInput } from "@/modules/review-core/validation";
import { useCycleError } from "./errors";

/** Criteria a group can filter by (the people filter of the cycle, minus status). */
export const GROUP_FILTER_KEYS = [
  "departments",
  "divisions",
  "locations",
  "jobTitles",
] as const;
export type GroupFilterKey = (typeof GROUP_FILTER_KEYS)[number];

/** A group as edited in the wizard. */
export type GroupDraft = {
  /** Stable React key; not sent to the server. */
  key: string;
  name: string;
  templateId: string;
  criteria: Record<GroupFilterKey, string[]>;
};

/** How many people each group gets, in order, and how many are left over. */
export type GroupsPreviewData = { groups: number[]; remainder: number };

export type GroupTemplatesOptions = Record<GroupFilterKey, string[]> & {
  templates: { id: string; name: LocalizedText }[];
};

let sequence = 0;
export function newGroup(): GroupDraft {
  sequence += 1;
  return {
    key: `group-${sequence}`,
    name: "",
    templateId: "",
    criteria: { departments: [], divisions: [], locations: [], jobTitles: [] },
  };
}

/** The participant filter a group stands for. */
export function groupFilter(group: GroupDraft): ParticipantFilterInput {
  return { kind: "filter", ...group.criteria };
}

const toggle = (list: string[], value: string) =>
  list.includes(value) ? list.filter((v) => v !== value) : [...list, value];

/**
 * Wizard step: optional groups of participants that answer a different
 * template. The order is the priority (the first matching group wins).
 */
export function GroupTemplates({
  groups,
  onChange,
  options,
  preview,
  previewFailed = false,
  issues,
}: {
  groups: GroupDraft[];
  onChange: (groups: GroupDraft[]) => void;
  options: GroupTemplatesOptions;
  /** Null while it is being computed. */
  preview: GroupsPreviewData | null;
  /** The counts could not be computed (instead of waiting for them forever). */
  previewFailed?: boolean;
  /** Validation problems by path ("0.name", "1.templateId") -> error code. */
  issues: Record<string, string>;
}) {
  const t = useTranslations("Cycles.extras.groups");
  const tw = useTranslations("Cycles.wizard");
  const errorText = useCycleError();
  const localized = useLocalized();
  const id = useId();

  const update = (index: number, patch: Partial<GroupDraft>) =>
    onChange(groups.map((g, i) => (i === index ? { ...g, ...patch } : g)));
  const move = (index: number, by: -1 | 1) => {
    const next = [...groups];
    [next[index], next[index + by]] = [next[index + by], next[index]];
    onChange(next);
  };
  const issue = (path: string) => {
    const code = issues[path];
    if (!code) return null;
    return (
      <p className="text-sm text-destructive">
        {code === "duplicate_name" ? t("duplicateName") : errorText(code)}
      </p>
    );
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h2 className="text-lg font-medium">{t("title")}</h2>
        <p className="text-sm text-muted-foreground">{t("intro")}</p>
      </div>
      {groups.length === 0 ? <p>{t("empty")}</p> : null}
      {groups.map((group, i) => {
        const count = preview?.groups[i];
        const noCriteria = GROUP_FILTER_KEYS.every(
          (k) => group.criteria[k].length === 0,
        );
        return (
          <fieldset
            key={group.key}
            className="flex flex-col gap-3 rounded-md border p-4"
          >
            <legend className="px-1 font-medium">
              {t("groupN", { n: i + 1 })}
            </legend>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="flex flex-col gap-1">
                <Label htmlFor={`${id}-${group.key}-name`}>{t("name")}</Label>
                <Input
                  id={`${id}-${group.key}-name`}
                  value={group.name}
                  aria-invalid={issues[`${i}.name`] ? true : undefined}
                  onChange={(e) => update(i, { name: e.target.value })}
                />
                {issue(`${i}.name`)}
              </div>
              <div className="flex flex-col gap-1">
                <Label htmlFor={`${id}-${group.key}-template`}>
                  {t("template")}
                </Label>
                <select
                  id={`${id}-${group.key}-template`}
                  className="h-9 rounded-md border bg-transparent px-2"
                  value={group.templateId}
                  aria-invalid={issues[`${i}.templateId`] ? true : undefined}
                  onChange={(e) => update(i, { templateId: e.target.value })}
                >
                  <option value="">{t("pickTemplate")}</option>
                  {options.templates.map((o) => (
                    <option key={o.id} value={o.id}>
                      {localized(o.name)}
                    </option>
                  ))}
                </select>
                {issue(`${i}.templateId`)}
              </div>
            </div>
            <div className="flex flex-col gap-2">
              <p className="font-medium">{t("criteria")}</p>
              <div className="grid gap-4 sm:grid-cols-2">
                {GROUP_FILTER_KEYS.filter((k) => options[k].length > 0).map(
                  (key) => (
                    <div key={key} className="flex flex-col gap-1">
                      <p className="text-sm font-medium">
                        {tw(`filters.${key}`)}
                      </p>
                      {options[key].map((value) => (
                        <label
                          key={value}
                          className="flex items-center gap-2 text-sm"
                        >
                          <input
                            type="checkbox"
                            checked={group.criteria[key].includes(value)}
                            onChange={() =>
                              update(i, {
                                criteria: {
                                  ...group.criteria,
                                  [key]: toggle(group.criteria[key], value),
                                },
                              })
                            }
                          />
                          {value}
                        </label>
                      ))}
                    </div>
                  ),
                )}
              </div>
              {noCriteria ? (
                <p className="text-sm text-muted-foreground">
                  {t("noCriteria")}
                </p>
              ) : null}
            </div>
            {previewFailed ? null : (
              <p aria-live="polite" className="font-medium">
                {count === undefined ? t("counting") : t("count", { count })}
              </p>
            )}
            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={i === 0}
                onClick={() => move(i, -1)}
              >
                {t("moveUp")}
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={i === groups.length - 1}
                onClick={() => move(i, 1)}
              >
                {t("moveDown")}
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => onChange(groups.filter((_, j) => j !== i))}
              >
                {t("remove")}
              </Button>
            </div>
          </fieldset>
        );
      })}
      <div>
        <Button
          variant="outline"
          onClick={() => onChange([...groups, newGroup()])}
        >
          {t("add")}
        </Button>
      </div>
      {groups.length > 0 && previewFailed ? (
        <p role="alert" className="text-sm text-destructive">
          {t("previewError")}
        </p>
      ) : null}
      {groups.length > 0 && preview && !previewFailed ? (
        <p aria-live="polite" className="text-sm text-muted-foreground">
          {t("remainder", { count: preview.remainder })}
        </p>
      ) : null}
    </div>
  );
}
