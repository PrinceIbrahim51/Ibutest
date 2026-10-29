export const APP_NAME = 'IbuTest';

export const GLOBAL_ROLES = ['admin', 'user'] as const;
export type GlobalRole = (typeof GLOBAL_ROLES)[number];

/** Project roles, ordered from least to most privileged. */
export const PROJECT_ROLES = ['viewer', 'tester', 'lead', 'manager'] as const;
export type ProjectRole = (typeof PROJECT_ROLES)[number];

export function projectRoleRank(role: ProjectRole): number {
  return PROJECT_ROLES.indexOf(role);
}

export function hasProjectRole(actual: ProjectRole | null | undefined, required: ProjectRole): boolean {
  if (!actual) return false;
  return projectRoleRank(actual) >= projectRoleRank(required);
}

export const PRIORITIES = ['low', 'medium', 'high', 'critical'] as const;
export type Priority = (typeof PRIORITIES)[number];

export const REQUIREMENT_STATUSES = ['draft', 'approved', 'implemented', 'deprecated'] as const;
export type RequirementStatus = (typeof REQUIREMENT_STATUSES)[number];

export const REQUIREMENT_TYPES = ['functional', 'non_functional', 'user_story', 'epic', 'bug_fix'] as const;
export type RequirementType = (typeof REQUIREMENT_TYPES)[number];

export const TEST_CASE_STATUSES = ['draft', 'ready', 'approved', 'deprecated'] as const;
export type TestCaseStatus = (typeof TEST_CASE_STATUSES)[number];

export const TEST_CASE_TYPES = [
  'functional',
  'regression',
  'smoke',
  'integration',
  'performance',
  'security',
  'usability',
  'acceptance',
  'other',
] as const;
export type TestCaseType = (typeof TEST_CASE_TYPES)[number];

export const RUN_STATUSES = ['not_run', 'in_progress', 'passed', 'failed', 'blocked', 'skipped'] as const;
export type RunStatus = (typeof RUN_STATUSES)[number];

export const EXECUTION_STATUSES = ['in_progress', 'passed', 'failed', 'blocked', 'skipped'] as const;
export type ExecutionStatus = (typeof EXECUTION_STATUSES)[number];

export const STEP_STATUSES = ['not_run', 'passed', 'failed', 'blocked', 'skipped'] as const;
export type StepStatus = (typeof STEP_STATUSES)[number];

export const DEFECT_SEVERITIES = ['minor', 'major', 'critical', 'blocker'] as const;
export type DefectSeverity = (typeof DEFECT_SEVERITIES)[number];

export const DEFECT_STATUSES = ['new', 'open', 'in_progress', 'resolved', 'closed', 'reopened'] as const;
export type DefectStatus = (typeof DEFECT_STATUSES)[number];

export const PLAN_STATUSES = ['planned', 'active', 'closed'] as const;
export type PlanStatus = (typeof PLAN_STATUSES)[number];

export const FOLDER_KINDS = ['requirement', 'test_case'] as const;
export type FolderKind = (typeof FOLDER_KINDS)[number];

export const ATTACHMENT_ENTITY_TYPES = ['requirement', 'test_case', 'test_run', 'defect'] as const;
export type AttachmentEntityType = (typeof ATTACHMENT_ENTITY_TYPES)[number];

/** File types accepted for attachments. Anything else is rejected after content sniffing. */
export const ATTACHMENT_MIME_TYPES = [
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'application/pdf',
  'text/plain',
  'text/csv',
  'application/json',
  'application/zip',
  'video/mp4',
  'video/webm',
] as const;
export const ATTACHMENT_MAX_BYTES = 10 * 1024 * 1024;

export const AI_FOCUS_AREAS = ['positive', 'negative', 'boundary', 'security', 'usability', 'performance'] as const;
export type AiFocusArea = (typeof AI_FOCUS_AREAS)[number];

export const PASSWORD_MIN_LENGTH = 12;
export const PASSWORD_MAX_LENGTH = 128;

/** Header the web client sends on cookie-authenticated endpoints (CSRF defence in depth). */
export const CSRF_HEADER = 'x-requested-with';
export const CSRF_HEADER_VALUE = 'IbuTest';

export const MAX_PAGE_SIZE = 100;
