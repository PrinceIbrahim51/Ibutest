import { z } from 'zod';
import {
  AI_FOCUS_AREAS,
  ATTACHMENT_ENTITY_TYPES,
  DEFECT_SEVERITIES,
  DEFECT_STATUSES,
  EXECUTION_STATUSES,
  FOLDER_KINDS,
  GLOBAL_ROLES,
  MAX_PAGE_SIZE,
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  PLAN_STATUSES,
  PRIORITIES,
  PROJECT_ROLES,
  REQUIREMENT_STATUSES,
  REQUIREMENT_TYPES,
  STEP_STATUSES,
  TEST_CASE_STATUSES,
  TEST_CASE_TYPES,
} from './constants.js';
import { cleanText } from './text.js';

// ---------------------------------------------------------------------------
// Primitive helpers. Every free-text field goes through cleanText + trim + a
// hard length limit, so oversized or control-character payloads never reach the DB.
// ---------------------------------------------------------------------------

/** Required single-line or multi-line text. */
export const text = (max: number) => z.string().max(max * 4).overwrite(cleanText).trim().min(1).max(max);

/** Optional text that defaults to an empty string. */
export const optionalText = (max: number) => z.string().max(max * 4).overwrite(cleanText).trim().max(max);

export const id = () => z.uuid();
export const nullableId = () => z.uuid().nullable();

export const email = () => z.string().trim().toLowerCase().max(254).pipe(z.email());

const COMMON_PASSWORDS = new Set([
  'password1234',
  'password12345',
  'password123456',
  '123456789012',
  '1234567890123',
  'qwertyuiop12',
  'qwertyuiopasdf',
  'iloveyou1234',
  'administrator',
  'administrator1',
  'letmein12345',
  'welcome12345',
  'changeme1234',
  'passw0rd1234',
  'p@ssw0rd1234',
  'abcdefghijkl',
]);

export const password = () =>
  z
    .string()
    .min(PASSWORD_MIN_LENGTH, `Password must be at least ${PASSWORD_MIN_LENGTH} characters`)
    .max(PASSWORD_MAX_LENGTH, `Password must be at most ${PASSWORD_MAX_LENGTH} characters`)
    .refine((v) => !COMMON_PASSWORDS.has(v.toLowerCase()), 'Password is too common')
    .refine((v) => new Set(v).size >= 5, 'Password must contain a wider variety of characters');

const isoDate = () => z.iso.date().nullable();

const paginationShape = {
  page: z.coerce.number().int().min(1).max(100000).default(1),
  pageSize: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(25),
  search: optionalText(200).optional(),
};

export const paginationQuery = z.object(paginationShape);

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

export const loginSchema = z.strictObject({
  email: email(),
  password: z.string().min(1).max(PASSWORD_MAX_LENGTH),
});

export const setupSchema = z.strictObject({
  name: text(100),
  email: email(),
  password: password(),
  setupToken: z.string().max(256).optional(),
});

export const registerSchema = z.strictObject({
  name: text(100),
  email: email(),
  password: password(),
});

export const mfaVerifySchema = z.strictObject({
  mfaToken: z.string().min(1).max(2048),
  code: z.string().regex(/^\d{6}$/, 'Enter the 6-digit code'),
});

export const mfaCodeSchema = z.strictObject({
  code: z.string().regex(/^\d{6}$/, 'Enter the 6-digit code'),
});

export const mfaDisableSchema = z.strictObject({
  password: z.string().min(1).max(PASSWORD_MAX_LENGTH),
  code: z.string().regex(/^\d{6}$/, 'Enter the 6-digit code'),
});

export const changePasswordSchema = z.strictObject({
  currentPassword: z.string().min(1).max(PASSWORD_MAX_LENGTH),
  newPassword: password(),
});

export const updateProfileSchema = z.strictObject({
  name: text(100),
});

// ---------------------------------------------------------------------------
// Administration
// ---------------------------------------------------------------------------

export const createUserSchema = z.strictObject({
  email: email(),
  name: text(100),
  role: z.enum(GLOBAL_ROLES).default('user'),
  password: password().optional(),
});

export const updateUserSchema = z
  .strictObject({
    name: text(100),
    role: z.enum(GLOBAL_ROLES),
    isActive: z.boolean(),
  })
  .partial();

export const auditQuery = z.object({
  ...paginationShape,
  action: optionalText(64).optional(),
  actorId: z.uuid().optional(),
  projectId: z.uuid().optional(),
});

// ---------------------------------------------------------------------------
// Projects & membership
// ---------------------------------------------------------------------------

export const projectKey = () =>
  z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z][A-Z0-9]{1,9}$/, 'Key must be 2-10 letters/digits and start with a letter');

export const createProjectSchema = z.strictObject({
  key: projectKey(),
  name: text(120),
  description: optionalText(5000).default(''),
});

export const updateProjectSchema = z
  .strictObject({
    name: text(120),
    description: optionalText(5000),
    isArchived: z.boolean(),
    aiEnabled: z.boolean(),
  })
  .partial();

export const upsertMemberSchema = z.strictObject({
  userId: id(),
  role: z.enum(PROJECT_ROLES),
});

export const userLookupQuery = z.object({
  q: optionalText(100).default(''),
});

// ---------------------------------------------------------------------------
// Folders (modules)
// ---------------------------------------------------------------------------

export const folderQuery = z.object({ kind: z.enum(FOLDER_KINDS) });

export const createFolderSchema = z.strictObject({
  kind: z.enum(FOLDER_KINDS),
  name: text(120),
  parentId: nullableId().default(null),
});

export const updateFolderSchema = z
  .strictObject({
    name: text(120),
    parentId: nullableId(),
  })
  .partial();

// ---------------------------------------------------------------------------
// Requirements
// ---------------------------------------------------------------------------

const requirementShape = {
  title: text(255),
  description: optionalText(20000),
  priority: z.enum(PRIORITIES),
  status: z.enum(REQUIREMENT_STATUSES),
  type: z.enum(REQUIREMENT_TYPES),
  folderId: nullableId(),
  externalRef: optionalText(100),
};

export const createRequirementSchema = z.strictObject({
  ...requirementShape,
  description: requirementShape.description.default(''),
  priority: requirementShape.priority.default('medium'),
  status: requirementShape.status.default('draft'),
  type: requirementShape.type.default('functional'),
  folderId: requirementShape.folderId.default(null),
  externalRef: requirementShape.externalRef.default(''),
});

export const updateRequirementSchema = z.strictObject(requirementShape).partial();

export const requirementQuery = z.object({
  ...paginationShape,
  folderId: z.uuid().optional(),
  status: z.enum(REQUIREMENT_STATUSES).optional(),
});

export const linkTestCasesSchema = z.strictObject({
  testCaseIds: z.array(id()).min(1).max(200),
});

// ---------------------------------------------------------------------------
// Test cases
// ---------------------------------------------------------------------------

export const testStepSchema = z.strictObject({
  action: text(4000),
  expected: optionalText(4000).default(''),
  testData: optionalText(2000).default(''),
});

const tag = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9][a-z0-9_-]{0,31}$/, 'Tags may contain letters, digits, "-" and "_" (max 32)');

const automationKey = z
  .string()
  .trim()
  .max(255)
  .regex(/^[\w.:/#@\-[\] ()]+$/, 'Automation key contains unsupported characters')
  .nullable();

const testCaseShape = {
  title: text(255),
  description: optionalText(20000),
  preconditions: optionalText(10000),
  priority: z.enum(PRIORITIES),
  status: z.enum(TEST_CASE_STATUSES).exclude(['approved']),
  type: z.enum(TEST_CASE_TYPES),
  folderId: nullableId(),
  automationKey,
  isAutomated: z.boolean(),
  estimatedMinutes: z.number().int().min(0).max(10000).nullable(),
  tags: z.array(tag).max(20),
  steps: z.array(testStepSchema).max(200),
};

export const createTestCaseSchema = z.strictObject({
  ...testCaseShape,
  description: testCaseShape.description.default(''),
  preconditions: testCaseShape.preconditions.default(''),
  priority: testCaseShape.priority.default('medium'),
  status: testCaseShape.status.default('draft'),
  type: testCaseShape.type.default('functional'),
  folderId: testCaseShape.folderId.default(null),
  automationKey: automationKey.default(null),
  isAutomated: testCaseShape.isAutomated.default(false),
  estimatedMinutes: testCaseShape.estimatedMinutes.default(null),
  tags: testCaseShape.tags.default([]),
  steps: testCaseShape.steps.default([]),
});

export const updateTestCaseSchema = z.strictObject(testCaseShape).partial();

export const testCaseQuery = z.object({
  ...paginationShape,
  folderId: z.uuid().optional(),
  status: z.enum(TEST_CASE_STATUSES).optional(),
  priority: z.enum(PRIORITIES).optional(),
});

// ---------------------------------------------------------------------------
// Test planning & execution
// ---------------------------------------------------------------------------

const dateRangeOk = (v: { startDate?: string | null; endDate?: string | null }) =>
  !v.startDate || !v.endDate || v.startDate <= v.endDate;

const releaseShape = {
  name: text(120),
  description: optionalText(5000),
  startDate: isoDate(),
  endDate: isoDate(),
  status: z.enum(PLAN_STATUSES),
};

export const createReleaseSchema = z
  .strictObject({
    ...releaseShape,
    description: releaseShape.description.default(''),
    startDate: releaseShape.startDate.default(null),
    endDate: releaseShape.endDate.default(null),
    status: releaseShape.status.default('planned'),
  })
  .refine(dateRangeOk, { message: 'End date must be after start date', path: ['endDate'] });

export const updateReleaseSchema = z
  .strictObject(releaseShape)
  .partial()
  .refine(dateRangeOk, { message: 'End date must be after start date', path: ['endDate'] });

const cycleShape = { ...releaseShape, releaseId: nullableId() };

export const createCycleSchema = z
  .strictObject({
    ...cycleShape,
    description: cycleShape.description.default(''),
    startDate: cycleShape.startDate.default(null),
    endDate: cycleShape.endDate.default(null),
    status: cycleShape.status.default('planned'),
    releaseId: cycleShape.releaseId.default(null),
  })
  .refine(dateRangeOk, { message: 'End date must be after start date', path: ['endDate'] });

export const updateCycleSchema = z
  .strictObject(cycleShape)
  .partial()
  .refine(dateRangeOk, { message: 'End date must be after start date', path: ['endDate'] });

export const cycleQuery = z.object({ releaseId: z.uuid().optional() });

export const addRunsSchema = z
  .strictObject({
    testCaseIds: z.array(id()).max(500).optional(),
    folderId: z.uuid().optional(),
    assigneeId: nullableId().optional(),
  })
  .refine((v) => (v.testCaseIds && v.testCaseIds.length > 0) || v.folderId, {
    message: 'Provide testCaseIds or folderId',
  });

export const updateRunSchema = z.strictObject({
  assigneeId: nullableId(),
});

export const executeRunSchema = z.strictObject({
  status: z.enum(EXECUTION_STATUSES),
  comment: optionalText(10000).default(''),
  durationSeconds: z.number().int().min(0).max(864000).nullable().default(null),
  stepResults: z
    .array(
      z.strictObject({
        position: z.number().int().min(0).max(1000),
        status: z.enum(STEP_STATUSES),
        actual: optionalText(4000).default(''),
      }),
    )
    .max(200)
    .default([]),
});

// ---------------------------------------------------------------------------
// Defects
// ---------------------------------------------------------------------------

const defectShape = {
  title: text(255),
  description: optionalText(20000),
  stepsToReproduce: optionalText(20000),
  expectedResult: optionalText(5000),
  actualResult: optionalText(5000),
  severity: z.enum(DEFECT_SEVERITIES),
  priority: z.enum(PRIORITIES),
  status: z.enum(DEFECT_STATUSES),
  assigneeId: nullableId(),
  testRunId: nullableId(),
  testCaseId: nullableId(),
  environment: optionalText(255),
  externalRef: optionalText(100),
};

export const createDefectSchema = z.strictObject({
  ...defectShape,
  description: defectShape.description.default(''),
  stepsToReproduce: defectShape.stepsToReproduce.default(''),
  expectedResult: defectShape.expectedResult.default(''),
  actualResult: defectShape.actualResult.default(''),
  severity: defectShape.severity.default('major'),
  priority: defectShape.priority.default('medium'),
  status: defectShape.status.default('new'),
  assigneeId: defectShape.assigneeId.default(null),
  testRunId: defectShape.testRunId.default(null),
  testCaseId: defectShape.testCaseId.default(null),
  environment: defectShape.environment.default(''),
  externalRef: defectShape.externalRef.default(''),
});

export const updateDefectSchema = z
  .strictObject(defectShape)
  .omit({ testRunId: true, testCaseId: true })
  .partial();

export const defectQuery = z.object({
  ...paginationShape,
  status: z.enum(DEFECT_STATUSES).optional(),
  severity: z.enum(DEFECT_SEVERITIES).optional(),
  assigneeId: z.uuid().optional(),
});

// ---------------------------------------------------------------------------
// Attachments
// ---------------------------------------------------------------------------

export const attachmentQuery = z.object({
  entityType: z.enum(ATTACHMENT_ENTITY_TYPES),
  entityId: z.uuid(),
});

// ---------------------------------------------------------------------------
// Automation integration
// ---------------------------------------------------------------------------

export const createApiTokenSchema = z.strictObject({
  name: text(100),
  expiresInDays: z.number().int().min(1).max(365).default(90),
});

export const automationResultsSchema = z
  .strictObject({
    cycleId: z.uuid().optional(),
    cycleName: text(120).optional(),
    releaseId: z.uuid().optional(),
    createMissing: z.boolean().default(true),
    results: z
      .array(
        z.strictObject({
          automationKey: automationKey.unwrap().min(1),
          name: text(255).optional(),
          status: z.enum(['passed', 'failed', 'blocked', 'skipped']),
          durationSeconds: z.number().min(0).max(864000).optional(),
          message: optionalText(10000).optional(),
        }),
      )
      .min(1)
      .max(1000),
  })
  .refine((v) => v.cycleId || v.cycleName, { message: 'Provide cycleId or cycleName' });

// ---------------------------------------------------------------------------
// AI assistant
// ---------------------------------------------------------------------------

export const aiGenerateTestCasesSchema = z
  .strictObject({
    requirementId: z.uuid().optional(),
    text: optionalText(20000).optional(),
    count: z.number().int().min(1).max(10).default(5),
    focus: z.array(z.enum(AI_FOCUS_AREAS)).max(AI_FOCUS_AREAS.length).default(['positive', 'negative']),
  })
  .refine((v) => v.requirementId || (v.text && v.text.length >= 10), {
    message: 'Provide a requirement or at least 10 characters of text',
  });

export const aiReviewTestCaseSchema = z.strictObject({ testCaseId: id() });
export const aiDraftDefectSchema = z.strictObject({ testRunId: id() });
export const aiSummarizeCycleSchema = z.strictObject({ cycleId: id() });

export type LoginInput = z.infer<typeof loginSchema>;
export type CreateTestCaseInput = z.input<typeof createTestCaseSchema>;
export type UpdateTestCaseInput = z.infer<typeof updateTestCaseSchema>;
export type ExecuteRunInput = z.input<typeof executeRunSchema>;
export type CreateDefectInput = z.input<typeof createDefectSchema>;
