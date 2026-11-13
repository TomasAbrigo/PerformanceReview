export { findCandidates, toCandidates } from "./candidates";
export { IdentityError, type IdentityErrorCode } from "./errors";
export { normalizeName } from "./normalize";
export {
  resolvePerson,
  type ResolveContext,
  type ResolveResult,
} from "./resolve-person";
export {
  countOpenIssues,
  getIssue,
  ignoreIssue,
  listIssues,
  resolveIssue,
  summarizePayload,
  type CandidateDetail,
  type IssueDetailData,
  type IssueListItem,
  type PayloadSummary,
  type ResolveInput,
} from "./service";
