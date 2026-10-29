import { escapeLike, userLookupQuery } from '@ibutest/shared';
import { and, eq, ilike, or } from 'drizzle-orm';
import { Router } from 'express';
import type { AppContext } from '../../context.js';
import { projectMembers, users } from '../../db/schema.js';
import { forbidden } from '../../lib/errors.js';
import { parseQuery } from '../../lib/http.js';
import { authOf } from '../../middleware/auth.js';

export function usersRouter(ctx: AppContext) {
  const router = Router();

  /**
   * Directory lookup used when adding project members. Restricted to administrators and
   * project managers so ordinary users cannot enumerate every account in the system.
   */
  router.get('/lookup', async (req, res) => {
    const me = authOf(req);
    if (me.role !== 'admin') {
      const [membership] = await ctx.db
        .select({ role: projectMembers.role })
        .from(projectMembers)
        .where(and(eq(projectMembers.userId, me.userId), eq(projectMembers.role, 'manager')))
        .limit(1);
      if (!membership) throw forbidden('Only administrators and project managers can search users');
    }
    const { q } = parseQuery(userLookupQuery, req);
    const pattern = `%${escapeLike(q)}%`;
    const rows = await ctx.db
      .select({ id: users.id, name: users.name, email: users.email })
      .from(users)
      .where(and(eq(users.isActive, true), q ? or(ilike(users.name, pattern), ilike(users.email, pattern)) : undefined))
      .orderBy(users.name)
      .limit(20);
    res.json({ items: rows });
  });

  return router;
}
