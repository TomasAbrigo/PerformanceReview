"use server";

import type { QuestionPayload } from "@/components/templates/template-editor";
import { db } from "@/db/client";
import { actionResult } from "@/lib/action-result";
import type { LocalizedText } from "@/db/schema";
import * as templates from "@/modules/templates";

const result = <T extends object = object>(fn: () => Promise<T | void>) =>
  actionResult(fn, { refreshPage: true });

// Scales

export async function createScaleAction(input: templates.ScaleInput) {
  return result(async () => {
    await templates.createScale(db, input);
  });
}

export async function deleteScaleAction(id: string) {
  return result(() => templates.deleteScale(db, id));
}

// Templates

export async function createTemplateAction(input: { name: LocalizedText }) {
  return result(async () => ({
    id: (await templates.createTemplate(db, input)).id,
  }));
}

export async function cloneTemplateAction(id: string) {
  return result(async () => ({
    id: (await templates.cloneTemplate(db, id)).id,
  }));
}

export async function deleteTemplateAction(id: string) {
  return result(() => templates.deleteTemplate(db, id));
}

export async function updateTemplateAction(
  id: string,
  input: { name: LocalizedText },
) {
  return result(() => templates.updateTemplate(db, id, input));
}

export async function addSectionAction(
  templateId: string,
  input: { title: LocalizedText },
) {
  return result(async () => {
    await templates.addSection(db, templateId, input);
  });
}

export async function updateSectionAction(
  sectionId: string,
  input: { title: LocalizedText },
) {
  return result(() => templates.updateSection(db, sectionId, input));
}

export async function deleteSectionAction(sectionId: string) {
  return result(() => templates.deleteSection(db, sectionId));
}

export async function addQuestionAction(
  sectionId: string,
  input: QuestionPayload,
) {
  return result(async () => {
    await templates.addQuestion(db, sectionId, input);
  });
}

export async function updateQuestionAction(
  questionId: string,
  input: QuestionPayload,
) {
  return result(async () => {
    await templates.updateQuestion(db, questionId, input);
  });
}

export async function deleteQuestionAction(questionId: string) {
  return result(() => templates.deleteQuestion(db, questionId));
}

export async function reorderAction(target: {
  kind: "sections" | "questions";
  parentId: string;
  ids: string[];
}) {
  return result(() => templates.reorder(db, target));
}
