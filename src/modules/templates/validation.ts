import { z } from "zod";
import {
  questionDimensions,
  questionKinds,
  questionRoles,
  relationships,
} from "@/db/schema";

/** A label/prompt: both locales are required (blank counts as missing). */
export const localizedText = z.object({
  es: z.string().trim().min(1, "required"),
  en: z.string().trim().min(1, "required"),
});

export const scaleInput = z
  .object({
    name: localizedText,
    options: z
      .array(z.object({ value: z.number().finite(), label: localizedText }))
      .min(2, "min_options"),
  })
  .refine(
    (s) => new Set(s.options.map((o) => o.value)).size === s.options.length,
    { message: "duplicate_values", path: ["options"] },
  );

export const templateInput = z.object({
  name: localizedText,
  description: localizedText.nullish(),
});

/** Partial update: only the provided fields change. */
export const templateUpdateInput = templateInput.partial();

export const sectionInput = z.object({ title: localizedText });

export const questionInput = z
  .object({
    kind: z.enum(questionKinds),
    appliesTo: z.array(z.enum(relationships)).min(1, "required"),
    visibleToReviewee: z.boolean().default(true),
    required: z.boolean().default(false),
    prompt: localizedText,
    scaleId: z.uuid().nullish(),
    choices: z
      .array(
        z.object({ value: z.string().trim().min(1), label: localizedText }),
      )
      .nullish(),
    /** Special meaning; omitted keeps the current one, null clears it. */
    role: z.enum(questionRoles).nullish(),
    /** What an open question is about; omitted keeps it, null clears it. */
    dimension: z.enum(questionDimensions).nullish(),
  })
  .superRefine((q, ctx) => {
    for (const issue of roleKindIssues(q.kind, q.role)) ctx.addIssue(issue);
    if (q.role === "retention" || q.role === "engagement") {
      if (q.appliesTo.some((r) => r !== "manager")) {
        ctx.addIssue({
          code: "custom",
          message: "manager_only",
          path: ["appliesTo"],
        });
      }
      if (q.visibleToReviewee !== false) {
        ctx.addIssue({
          code: "custom",
          message: "hidden_required",
          path: ["visibleToReviewee"],
        });
      }
    }
    if (q.kind === "rating" && !q.scaleId) {
      ctx.addIssue({ code: "custom", message: "required", path: ["scaleId"] });
    }
    if (q.kind !== "rating" && q.scaleId) {
      ctx.addIssue({
        code: "custom",
        message: "only_for_rating",
        path: ["scaleId"],
      });
    }
    if (q.kind === "single_choice" && (q.choices?.length ?? 0) < 2) {
      ctx.addIssue({
        code: "custom",
        message: "min_options",
        path: ["choices"],
      });
    }
    if (q.kind !== "single_choice" && q.choices?.length) {
      ctx.addIssue({
        code: "custom",
        message: "only_for_single_choice",
        path: ["choices"],
      });
    }
  });

type RoleIssue = { code: "custom"; message: string; path: string[] };

/** The goals comment is text; the goals, overall, retention and engagement ones are ratings. */
export function roleKindIssues(
  kind: (typeof questionKinds)[number],
  role: (typeof questionRoles)[number] | null | undefined,
): RoleIssue[] {
  if (role === "goals_comment" && kind !== "text") {
    return [{ code: "custom", message: "only_for_text", path: ["role"] }];
  }
  if (
    (role === "goals_rating" ||
      role === "overall_rating" ||
      role === "retention" ||
      role === "engagement") &&
    kind !== "rating"
  ) {
    return [{ code: "custom", message: "only_for_rating", path: ["role"] }];
  }
  return [];
}

export type ScaleInput = z.input<typeof scaleInput>;
export type TemplateInput = z.input<typeof templateInput>;
export type TemplateUpdateInput = z.input<typeof templateUpdateInput>;
export type SectionInput = z.input<typeof sectionInput>;
export type QuestionInput = z.input<typeof questionInput>;
