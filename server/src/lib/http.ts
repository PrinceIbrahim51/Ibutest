import type { Request } from 'express';
import type { z } from 'zod';
import { notFound, validationError } from './errors.js';

export function parseBody<S extends z.ZodType>(schema: S, req: Request): z.output<S> {
  const result = schema.safeParse(req.body ?? {});
  if (!result.success) throw validationError(result.error);
  return result.data;
}

export function parseQuery<S extends z.ZodType>(schema: S, req: Request): z.output<S> {
  const result = schema.safeParse(req.query ?? {});
  if (!result.success) throw validationError(result.error);
  return result.data;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Reads a UUID route parameter. Malformed IDs are reported as "not found" (never a DB error). */
export function uuidParam(req: Request, name: string, what = 'Resource'): string {
  const value = req.params[name];
  if (typeof value !== 'string' || !UUID_RE.test(value)) throw notFound(what);
  return value.toLowerCase();
}

export function clientIp(req: Request): string {
  return (req.ip ?? req.socket.remoteAddress ?? 'unknown').slice(0, 64);
}

export function userAgent(req: Request): string {
  return (req.get('user-agent') ?? '').slice(0, 512);
}

export function pageResult<T>(items: T[], total: number, page: number, pageSize: number) {
  return { items, total, page, pageSize, totalPages: Math.max(1, Math.ceil(total / pageSize)) };
}
