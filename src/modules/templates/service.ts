import { asc, eq, inArray, sql } from "drizzle-orm";
import type { ZodType } from "zod";
import { parse as parseOr } from "@/lib/domain-error";
import type { DbOrTx } from "@/db/client";
import {
  question,
  type Question,
  ratingScale,
  type RatingScale,
  ratingScaleOption,
  type RatingScaleOption,
  reviewTemplate,
  type ReviewTemplate,
  templateSection,
  type TemplateSection,
} from "@/db/schema";
import { TemplatesError } from "./errors";
import {
  type QuestionInput,
  questionInput,
  type ScaleInput,
  scaleInput,
  type SectionInput,
  sectionInput,
  type TemplateInput,
  templateInput,
  type TemplateUpdateInput,
  templateUpdateInput,
} from "./validation";

export type ScaleWithOptions = RatingScale & { options: RatingScaleOption[] };
export type SectionWithQuestions = TemplateSection & { questions: Question[] };
export type TemplateDetail = ReviewTemplate & {
  sections: SectionWithQuestions[];
};

const parse = <T>(schema: ZodType<T>, input: unknown): T =>
  parseOr(schema, input, TemplatesError);

/** Maps each value to (value - min) / (max - min), so 4- and 5-point scales compare. */
export function normalizeValues(values: number[]): number[] {
  const min = Math.min(...values);
  const max = Math.max(...values);
  return values.map((v) => (max === min ? 0 : (v - min) / (max - min)));
}

// ---------------------------------------------------------------- scales

export async function createScale(
  db: DbOrTx,
  input: ScaleInput,
  opts: { isSystem?: boolean; systemKey?: string } = {},
): Promise<ScaleWithOptions> {
  const data = parse(scaleInput, input);
  const sorted = [...data.options].sort((a, b) => a.value - b.value);
  const normalized = normalizeValues(sorted.map((o) => o.value));
  return db.transaction(async (tx) => {
    const [scale] = await tx
      .insert(ratingScale)
      .values({
        name: data.name,
        isSystem: opts.isSystem ?? false,
        systemKey: opts.systemKey,
      })
      .returning();
    const options = await tx
      .insert(ratingScaleOption)
      .values(
        sorted.map((o, i) => ({
          scaleId: scale.id,
          value: o.value,
          normalized: normalized[i],
          sort: i,
          label: o.label,
        })),
      )
      .returning();
    return { ...scale, options };
  });
}

export async function listScales(db: DbOrTx): Promise<ScaleWithOptions[]> {
  const scales = await db
    .select()
    .from(ratingScale)
    .orderBy(asc(ratingScale.createdAt));
  if (scales.length === 0) return [];
  const options = await db
    .select()
    .from(ratingScaleOption)
    .where(
      inArray(
        ratingScaleOption.scaleId,
        scales.map((s) => s.id),
      ),
    )
    .orderBy(asc(ratingScaleOption.sort));
  return scales.map((s) => ({
    ...s,
    options: options.filter((o) => o.scaleId === s.id),
  }));
}

export async function deleteScale(db: DbOrTx, id: string): Promise<void> {
  const [scale] = await db
    .select()
    .from(ratingScale)
    .where(eq(ratingScale.id, id));
  if (!scale) throw new TemplatesError("not_found");
  if (scale.isSystem) throw new TemplatesError("system_readonly");
  const used = await db
    .select({ id: question.id })
    .from(question)
    .where(eq(question.scaleId, id))
    .limit(1);
  if (used.length) throw new TemplatesError("in_use");
  await db.delete(ratingScale).where(eq(ratingScale.id, id));
}

// ------------------------------------------------------------- templates

export async function listTemplates(db: DbOrTx): Promise<ReviewTemplate[]> {
  return db
    .select()
    .from(reviewTemplate)
    .orderBy(asc(reviewTemplate.createdAt));
}

export async function getTemplate(
  db: DbOrTx,
  id: string,
): Promise<TemplateDetail | null> {
  const [template] = await db
    .select()
    .from(reviewTemplate)
    .where(eq(reviewTemplate.id, id));
  if (!template) return null;
  const sections = await db
    .select()
    .from(templateSection)
    .where(eq(templateSection.templateId, id))
    .orderBy(asc(templateSection.sort));
  const questions = sections.length
    ? await db
        .select()
        .from(question)
        .where(
          inArray(
            question.sectionId,
            sections.map((s) => s.id),
          ),
        )
        .orderBy(asc(question.sort))
    : [];
  return {
    ...template,
    sections: sections.map((s) => ({
      ...s,
      questions: questions.filter((q) => q.sectionId === s.id),
    })),
  };
}

export async function createTemplate(
  db: DbOrTx,
  input: TemplateInput,
  opts: { isSystem?: boolean; systemKey?: string; enabled?: boolean } = {},
): Promise<ReviewTemplate> {
  const data = parse(templateInput, input);
  const [template] = await db
    .insert(reviewTemplate)
    .values({
      name: data.name,
      description: data.description ?? null,
      isSystem: opts.isSystem ?? false,
      systemKey: opts.systemKey,
      enabled: opts.enabled ?? true,
    })
    .returning();
  return template;
}

/** Throws unless the template exists and is editable (not a system template). */
async function editableTemplate(
  db: DbOrTx,
  templateId: string,
): Promise<ReviewTemplate> {
  const [template] = await db
    .select()
    .from(reviewTemplate)
    .where(eq(reviewTemplate.id, templateId));
  if (!template) throw new TemplatesError("not_found");
  if (template.isSystem) throw new TemplatesError("system_readonly");
  return template;
}

async function editableSection(
  db: DbOrTx,
  sectionId: string,
): Promise<TemplateSection> {
  const [found] = await db
    .select({ section: templateSection, isSystem: reviewTemplate.isSystem })
    .from(templateSection)
    .innerJoin(
      reviewTemplate,
      eq(reviewTemplate.id, templateSection.templateId),
    )
    .where(eq(templateSection.id, sectionId));
  if (!found) throw new TemplatesError("not_found");
  if (found.isSystem) throw new TemplatesError("system_readonly");
  return found.section;
}

async function editableQuestion(
  db: DbOrTx,
  questionId: string,
): Promise<Question> {
  const [found] = await db
    .select({ question, isSystem: reviewTemplate.isSystem })
    .from(question)
    .innerJoin(templateSection, eq(templateSection.id, question.sectionId))
    .innerJoin(
      reviewTemplate,
      eq(reviewTemplate.id, templateSection.templateId),
    )
    .where(eq(question.id, questionId));
  if (!found) throw new TemplatesError("not_found");
  if (found.isSystem) throw new TemplatesError("system_readonly");
  return found.question;
}

export async function updateTemplate(
  db: DbOrTx,
  id: string,
  input: TemplateUpdateInput,
): Promise<void> {
  const data = parse(templateUpdateInput, input);
  await editableTemplate(db, id);
  const changes: Partial<typeof reviewTemplate.$inferInsert> = {};
  if (data.name !== undefined) changes.name = data.name;
  if (data.description !== undefined) changes.description = data.description;
  if (Object.keys(changes).length === 0) return;
  await db.update(reviewTemplate).set(changes).where(eq(reviewTemplate.id, id));
}

export async function deleteTemplate(db: DbOrTx, id: string): Promise<void> {
  await editableTemplate(db, id);
  await db.delete(reviewTemplate).where(eq(reviewTemplate.id, id));
}

/** Copies a template (system or custom) with its sections and questions; questions keep their scale. */
export async function cloneTemplate(
  db: DbOrTx,
  id: string,
  overrides: { name?: TemplateInput["name"] } = {},
): Promise<ReviewTemplate> {
  const source = await getTemplate(db, id);
  if (!source) throw new TemplatesError("not_found");
  const name = overrides.name
    ? parse(templateInput, { name: overrides.name }).name
    : source.name;
  return db.transaction(async (tx) => {
    const [copy] = await tx
      .insert(reviewTemplate)
      .values({
        name,
        description: source.description,
        enabled: source.enabled,
        clonedFromId: source.id,
      })
      .returning();
    for (const section of source.sections) {
      const [newSection] = await tx
        .insert(templateSection)
        .values({
          templateId: copy.id,
          sort: section.sort,
          title: section.title,
        })
        .returning();
      if (section.questions.length) {
        await tx.insert(question).values(
          section.questions.map((q) => ({
            sectionId: newSection.id,
            sort: q.sort,
            kind: q.kind,
            appliesTo: q.appliesTo,
            visibleToReviewee: q.visibleToReviewee,
            required: q.required,
            scaleId: q.scaleId,
            prompt: q.prompt,
            choices: q.choices,
            role: q.role,
          })),
        );
      }
    }
    return copy;
  });
}

// ------------------------------------------------- sections & questions

async function nextSort(
  db: DbOrTx,
  parent: "template" | "section",
  parentId: string,
): Promise<number> {
  const rows =
    parent === "template"
      ? await db
          .select({ sort: templateSection.sort })
          .from(templateSection)
          .where(eq(templateSection.templateId, parentId))
      : await db
          .select({ sort: question.sort })
          .from(question)
          .where(eq(question.sectionId, parentId));
  return rows.reduce((max, r) => Math.max(max, r.sort + 1), 0);
}

export async function addSection(
  db: DbOrTx,
  templateId: string,
  input: SectionInput,
): Promise<TemplateSection> {
  const data = parse(sectionInput, input);
  await editableTemplate(db, templateId);
  const sort = await nextSort(db, "template", templateId);
  const [section] = await db
    .insert(templateSection)
    .values({ templateId, sort, title: data.title })
    .returning();
  return section;
}

export async function updateSection(
  db: DbOrTx,
  sectionId: string,
  input: SectionInput,
): Promise<void> {
  const data = parse(sectionInput, input);
  await editableSection(db, sectionId);
  await db
    .update(templateSection)
    .set({ title: data.title })
    .where(eq(templateSection.id, sectionId));
}

export async function deleteSection(
  db: DbOrTx,
  sectionId: string,
): Promise<void> {
  await editableSection(db, sectionId);
  await db.delete(templateSection).where(eq(templateSection.id, sectionId));
}

function questionValues(data: ReturnType<typeof questionInput.parse>) {
  return {
    kind: data.kind,
    appliesTo: data.appliesTo,
    visibleToReviewee: data.visibleToReviewee,
    required: data.required,
    prompt: data.prompt,
    scaleId: data.kind === "rating" ? (data.scaleId ?? null) : null,
    choices: data.kind === "single_choice" ? (data.choices ?? null) : null,
  };
}

export async function addQuestion(
  db: DbOrTx,
  sectionId: string,
  input: QuestionInput,
): Promise<Question> {
  const data = parse(questionInput, input);
  await editableSection(db, sectionId);
  const sort = await nextSort(db, "section", sectionId);
  const [created] = await db
    .insert(question)
    .values({ sectionId, sort, ...questionValues(data) })
    .returning();
  return created;
}

export async function updateQuestion(
  db: DbOrTx,
  questionId: string,
  input: QuestionInput,
): Promise<Question> {
  const data = parse(questionInput, input);
  await editableQuestion(db, questionId);
  const [updated] = await db
    .update(question)
    .set(questionValues(data))
    .where(eq(question.id, questionId))
    .returning();
  return updated;
}

export async function deleteQuestion(
  db: DbOrTx,
  questionId: string,
): Promise<void> {
  await editableQuestion(db, questionId);
  await db.delete(question).where(eq(question.id, questionId));
}

/**
 * Sets the order of a template's sections (`parentId` = template id) or of a
 * section's questions (`parentId` = section id). `ids` must list every child.
 */
export async function reorder(
  db: DbOrTx,
  target: { kind: "sections" | "questions"; parentId: string; ids: string[] },
): Promise<void> {
  const current =
    target.kind === "sections"
      ? (await editableTemplate(db, target.parentId),
        await db
          .select({ id: templateSection.id })
          .from(templateSection)
          .where(eq(templateSection.templateId, target.parentId)))
      : (await editableSection(db, target.parentId),
        await db
          .select({ id: question.id })
          .from(question)
          .where(eq(question.sectionId, target.parentId)));
  const expected = new Set(current.map((r) => r.id));
  const given = new Set(target.ids);
  if (
    given.size !== target.ids.length ||
    given.size !== expected.size ||
    !target.ids.every((id) => expected.has(id))
  ) {
    throw new TemplatesError("validation", [
      { path: "ids", message: "must_list_every_child" },
    ]);
  }
  // One UPDATE ... FROM (VALUES ...) for the whole new order.
  const values = sql.join(
    target.ids.map((id, sort) => sql`(${id}::uuid, ${sort}::int)`),
    sql`, `,
  );
  const table = target.kind === "sections" ? templateSection : question;
  await db.execute(
    sql`update ${table} set sort = v.sort from (values ${values}) as v(id, sort) where ${table}.id = v.id`,
  );
}
