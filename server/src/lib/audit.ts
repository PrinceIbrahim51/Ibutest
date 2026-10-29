import type { Request } from 'express';
import type { AppContext } from '../context.js';
import { auditLogs } from '../db/schema.js';
import { clientIp, userAgent } from './http.js';

interface AuditEntry {
  entityType?: string;
  entityId?: string;
  projectId?: string | null;
  details?: Record<string, unknown>;
  actor?: { id: string; email: string } | null;
}

/** Writes an audit record. Failures are logged but never break the user's request. */
export async function audit(ctx: AppContext, req: Request, action: string, entry: AuditEntry = {}): Promise<void> {
  const actor = entry.actor === undefined ? (req.auth ? { id: req.auth.userId, email: req.auth.email } : null) : entry.actor;
  try {
    await ctx.db.insert(auditLogs).values({
      action,
      actorId: actor?.id ?? null,
      actorEmail: actor?.email ?? null,
      entityType: entry.entityType ?? null,
      entityId: entry.entityId ?? null,
      projectId: entry.projectId ?? req.project?.id ?? null,
      ip: clientIp(req),
      userAgent: userAgent(req),
      details: entry.details ?? {},
    });
  } catch (err) {
    ctx.logger.error({ err, action }, 'failed to write audit log');
  }
}
