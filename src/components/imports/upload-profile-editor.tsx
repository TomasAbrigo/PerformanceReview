"use client";

import { useTranslations } from "next-intl";
import { useId } from "react";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  PROFILE_ENTITIES,
  sourceProfileSchema,
  type ProfileEntity,
  type SourceProfile,
} from "@/modules/lake/profiles";
import type { LakeColumn } from "@/modules/lake/types";
import { PROFILE_NAME } from "@/modules/lake/upload-shared";
import { NativeSelect } from "./native-select";

/** What the user has typed so far; turned into a profile by {@link buildProfile}. */
export type ProfileDraft = {
  name: string;
  entity: ProfileEntity;
  keys: string[];
  /** "" = no watermark. */
  watermark: string;
  /** Column -> canonical field ("" = leave it in `extra`). */
  fields: Record<string, string>;
};

export const emptyDraft: ProfileDraft = {
  name: "",
  entity: PROFILE_ENTITIES[0],
  keys: [],
  watermark: "",
  fields: {},
};

export type DraftErrors = { name: boolean; key: boolean; duplicateField: boolean };

/**
 * The profile a draft describes (null while it is not valid) and what is
 * wrong with it. Columns are kept in the file's order, not the click order.
 */
export function buildProfile(
  draft: ProfileDraft,
  columns: LakeColumn[],
): { profile: SourceProfile | null; errors: DraftErrors } {
  const columnMap: Record<string, string> = {};
  for (const { name } of columns) {
    const field = (draft.fields[name] ?? "").trim();
    if (field) columnMap[name] = field;
  }
  const errors: DraftErrors = {
    name: !PROFILE_NAME.test(draft.name),
    key: draft.keys.length === 0,
    duplicateField:
      new Set(Object.values(columnMap)).size !== Object.keys(columnMap).length,
  };
  const parsed = sourceProfileSchema.safeParse({
    name: draft.name,
    table: draft.name,
    entity: draft.entity,
    keyColumns: columns.map((c) => c.name).filter((c) => draft.keys.includes(c)),
    ...(draft.watermark ? { watermarkColumn: draft.watermark } : {}),
    columnMap,
  });
  const valid = parsed.success && !errors.name && !errors.key && !errors.duplicateField;
  return { profile: valid ? parsed.data : null, errors };
}

/**
 * Define a source profile on top of the detected columns: which ones make up
 * the key, which one is the watermark, and the canonical name of the columns
 * to map (the rest stay as they are in the record's `extra`).
 */
export function ProfileEditor({
  columns,
  draft,
  onChange,
  errors,
}: {
  columns: LakeColumn[];
  draft: ProfileDraft;
  onChange: (draft: ProfileDraft) => void;
  errors: DraftErrors;
}) {
  const t = useTranslations("Upload");
  const id = useId();
  const patch = (changes: Partial<ProfileDraft>) =>
    onChange({ ...draft, ...changes });

  return (
    <fieldset className="flex flex-col gap-4 rounded-lg border p-4">
      <legend className="px-1 text-sm font-medium">{t("custom.title")}</legend>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field data-invalid={draft.name !== "" && errors.name ? true : undefined}>
          <FieldLabel htmlFor={`${id}-name`}>{t("custom.name")}</FieldLabel>
          <Input
            id={`${id}-name`}
            value={draft.name}
            autoComplete="off"
            aria-invalid={draft.name !== "" && errors.name ? true : undefined}
            onChange={(e) => patch({ name: e.target.value })}
          />
          {draft.name !== "" && errors.name ? (
            <FieldError>{t("custom.errors.name")}</FieldError>
          ) : (
            <FieldDescription>{t("custom.nameHint")}</FieldDescription>
          )}
        </Field>
        <Field>
          <FieldLabel htmlFor={`${id}-entity`}>{t("custom.entity")}</FieldLabel>
          <NativeSelect
            id={`${id}-entity`}
            value={draft.entity}
            onChange={(e) => patch({ entity: e.target.value as ProfileEntity })}
          >
            {PROFILE_ENTITIES.map((entity) => (
              <option key={entity} value={entity}>
                {t(`entities.${entity}`)}
              </option>
            ))}
          </NativeSelect>
        </Field>
      </div>

      <Table aria-label={t("custom.title")}>
        <TableHeader>
          <TableRow>
            <TableHead>{t("preview.columnName")}</TableHead>
            <TableHead>{t("preview.columnType")}</TableHead>
            <TableHead>{t("custom.key")}</TableHead>
            <TableHead>{t("custom.watermark")}</TableHead>
            <TableHead>{t("custom.field")}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          <TableRow>
            <TableCell colSpan={3} />
            <TableCell>
              <label className="flex items-center gap-1 text-xs text-muted-foreground">
                <input
                  type="radio"
                  name={`${id}-watermark`}
                  checked={draft.watermark === ""}
                  onChange={() => patch({ watermark: "" })}
                />
                {t("custom.noWatermark")}
              </label>
            </TableCell>
            <TableCell />
          </TableRow>
          {columns.map((column) => (
            <TableRow key={column.name}>
              <TableCell className="font-medium">{column.name}</TableCell>
              <TableCell className="font-mono text-xs">{column.type}</TableCell>
              <TableCell>
                <input
                  type="checkbox"
                  aria-label={t("custom.keyLabel", { column: column.name })}
                  checked={draft.keys.includes(column.name)}
                  onChange={(e) =>
                    patch({
                      keys: e.target.checked
                        ? [...draft.keys, column.name]
                        : draft.keys.filter((k) => k !== column.name),
                    })
                  }
                />
              </TableCell>
              <TableCell>
                <input
                  type="radio"
                  name={`${id}-watermark`}
                  aria-label={t("custom.watermarkLabel", {
                    column: column.name,
                  })}
                  checked={draft.watermark === column.name}
                  onChange={() => patch({ watermark: column.name })}
                />
              </TableCell>
              <TableCell>
                <Input
                  aria-label={t("custom.fieldLabel", { column: column.name })}
                  value={draft.fields[column.name] ?? ""}
                  autoComplete="off"
                  onChange={(e) =>
                    patch({
                      fields: { ...draft.fields, [column.name]: e.target.value },
                    })
                  }
                />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      {errors.key ? (
        <p className="text-sm text-destructive">{t("custom.errors.key")}</p>
      ) : null}
      {errors.duplicateField ? (
        <p className="text-sm text-destructive">
          {t("custom.errors.duplicateField")}
        </p>
      ) : null}
    </fieldset>
  );
}
