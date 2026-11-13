export {
  addQuestion,
  addSection,
  cloneTemplate,
  createScale,
  createTemplate,
  deleteQuestion,
  deleteScale,
  deleteSection,
  deleteTemplate,
  getTemplate,
  listScales,
  listTemplates,
  normalizeValues,
  reorder,
  updateQuestion,
  updateSection,
  updateTemplate,
  type ScaleWithOptions,
  type SectionWithQuestions,
  type TemplateDetail,
} from "./service";
export { seedSystemTemplates, SYSTEM_SCALES } from "./seed";
export { TemplatesError, type FieldIssue } from "./errors";
export type {
  QuestionInput,
  ScaleInput,
  SectionInput,
  TemplateInput,
  TemplateUpdateInput,
} from "./validation";
