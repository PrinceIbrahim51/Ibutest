import { hasProjectRole, type ProjectRole } from '@ibutest/shared';
import { and, eq } from 'drizzle-orm';
import type { NextFunction, Request, Response } from 'express';
import type { AppContext } from '../context.js';
import { projectMembers, projects } from '../db/schema.js';
import { conflict, forbidden, notFound, unauthorized } from '../lib/errors.js';
import { uuidParam } from '../lib/http.js';

/**
 * Resolves :projectId and the caller's role in it. Non-members get 404 (not 403) so the
 * existence of other projects is not disclosed. Global admins act as project managers.
 */
export function loadProject(ctx: AppContext) {
  return async (req: Request, _res: Response, next: NextFunction) => {
    if (!req.auth) throw unauthorized();
    const projectId = uuidParam(req, 'projectId', 'Project');
    const [row] = await ctx.db
      .select({
        id: projects.id,
        key: projects.key,
        name: projects.name,
        isArchived: projects.isArchived,
        aiEnabled: projects.aiEnabled,
        memberRole: projectMembers.role,
      })
      .from(projects)
      .leftJoin(projectMembers, and(eq(projectMembers.projectId, projects.id), eq(projectMembers.userId, req.auth.userId)))
      .where(eq(projects.id, projectId))
      .limit(1);

    const role: ProjectRole | null = req.auth.role === 'admin' ? 'manager' : (row?.memberRole ?? null);
    if (!row || !role) throw notFound('Project');
    req.project = { id: row.id, key: row.key, name: row.name, isArchived: row.isArchived, aiEnabled: row.aiEnabled, role };
    next();
  };
}

export function requireProjectRole(min: ProjectRole) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.project) throw notFound('Project');
    if (!hasProjectRole(req.project.role, min)) throw forbidden(`This action requires the "${min}" role in this project`);
    next();
  };
}

/** Archived projects are read-only. */
export function denyWritesWhenArchived(req: Request, _res: Response, next: NextFunction) {
  if (req.project?.isArchived && !['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
    throw conflict('This project is archived and read-only', 'PROJECT_ARCHIVED');
  }
  next();
}

/** Narrow helpers for handlers that run after loadProject/authenticate. */
export function projectOf(req: Request) {
  if (!req.project) throw notFound('Project');
  return req.project;
}
