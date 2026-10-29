import type { FolderKind } from '@ibutest/shared';
import { and, eq, inArray, sql } from 'drizzle-orm';
import type { Executor } from '../db/index.js';
import { folders, projectMembers, projects, testCases } from '../db/schema.js';
import { badRequest } from '../lib/errors.js';

export const KEY_PREFIX = { requirement: 'RQ', testCase: 'TC', defect: 'DF' } as const;

export function displayKey(prefix: string, seq: number): string {
  return `${prefix}-${seq}`;
}

const KEY_SEARCH = /^([A-Z]{2})-(\d{1,9})$/i;

/** Parses "TC-12" style search input into a sequence number for exact-key lookups. */
export function parseKeySearch(search: string | undefined, prefix: string): number | null {
  const m = search ? KEY_SEARCH.exec(search.trim()) : null;
  return m && m[1]!.toUpperCase() === prefix ? Number(m[2]) : null;
}

type SeqColumn = 'requirementSeq' | 'testCaseSeq' | 'defectSeq';

/** Atomically allocates the next per-project sequence number (row-level lock via UPDATE). */
export async function nextSeq(db: Executor, projectId: string, column: SeqColumn): Promise<number> {
  const col = projects[column];
  const [row] = await db
    .update(projects)
    .set({ [column]: sql`${col} + 1` })
    .where(eq(projects.id, projectId))
    .returning({ seq: col });
  if (!row) throw badRequest('Project not found');
  return row.seq;
}

export async function assertFolder(db: Executor, projectId: string, folderId: string | null | undefined, kind: FolderKind) {
  if (!folderId) return;
  const [row] = await db
    .select({ id: folders.id })
    .from(folders)
    .where(and(eq(folders.id, folderId), eq(folders.projectId, projectId), eq(folders.kind, kind)))
    .limit(1);
  if (!row) throw badRequest('Folder does not exist in this project');
}

export async function assertMember(db: Executor, projectId: string, userId: string | null | undefined) {
  if (!userId) return;
  const [row] = await db
    .select({ userId: projectMembers.userId })
    .from(projectMembers)
    .where(and(eq(projectMembers.projectId, projectId), eq(projectMembers.userId, userId)))
    .limit(1);
  if (!row) throw badRequest('Assignee must be a member of this project');
}

/** Ensures every id belongs to the project. Returns the distinct ids. */
export async function assertTestCasesInProject(db: Executor, projectId: string, ids: string[]): Promise<string[]> {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return unique;
  const rows = await db
    .select({ id: testCases.id })
    .from(testCases)
    .where(and(eq(testCases.projectId, projectId), inArray(testCases.id, unique)));
  if (rows.length !== unique.length) throw badRequest('One or more test cases do not exist in this project');
  return unique;
}
