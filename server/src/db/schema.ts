import { sql } from 'drizzle-orm';
import {
  type AnyPgColumn,
  boolean,
  date,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import {
  ATTACHMENT_ENTITY_TYPES,
  DEFECT_SEVERITIES,
  DEFECT_STATUSES,
  FOLDER_KINDS,
  GLOBAL_ROLES,
  PLAN_STATUSES,
  PRIORITIES,
  PROJECT_ROLES,
  REQUIREMENT_STATUSES,
  REQUIREMENT_TYPES,
  RUN_STATUSES,
  TEST_CASE_STATUSES,
  TEST_CASE_TYPES,
  type StepStatus,
} from '@ibutest/shared';

// Enums are enforced by PostgreSQL itself, as a second line of defence behind the API validation.
export const globalRole = pgEnum('global_role', GLOBAL_ROLES);
export const projectRole = pgEnum('project_role', PROJECT_ROLES);
export const priority = pgEnum('priority', PRIORITIES);
export const requirementStatus = pgEnum('requirement_status', REQUIREMENT_STATUSES);
export const requirementType = pgEnum('requirement_type', REQUIREMENT_TYPES);
export const testCaseStatus = pgEnum('test_case_status', TEST_CASE_STATUSES);
export const testCaseType = pgEnum('test_case_type', TEST_CASE_TYPES);
export const runStatus = pgEnum('run_status', RUN_STATUSES);
export const defectSeverity = pgEnum('defect_severity', DEFECT_SEVERITIES);
export const defectStatus = pgEnum('defect_status', DEFECT_STATUSES);
export const planStatus = pgEnum('plan_status', PLAN_STATUSES);
export const folderKind = pgEnum('folder_kind', FOLDER_KINDS);
export const attachmentEntity = pgEnum('attachment_entity', ATTACHMENT_ENTITY_TYPES);

const timestamps = {
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
};

// ---------------------------------------------------------------------------
// Identity & access
// ---------------------------------------------------------------------------

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: varchar('email', { length: 254 }).notNull().unique(),
  name: varchar('name', { length: 100 }).notNull(),
  passwordHash: text('password_hash').notNull(),
  role: globalRole('role').notNull().default('user'),
  isActive: boolean('is_active').notNull().default(true),
  mustChangePassword: boolean('must_change_password').notNull().default(false),
  failedLoginCount: integer('failed_login_count').notNull().default(0),
  lockedUntil: timestamp('locked_until', { withTimezone: true }),
  mfaEnabled: boolean('mfa_enabled').notNull().default(false),
  mfaSecretEnc: text('mfa_secret_enc'),
  mfaPendingSecretEnc: text('mfa_pending_secret_enc'),
  mfaLastStep: integer('mfa_last_step'),
  passwordChangedAt: timestamp('password_changed_at', { withTimezone: true }).notNull().defaultNow(),
  lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
  ...timestamps,
});

/** One row per login session. Only SHA-256 hashes of refresh tokens are stored. */
export const sessions = pgTable(
  'sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    tokenHash: varchar('token_hash', { length: 64 }).notNull().unique(),
    previousTokenHash: varchar('previous_token_hash', { length: 64 }),
    rotatedAt: timestamp('rotated_at', { withTimezone: true }),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    ip: varchar('ip', { length: 64 }),
    userAgent: varchar('user_agent', { length: 512 }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('sessions_user_idx').on(t.userId), index('sessions_prev_token_idx').on(t.previousTokenHash)],
);

// ---------------------------------------------------------------------------
// Projects
// ---------------------------------------------------------------------------

export const projects = pgTable('projects', {
  id: uuid('id').primaryKey().defaultRandom(),
  key: varchar('key', { length: 10 }).notNull().unique(),
  name: varchar('name', { length: 120 }).notNull(),
  description: text('description').notNull().default(''),
  isArchived: boolean('is_archived').notNull().default(false),
  aiEnabled: boolean('ai_enabled').notNull().default(true),
  requirementSeq: integer('requirement_seq').notNull().default(0),
  testCaseSeq: integer('test_case_seq').notNull().default(0),
  defectSeq: integer('defect_seq').notNull().default(0),
  createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
  ...timestamps,
});

export const projectMembers = pgTable(
  'project_members',
  {
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: projectRole('role').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.projectId, t.userId] }), index('project_members_user_idx').on(t.userId)],
);

/** Project-scoped automation tokens (personal access tokens). Stored hashed. */
export const apiTokens = pgTable(
  'api_tokens',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    name: varchar('name', { length: 100 }).notNull(),
    tokenPrefix: varchar('token_prefix', { length: 16 }).notNull(),
    tokenHash: varchar('token_hash', { length: 64 }).notNull().unique(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('api_tokens_project_idx').on(t.projectId)],
);

export const folders = pgTable(
  'folders',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    parentId: uuid('parent_id').references((): AnyPgColumn => folders.id, { onDelete: 'cascade' }),
    kind: folderKind('kind').notNull(),
    name: varchar('name', { length: 120 }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('folders_project_kind_idx').on(t.projectId, t.kind)],
);

// ---------------------------------------------------------------------------
// Requirements & test design
// ---------------------------------------------------------------------------

export const requirements = pgTable(
  'requirements',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    folderId: uuid('folder_id').references(() => folders.id, { onDelete: 'set null' }),
    seq: integer('seq').notNull(),
    title: varchar('title', { length: 255 }).notNull(),
    description: text('description').notNull().default(''),
    priority: priority('priority').notNull().default('medium'),
    status: requirementStatus('status').notNull().default('draft'),
    type: requirementType('type').notNull().default('functional'),
    externalRef: varchar('external_ref', { length: 100 }).notNull().default(''),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    updatedBy: uuid('updated_by').references(() => users.id, { onDelete: 'set null' }),
    ...timestamps,
  },
  (t) => [uniqueIndex('requirements_project_seq_idx').on(t.projectId, t.seq), index('requirements_folder_idx').on(t.folderId)],
);

export const testCases = pgTable(
  'test_cases',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    folderId: uuid('folder_id').references(() => folders.id, { onDelete: 'set null' }),
    seq: integer('seq').notNull(),
    title: varchar('title', { length: 255 }).notNull(),
    description: text('description').notNull().default(''),
    preconditions: text('preconditions').notNull().default(''),
    priority: priority('priority').notNull().default('medium'),
    status: testCaseStatus('status').notNull().default('draft'),
    type: testCaseType('type').notNull().default('functional'),
    automationKey: varchar('automation_key', { length: 255 }),
    isAutomated: boolean('is_automated').notNull().default(false),
    estimatedMinutes: integer('estimated_minutes'),
    tags: text('tags')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    version: integer('version').notNull().default(1),
    approvedBy: uuid('approved_by').references(() => users.id, { onDelete: 'set null' }),
    approvedAt: timestamp('approved_at', { withTimezone: true }),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    updatedBy: uuid('updated_by').references(() => users.id, { onDelete: 'set null' }),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('test_cases_project_seq_idx').on(t.projectId, t.seq),
    uniqueIndex('test_cases_automation_key_idx').on(t.projectId, t.automationKey),
    index('test_cases_folder_idx').on(t.folderId),
  ],
);

export const testSteps = pgTable(
  'test_steps',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    testCaseId: uuid('test_case_id')
      .notNull()
      .references(() => testCases.id, { onDelete: 'cascade' }),
    position: integer('position').notNull(),
    action: text('action').notNull(),
    expected: text('expected').notNull().default(''),
    testData: text('test_data').notNull().default(''),
  },
  (t) => [index('test_steps_case_idx').on(t.testCaseId, t.position)],
);

export interface TestCaseSnapshot {
  title: string;
  description: string;
  preconditions: string;
  priority: string;
  status: string;
  type: string;
  automationKey: string | null;
  isAutomated: boolean;
  estimatedMinutes: number | null;
  tags: string[];
  steps: { action: string; expected: string; testData: string }[];
}

export const testCaseVersions = pgTable(
  'test_case_versions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    testCaseId: uuid('test_case_id')
      .notNull()
      .references(() => testCases.id, { onDelete: 'cascade' }),
    version: integer('version').notNull(),
    snapshot: jsonb('snapshot').$type<TestCaseSnapshot>().notNull(),
    changedBy: uuid('changed_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('test_case_versions_idx').on(t.testCaseId, t.version)],
);

export const requirementLinks = pgTable(
  'requirement_links',
  {
    requirementId: uuid('requirement_id')
      .notNull()
      .references(() => requirements.id, { onDelete: 'cascade' }),
    testCaseId: uuid('test_case_id')
      .notNull()
      .references(() => testCases.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.requirementId, t.testCaseId] }), index('requirement_links_tc_idx').on(t.testCaseId)],
);

// ---------------------------------------------------------------------------
// Planning & execution
// ---------------------------------------------------------------------------

export const releases = pgTable(
  'releases',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    name: varchar('name', { length: 120 }).notNull(),
    description: text('description').notNull().default(''),
    startDate: date('start_date'),
    endDate: date('end_date'),
    status: planStatus('status').notNull().default('planned'),
    ...timestamps,
  },
  (t) => [index('releases_project_idx').on(t.projectId)],
);

export const testCycles = pgTable(
  'test_cycles',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    releaseId: uuid('release_id').references(() => releases.id, { onDelete: 'set null' }),
    name: varchar('name', { length: 120 }).notNull(),
    description: text('description').notNull().default(''),
    startDate: date('start_date'),
    endDate: date('end_date'),
    status: planStatus('status').notNull().default('planned'),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    ...timestamps,
  },
  (t) => [index('test_cycles_project_idx').on(t.projectId), index('test_cycles_release_idx').on(t.releaseId)],
);

export const testRuns = pgTable(
  'test_runs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    cycleId: uuid('cycle_id')
      .notNull()
      .references(() => testCycles.id, { onDelete: 'cascade' }),
    testCaseId: uuid('test_case_id')
      .notNull()
      .references(() => testCases.id, { onDelete: 'cascade' }),
    testCaseVersion: integer('test_case_version').notNull(),
    assigneeId: uuid('assignee_id').references(() => users.id, { onDelete: 'set null' }),
    status: runStatus('status').notNull().default('not_run'),
    executedBy: uuid('executed_by').references(() => users.id, { onDelete: 'set null' }),
    executedAt: timestamp('executed_at', { withTimezone: true }),
    durationSeconds: integer('duration_seconds'),
    comment: text('comment').notNull().default(''),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('test_runs_cycle_case_idx').on(t.cycleId, t.testCaseId),
    index('test_runs_project_idx').on(t.projectId),
    index('test_runs_case_idx').on(t.testCaseId),
  ],
);

export interface StepResult {
  position: number;
  action: string;
  expected: string;
  status: StepStatus;
  actual: string;
}

/** Immutable execution history for a test run. */
export const testLogs = pgTable(
  'test_logs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    testRunId: uuid('test_run_id')
      .notNull()
      .references(() => testRuns.id, { onDelete: 'cascade' }),
    status: runStatus('status').notNull(),
    executedBy: uuid('executed_by').references(() => users.id, { onDelete: 'set null' }),
    executedAt: timestamp('executed_at', { withTimezone: true }).notNull().defaultNow(),
    durationSeconds: integer('duration_seconds'),
    comment: text('comment').notNull().default(''),
    stepResults: jsonb('step_results').$type<StepResult[]>().notNull().default([]),
    source: varchar('source', { length: 20 }).notNull().default('manual'),
  },
  (t) => [index('test_logs_run_idx').on(t.testRunId, t.executedAt)],
);

export const defects = pgTable(
  'defects',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    seq: integer('seq').notNull(),
    title: varchar('title', { length: 255 }).notNull(),
    description: text('description').notNull().default(''),
    stepsToReproduce: text('steps_to_reproduce').notNull().default(''),
    expectedResult: text('expected_result').notNull().default(''),
    actualResult: text('actual_result').notNull().default(''),
    severity: defectSeverity('severity').notNull().default('major'),
    priority: priority('priority').notNull().default('medium'),
    status: defectStatus('status').notNull().default('new'),
    environment: varchar('environment', { length: 255 }).notNull().default(''),
    externalRef: varchar('external_ref', { length: 100 }).notNull().default(''),
    assigneeId: uuid('assignee_id').references(() => users.id, { onDelete: 'set null' }),
    reporterId: uuid('reporter_id').references(() => users.id, { onDelete: 'set null' }),
    testRunId: uuid('test_run_id').references(() => testRuns.id, { onDelete: 'set null' }),
    testCaseId: uuid('test_case_id').references(() => testCases.id, { onDelete: 'set null' }),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('defects_project_seq_idx').on(t.projectId, t.seq),
    index('defects_run_idx').on(t.testRunId),
    index('defects_case_idx').on(t.testCaseId),
  ],
);

export const attachments = pgTable(
  'attachments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    entityType: attachmentEntity('entity_type').notNull(),
    entityId: uuid('entity_id').notNull(),
    fileName: varchar('file_name', { length: 255 }).notNull(),
    storedName: varchar('stored_name', { length: 64 }).notNull().unique(),
    mimeType: varchar('mime_type', { length: 100 }).notNull(),
    sizeBytes: integer('size_bytes').notNull(),
    sha256: varchar('sha256', { length: 64 }).notNull(),
    uploadedBy: uuid('uploaded_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('attachments_entity_idx').on(t.projectId, t.entityType, t.entityId)],
);

// ---------------------------------------------------------------------------
// Auditing & AI usage
// ---------------------------------------------------------------------------

/** Append-only security/audit trail. Intentionally has no foreign keys so history survives deletions. */
export const auditLogs = pgTable(
  'audit_logs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    actorId: uuid('actor_id'),
    actorEmail: varchar('actor_email', { length: 254 }),
    action: varchar('action', { length: 64 }).notNull(),
    entityType: varchar('entity_type', { length: 32 }),
    entityId: varchar('entity_id', { length: 64 }),
    projectId: uuid('project_id'),
    ip: varchar('ip', { length: 64 }),
    userAgent: varchar('user_agent', { length: 512 }),
    details: jsonb('details').$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('audit_logs_created_idx').on(t.createdAt),
    index('audit_logs_project_idx').on(t.projectId),
    index('audit_logs_actor_idx').on(t.actorId),
  ],
);

export const aiUsage = pgTable(
  'ai_usage',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
    projectId: uuid('project_id').references(() => projects.id, { onDelete: 'set null' }),
    feature: varchar('feature', { length: 40 }).notNull(),
    model: varchar('model', { length: 64 }).notNull(),
    inputTokens: integer('input_tokens').notNull().default(0),
    outputTokens: integer('output_tokens').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('ai_usage_user_idx').on(t.userId, t.createdAt)],
);
