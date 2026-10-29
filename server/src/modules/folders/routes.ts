import { createFolderSchema, folderQuery, updateFolderSchema } from '@ibutest/shared';
import { and, eq } from 'drizzle-orm';
import { Router } from 'express';
import type { AppContext } from '../../context.js';
import { folders } from '../../db/schema.js';
import { audit } from '../../lib/audit.js';
import { badRequest, notFound } from '../../lib/errors.js';
import { parseBody, parseQuery, uuidParam } from '../../lib/http.js';
import { projectOf, requireProjectRole } from '../../middleware/project.js';

const MAX_DEPTH = 10;

export function foldersRouter(ctx: AppContext) {
  const router = Router({ mergeParams: true });

  async function load(projectId: string, folderId: string) {
    const [row] = await ctx.db
      .select()
      .from(folders)
      .where(and(eq(folders.id, folderId), eq(folders.projectId, projectId)))
      .limit(1);
    if (!row) throw notFound('Folder');
    return row;
  }

  /** Walks up from `parentId`; rejects cycles (moving a folder under itself) and deep nesting. */
  async function assertValidParent(projectId: string, kind: string, parentId: string | null, movingId?: string) {
    let current = parentId;
    let depth = 0;
    while (current) {
      if (current === movingId) throw badRequest('A folder cannot be moved inside itself');
      const parent = await load(projectId, current).catch(() => {
        throw badRequest('Parent folder does not exist in this project');
      });
      if (parent.kind !== kind) throw badRequest('Parent folder belongs to a different module');
      current = parent.parentId;
      if (++depth >= MAX_DEPTH) throw badRequest(`Folders can be nested at most ${MAX_DEPTH} levels deep`);
    }
  }

  router.get('/', async (req, res) => {
    const p = projectOf(req);
    const { kind } = parseQuery(folderQuery, req);
    const rows = await ctx.db
      .select({ id: folders.id, parentId: folders.parentId, name: folders.name, kind: folders.kind })
      .from(folders)
      .where(and(eq(folders.projectId, p.id), eq(folders.kind, kind)))
      .orderBy(folders.name);
    res.json({ items: rows });
  });

  router.post('/', requireProjectRole('tester'), async (req, res) => {
    const p = projectOf(req);
    const body = parseBody(createFolderSchema, req);
    await assertValidParent(p.id, body.kind, body.parentId);
    const [row] = await ctx.db.insert(folders).values({ ...body, projectId: p.id }).returning();
    await audit(ctx, req, 'folder.created', { entityType: 'folder', entityId: row?.id });
    res.status(201).json({ folder: row });
  });

  router.patch('/:folderId', requireProjectRole('tester'), async (req, res) => {
    const p = projectOf(req);
    const folderId = uuidParam(req, 'folderId', 'Folder');
    const body = parseBody(updateFolderSchema, req);
    const folder = await load(p.id, folderId);
    if (body.parentId !== undefined) await assertValidParent(p.id, folder.kind, body.parentId, folderId);
    const [row] = await ctx.db.update(folders).set(body).where(eq(folders.id, folderId)).returning();
    res.json({ folder: row });
  });

  router.delete('/:folderId', requireProjectRole('lead'), async (req, res) => {
    const p = projectOf(req);
    const folderId = uuidParam(req, 'folderId', 'Folder');
    await load(p.id, folderId);
    // Sub-folders cascade; requirements/test cases inside are kept and moved to the root.
    await ctx.db.delete(folders).where(eq(folders.id, folderId));
    await audit(ctx, req, 'folder.deleted', { entityType: 'folder', entityId: folderId });
    res.status(204).end();
  });

  return router;
}
