export {
  addQuestion,
  addSection,
  cloneTemplate,
  createScale,
  createTemplate,
  deleteScale,
  deleteTemplate,
  getTemplate,
  listScales,
  listTemplates,
  normalizeValues,
  reorder,
  updateQuestion,
  updateTemplate,
  type ScaleWithOptions,
  type SectionWithQuestions,
  type TemplateDetail,
} from "./service";
export { seedSystemTemplates, SYSTEM_SCALES } from "./seed";
export { TemplatesError, type FieldIssue } from "./errors";
export type {
  QuestionInput,
  SectionInput,
  TemplateInput,
  TemplateUpdateInput,
} from "./validation";
