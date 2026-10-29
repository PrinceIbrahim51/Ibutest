import type {
  DefectSeverity,
  DefectStatus,
  FolderKind,
  GlobalRole,
  PlanStatus,
  Priority,
  ProjectRole,
  RequirementStatus,
  RequirementType,
  RunStatus,
  StepStatus,
  TestCaseStatus,
  TestCaseType,
} from './constants.js';

/** JSON wire types returned by the IbuTest API (dates are ISO strings). */

export interface Page<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export interface ApiErrorBody {
  error: { code: string; message: string; details?: { path: string; message: string }[] };
  requestId?: string;
}

export interface User {
  id: string;
  email: string;
  name: string;
  role: GlobalRole;
  isActive: boolean;
  mfaEnabled: boolean;
  mustChangePassword: boolean;
  lastLoginAt: string | null;
  createdAt: string;
  lockedUntil?: string | null;
}

export interface AuthStatus {
  setupRequired: boolean;
  setupTokenRequired: boolean;
  registrationEnabled: boolean;
  aiAvailable: boolean;
}

export interface SessionResponse {
  accessToken: string;
  expiresIn: number;
  user: User;
}

export type LoginResponse = SessionResponse | { mfaRequired: true; mfaToken: string };

export interface SessionInfo {
  id: string;
  ip: string | null;
  userAgent: string | null;
  createdAt: string;
  lastUsedAt: string;
  current?: boolean;
}

export interface Project {
  id: string;
  key: string;
  name: string;
  description: string;
  isArchived: boolean;
  aiEnabled: boolean;
  createdAt: string;
  role: ProjectRole;
}

export interface Member {
  userId: string;
  name: string;
  email: string;
  role: ProjectRole;
  isActive: boolean;
  addedAt: string;
}

export interface Folder {
  id: string;
  parentId: string | null;
  name: string;
  kind: FolderKind;
}

export interface Requirement {
  id: string;
  key: string;
  projectId: string;
  folderId: string | null;
  title: string;
  description: string;
  priority: Priority;
  status: RequirementStatus;
  type: RequirementType;
  externalRef: string;
  createdAt: string;
  updatedAt: string;
  linkedTestCases?: number;
  createdByName?: string | null;
}

export interface TestStep {
  id?: string;
  position?: number;
  action: string;
  expected: string;
  testData: string;
}

export interface TestCase {
  id: string;
  key: string;
  projectId: string;
  folderId: string | null;
  title: string;
  description: string;
  preconditions: string;
  priority: Priority;
  status: TestCaseStatus;
  type: TestCaseType;
  automationKey: string | null;
  isAutomated: boolean;
  estimatedMinutes: number | null;
  tags: string[];
  version: number;
  approvedBy: string | null;
  approvedAt: string | null;
  createdAt: string;
  updatedAt: string;
  stepCount?: number;
  requirementCount?: number;
  createdByName?: string | null;
  approvedByName?: string | null;
}

export interface TestCaseDetail {
  testCase: TestCase;
  steps: TestStep[];
  requirements: { id: string; key: string; title: string; status: RequirementStatus }[];
  recentRuns: { id: string; status: RunStatus; executedAt: string | null; cycleId: string; cycleName: string }[];
}

export interface TestCaseVersion {
  version: number;
  createdAt: string;
  changedByName: string | null;
}

export interface Release {
  id: string;
  name: string;
  description: string;
  startDate: string | null;
  endDate: string | null;
  status: PlanStatus;
  cycleCount?: number;
  createdAt: string;
}

export type RunCounts = Record<'total' | RunStatus, number>;

export interface Cycle {
  id: string;
  releaseId: string | null;
  releaseName?: string | null;
  name: string;
  description: string;
  startDate: string | null;
  endDate: string | null;
  status: PlanStatus;
  counts: RunCounts;
  createdAt: string;
}

export interface TestRun {
  id: string;
  cycleId: string;
  testCaseId: string;
  testCaseVersion: number;
  testCaseKey?: string;
  testCaseTitle?: string;
  priority?: Priority;
  isAutomated?: boolean;
  outdated?: boolean;
  assigneeId: string | null;
  assigneeName?: string | null;
  status: RunStatus;
  executedAt: string | null;
  durationSeconds: number | null;
  comment: string;
}

export interface StepResult {
  position: number;
  action: string;
  expected: string;
  status: StepStatus;
  actual: string;
}

export interface TestLog {
  id: string;
  status: RunStatus;
  executedAt: string;
  executedByName: string | null;
  durationSeconds: number | null;
  comment: string;
  stepResults: StepResult[];
  source: 'manual' | 'automation';
}

export interface RunDetail {
  run: TestRun;
  cycle: { id: string; name: string; status: PlanStatus };
  testCase: TestCase;
  steps: TestStep[];
  logs: TestLog[];
  defects: { id: string; key: string; title: string; status: DefectStatus; severity: DefectSeverity }[];
}

export interface Defect {
  id: string;
  key: string;
  title: string;
  description: string;
  stepsToReproduce: string;
  expectedResult: string;
  actualResult: string;
  severity: DefectSeverity;
  priority: Priority;
  status: DefectStatus;
  environment: string;
  externalRef: string;
  assigneeId: string | null;
  assigneeName?: string | null;
  reporterName?: string | null;
  testRunId: string | null;
  testCaseId: string | null;
  testCaseKey?: string | null;
  testCaseTitle?: string | null;
  resolvedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Attachment {
  id: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  createdAt: string;
  uploadedBy: string | null;
  uploadedByName: string | null;
}

export interface ApiToken {
  id: string;
  name: string;
  tokenPrefix: string;
  expiresAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
  createdAt: string;
  ownerId: string;
  ownerName: string;
}

export interface Dashboard {
  requirements: { total: number; covered: number };
  testCases: { total: number; automated: number; byStatus: Partial<Record<TestCaseStatus, number>> };
  defects: { openBySeverity: Partial<Record<DefectSeverity, number>>; byStatus: Partial<Record<DefectStatus, number>> };
  activeCycles: { id: string; name: string; status: PlanStatus; endDate: string | null; counts: RunCounts | null }[];
  executionTrend: { day: string; status: RunStatus; n: number }[];
  recentActivity: { action: string; actorEmail: string | null; entityType: string | null; createdAt: string }[];
}

export interface TraceabilityRow {
  id: string;
  key: string;
  title: string;
  status: RequirementStatus;
  priority: Priority;
  testCases: { id: string; key: string; title: string; lastStatus: RunStatus; lastExecutedAt: string | null }[];
}

export interface AuditLog {
  id: string;
  actorId: string | null;
  actorEmail: string | null;
  action: string;
  entityType: string | null;
  entityId: string | null;
  projectId: string | null;
  ip: string | null;
  userAgent: string | null;
  details: Record<string, unknown>;
  createdAt: string;
}

export interface AiGeneratedTestCase {
  title: string;
  description: string;
  preconditions: string;
  priority: Priority;
  type: TestCaseType;
  steps: { action: string; expected: string; testData: string }[];
}

export interface AiReview {
  score: number;
  summary: string;
  issues: { severity: 'high' | 'medium' | 'low'; category: string; message: string; stepNumber: number | null }[];
  suggestedAdditionalTests: string[];
}

export interface AiDefectDraft {
  title: string;
  description: string;
  stepsToReproduce: string;
  expectedResult: string;
  actualResult: string;
  severity: DefectSeverity;
  priority: Priority;
}

export interface AiCycleSummary {
  summary: string;
  readiness: 'ready' | 'at_risk' | 'not_ready';
  risks: string[];
  recommendations: string[];
}
