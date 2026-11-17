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
  builtinProfiles,
  PROFILE_ENTITIES,
  QUESTION_KINDS,
  sourceProfileSchema,
  type ProfileEntity,
  type QuestionMapping,
  type QuestionMappingKind,
  type SourceProfile,
} from "@/modules/lake/profiles";
import {
  questionDimensions,
  questionRoles,
  type QuestionDimension,
  type QuestionRole,
} from "@/modules/templates/constants";
import type { LakeColumn } from "@/modules/lake/types";
import { PROFILE_NAME } from "@/modules/lake/upload-shared";
import { NativeSelect } from "./native-select";

/** How one column is answered, as a question ("" kind = not a question). */
export type QuestionDraft = {
  kind: QuestionMappingKind | "";
  side: QuestionMapping["side"];
  /** Kept from the built-in it started from; "" = derived from side and column. */
  key: string;
  /** "" = none. */
  dimension: QuestionDimension | "";
  role: QuestionRole | "";
  options?: string[];
};

/** Built-in profiles a new one can start from (Bamboo's reports). */
const BASES = builtinProfiles.filter((p) => p.name.startsWith("bamboo-"));

/** What the user has typed so far; turned into a profile by {@link buildProfile}. */
export type ProfileDraft = {
  /** The built-in it started from ("" = from scratch). */
  base: string;
  name: string;
  entity: ProfileEntity;
  keys: string[];
  /** "" = no watermark. */
  watermark: string;
  /** Column -> canonical field ("" = leave it in `extra`). */
  fields: Record<string, string>;
  /** Column -> how it is answered (performance reports). */
  questions: Record<string, QuestionDraft>;
  /** From the base: the cycle and date columns ("" = none). */
  cycleColumn: string;
  dateColumn: string;
  /** Overwrite the saved profile that has this name (asked for explicitly). */
  replace: boolean;
};

export const emptyDraft: ProfileDraft = {
  base: "",
  name: "",
  entity: PROFILE_ENTITIES[0],
  keys: [],
  watermark: "",
  fields: {},
  questions: {},
  cycleColumn: "",
  dateColumn: "",
  replace: false,
};

const emptyQuestion: QuestionDraft = {
  kind: "",
  side: "self",
  key: "",
  dimension: "",
  role: "",
};

/**
 * A draft that starts from a built-in profile: its entity, keys, fields and
 * question mapping, for the columns this file has. The name stays the user's.
 */
export function draftFromBase(
  draft: ProfileDraft,
  baseName: string,
  columns: LakeColumn[],
): ProfileDraft {
  const base = BASES.find((p) => p.name === baseName);
  if (!base) return { ...emptyDraft, name: draft.name, replace: draft.replace };
  const has = new Set(columns.map((c) => c.name));
  const pick = (column: string | undefined) =>
    column && has.has(column) ? column : "";
  return {
    ...draft,
    base: base.name,
    entity: base.entity,
    keys: base.keyColumns.filter((c) => has.has(c)),
    watermark: pick(base.watermarkColumn),
    fields: Object.fromEntries(
      Object.entries(base.columnMap).filter(([c]) => has.has(c)),
    ),
    questions: Object.fromEntries(
      (base.questions ?? [])
        .filter((q) => has.has(q.column))
        .map((q) => [
          q.column,
          {
            kind: q.kind,
            side: q.side,
            key: q.key,
            dimension: q.dimension ?? "",
            role: q.role ?? "",
            ...(q.options ? { options: q.options } : {}),
          },
        ]),
    ),
    cycleColumn: pick(base.cycleColumn),
    dateColumn: pick(base.dateColumn),
  };
}

/** What a profile built on a real-report base keeps of it. */
function formatOf(base: SourceProfile | undefined): Partial<SourceProfile> {
  if (!base?.format) return {};
  return {
    format: base.format,
    ...(base.dateFormat ? { dateFormat: base.dateFormat } : {}),
    ...(base.optionalColumns ? { optionalColumns: base.optionalColumns } : {}),
    ...(base.customQuestions ? { customQuestions: base.customQuestions } : {}),
  };
}

/** The configured questions of a draft, in the file's column order. */
function questionsOf(
  draft: ProfileDraft,
  columns: LakeColumn[],
): QuestionMapping[] {
  return columns.flatMap(({ name: column }): QuestionMapping[] => {
    const q = draft.questions[column];
    if (!q || q.kind === "") return [];
    return [
      {
        column,
        side: q.side,
        kind: q.kind,
        key: q.key || `${q.side}:${column.trim().toLowerCase()}`,
        ...(q.dimension ? { dimension: q.dimension } : {}),
        ...(q.role ? { role: q.role } : {}),
        ...(q.options ? { options: q.options } : {}),
      },
    ];
  });
}

export type DraftErrors = {
  name: boolean;
  key: boolean;
  duplicateField: boolean;
  /** The name is a built-in profile's: never allowed. */
  builtinName: boolean;
  /** The name is a saved profile's and replacing it was not asked for. */
  savedName: boolean;
};

/** The profile names a new one would collide with. */
export type TakenNames = {
  builtin: ReadonlySet<string>;
  saved: ReadonlySet<string>;
};

/**
 * The profile a draft describes (null while it is not valid) and what is
 * wrong with it. Columns are kept in the file's order, not the click order.
 */
export function buildProfile(
  draft: ProfileDraft,
  columns: LakeColumn[],
  taken: TakenNames,
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
    builtinName: taken.builtin.has(draft.name),
    savedName: taken.saved.has(draft.name) && !draft.replace,
  };
  const questions = questionsOf(draft, columns);
  const parsed = sourceProfileSchema.safeParse({
    name: draft.name,
    table: draft.name,
    entity: draft.entity,
    keyColumns: columns
      .map((c) => c.name)
      .filter((c) => draft.keys.includes(c)),
    ...(draft.watermark ? { watermarkColumn: draft.watermark } : {}),
    ...(draft.cycleColumn ? { cycleColumn: draft.cycleColumn } : {}),
    ...(draft.dateColumn ? { dateColumn: draft.dateColumn } : {}),
    columnMap,
    ...(questions.length > 0 ? { questions } : {}),
    // A real-report base (#83) keeps how its rows are read.
    ...formatOf(BASES.find((p) => p.name === draft.base)),
  });
  const valid = parsed.success && !Object.values(errors).some((wrong) => wrong);
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
  taken,
}: {
  columns: LakeColumn[];
  draft: ProfileDraft;
  onChange: (draft: ProfileDraft) => void;
  errors: DraftErrors;
  taken: TakenNames;
}) {
  const t = useTranslations("Upload");
  const id = useId();
  const patch = (changes: Partial<ProfileDraft>) =>
    onChange({ ...draft, ...changes });
  const nameError =
    draft.name === ""
      ? null
      : errors.builtinName
        ? t("custom.errors.builtinName")
        : errors.savedName
          ? t("custom.errors.savedName")
          : errors.name
            ? t("custom.errors.name")
            : null;

  return (
    <fieldset className="flex flex-col gap-4 rounded-lg border p-4">
      <legend className="px-1 text-sm font-medium">{t("custom.title")}</legend>
      <Field className="max-w-sm">
        <FieldLabel htmlFor={`${id}-base`}>{t("custom.base")}</FieldLabel>
        <NativeSelect
          id={`${id}-base`}
          value={draft.base}
          onChange={(e) =>
            onChange(draftFromBase(draft, e.target.value, columns))
          }
        >
          <option value="">{t("custom.baseNone")}</option>
          {BASES.map((p) => (
            <option key={p.name} value={p.name}>
              {p.name}
            </option>
          ))}
        </NativeSelect>
        <FieldDescription>{t("custom.baseHint")}</FieldDescription>
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field data-invalid={nameError ? true : undefined}>
          <FieldLabel htmlFor={`${id}-name`}>{t("custom.name")}</FieldLabel>
          <Input
            id={`${id}-name`}
            value={draft.name}
            autoComplete="off"
            aria-invalid={nameError ? true : undefined}
            onChange={(e) => patch({ name: e.target.value, replace: false })}
          />
          {nameError ? (
            <FieldError>{nameError}</FieldError>
          ) : (
            <FieldDescription>{t("custom.nameHint")}</FieldDescription>
          )}
          {taken.saved.has(draft.name) ? (
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={draft.replace}
                onChange={(e) => patch({ replace: e.target.checked })}
              />
              {t("custom.replace", { name: draft.name })}
            </label>
          ) : null}
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
                      fields: {
                        ...draft.fields,
                        [column.name]: e.target.value,
                      },
                    })
                  }
                />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      {draft.entity === "assessment" ? (
        <QuestionTable
          columns={columns}
          questions={draft.questions}
          onChange={(questions) => patch({ questions })}
        />
      ) : null}
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

/**
 * The question mapping of a performance report: per column, whether it is a
 * question, how it is answered, who answers it and what it measures.
 */
function QuestionTable({
  columns,
  questions,
  onChange,
}: {
  columns: LakeColumn[];
  questions: Record<string, QuestionDraft>;
  onChange: (questions: Record<string, QuestionDraft>) => void;
}) {
  const t = useTranslations("Upload.custom.questions");
  const set = (column: string, changes: Partial<QuestionDraft>) => {
    const before = questions[column] ?? emptyQuestion;
    const next = { ...before, ...changes };
    // The key encodes the side (and the kind decides the revision): a base's
    // key no longer fits once either changes, so it is derived again.
    if (next.side !== before.side || next.kind !== before.kind) next.key = "";
    onChange({ ...questions, [column]: next });
  };
  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm text-muted-foreground">{t("hint")}</p>
      <Table aria-label={t("title")}>
        <TableHeader>
          <TableRow>
            <TableHead>{t("column")}</TableHead>
            <TableHead>{t("kind")}</TableHead>
            <TableHead>{t("side")}</TableHead>
            <TableHead>{t("dimension")}</TableHead>
            <TableHead>{t("role")}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {columns.map(({ name: column }) => {
            const q = questions[column] ?? emptyQuestion;
            const off = q.kind === "";
            return (
              <TableRow key={column}>
                <TableCell className="font-medium">{column}</TableCell>
                <TableCell>
                  <NativeSelect
                    aria-label={t("kindLabel", { column })}
                    value={q.kind}
                    onChange={(e) =>
                      set(column, {
                        kind: e.target.value as QuestionDraft["kind"],
                      })
                    }
                  >
                    <option value="">{t("kinds.none")}</option>
                    {QUESTION_KINDS.map((kind) => (
                      <option key={kind} value={kind}>
                        {t(`kinds.${kind}`)}
                      </option>
                    ))}
                  </NativeSelect>
                </TableCell>
                <TableCell>
                  <NativeSelect
                    aria-label={t("sideLabel", { column })}
                    value={q.side}
                    disabled={off}
                    onChange={(e) =>
                      set(column, {
                        side: e.target.value as QuestionDraft["side"],
                      })
                    }
                  >
                    <option value="self">{t("sides.self")}</option>
                    <option value="manager">{t("sides.manager")}</option>
                  </NativeSelect>
                </TableCell>
                <TableCell>
                  <NativeSelect
                    aria-label={t("dimensionLabel", { column })}
                    value={q.dimension}
                    disabled={off}
                    onChange={(e) =>
                      set(column, {
                        dimension: e.target.value as QuestionDraft["dimension"],
                      })
                    }
                  >
                    <option value="">{t("none")}</option>
                    {questionDimensions.map((d) => (
                      <option key={d} value={d}>
                        {t(`dimensions.${d}`)}
                      </option>
                    ))}
                  </NativeSelect>
                </TableCell>
                <TableCell>
                  <NativeSelect
                    aria-label={t("roleLabel", { column })}
                    value={q.role}
                    disabled={off}
                    onChange={(e) =>
                      set(column, {
                        role: e.target.value as QuestionDraft["role"],
                      })
                    }
                  >
                    <option value="">{t("none")}</option>
                    {questionRoles.map((r) => (
                      <option key={r} value={r}>
                        {t(`roles.${r}`)}
                      </option>
                    ))}
                  </NativeSelect>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
