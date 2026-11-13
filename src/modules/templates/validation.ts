import { z } from "zod";
import { questionKinds, relationships } from "@/db/schema";

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
      .array(z.object({ value: z.string().trim().min(1), label: localizedText }))
      .nullish(),
  })
  .superRefine((q, ctx) => {
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
      ctx.addIssue({ code: "custom", message: "min_options", path: ["choices"] });
    }
    if (q.kind !== "single_choice" && q.choices?.length) {
      ctx.addIssue({
        code: "custom",
        message: "only_for_single_choice",
        path: ["choices"],
      });
    }
  });

export type ScaleInput = z.input<typeof scaleInput>;
export type TemplateInput = z.input<typeof templateInput>;
export type SectionInput = z.input<typeof sectionInput>;
export type QuestionInput = z.input<typeof questionInput>;
