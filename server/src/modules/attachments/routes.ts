import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import {
  ATTACHMENT_ENTITY_TYPES,
  ATTACHMENT_MAX_BYTES,
  ATTACHMENT_MIME_TYPES,
  attachmentQuery,
  cleanText,
  hasProjectRole,
  type AttachmentEntityType,
} from '@ibutest/shared';
import { and, eq } from 'drizzle-orm';
import { Router } from 'express';
import { fileTypeFromBuffer } from 'file-type';
import multer from 'multer';
import type { AppContext } from '../../context.js';
import { attachments, defects, requirements, testCases, testRuns, users } from '../../db/schema.js';
import { audit } from '../../lib/audit.js';
import { badRequest, forbidden, notFound } from '../../lib/errors.js';
import { parseQuery, uuidParam } from '../../lib/http.js';
import { authOf } from '../../middleware/auth.js';
import { projectOf, requireProjectRole } from '../../middleware/project.js';
import type { RateLimiters } from '../../middleware/rateLimit.js';

const ALLOWED = new Set<string>(ATTACHMENT_MIME_TYPES);
const TEXT_TYPES: Record<string, string> = { '.txt': 'text/plain', '.log': 'text/plain', '.csv': 'text/csv', '.json': 'application/json' };

/** Determines the real content type from the bytes (never trusting the client's Content-Type). */
async function detectType(buffer: Buffer, originalName: string): Promise<string | null> {
  const sniffed = await fileTypeFromBuffer(buffer);
  if (sniffed) return ALLOWED.has(sniffed.mime) ? sniffed.mime : null;
  // No magic number: accept only well-formed UTF-8 text without NUL bytes, by extension.
  const ext = path.extname(originalName).toLowerCase();
  const textType = TEXT_TYPES[ext];
  if (!textType || buffer.includes(0)) return null;
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(buffer);
  } catch {
    return null;
  }
  return textType;
}

function safeFileName(name: string): string {
  const base = cleanText(path.basename(name)).replace(/[\\/:*?"<>|]/g, '_').trim();
  return (base || 'file').slice(0, 200);
}

export function attachmentsRouter(ctx: AppContext, limiters: RateLimiters) {
  const router = Router({ mergeParams: true });
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: ATTACHMENT_MAX_BYTES, files: 1, fields: 4, fieldSize: 256, parts: 6, headerPairs: 50 },
  });

  const entityTable = {
    requirement: requirements,
    test_case: testCases,
    test_run: testRuns,
    defect: defects,
  } as const;

  async function assertEntity(projectId: string, type: AttachmentEntityType, id: string) {
    const table = entityTable[type];
    const [row] = await ctx.db
      .select({ id: table.id })
      .from(table)
      .where(and(eq(table.id, id), eq(table.projectId, projectId)))
      .limit(1);
    if (!row) throw badRequest('The item to attach to does not exist in this project');
  }

  async function load(projectId: string, id: string) {
    const [row] = await ctx.db
      .select()
      .from(attachments)
      .where(and(eq(attachments.id, id), eq(attachments.projectId, projectId)))
      .limit(1);
    if (!row) throw notFound('Attachment');
    return row;
  }

  const fileOnDisk = (projectId: string, storedName: string) => {
    const dir = path.join(ctx.config.uploadDir, projectId);
    const full = path.join(dir, storedName);
    // storedName is a server generated UUID, but double-check against path traversal anyway.
    if (!full.startsWith(dir + path.sep)) throw notFound('Attachment');
    return { dir, full };
  };

  router.get('/', async (req, res) => {
    const p = projectOf(req);
    const q = parseQuery(attachmentQuery, req);
    const rows = await ctx.db
      .select({
        id: attachments.id,
        fileName: attachments.fileName,
        mimeType: attachments.mimeType,
        sizeBytes: attachments.sizeBytes,
        createdAt: attachments.createdAt,
        uploadedBy: attachments.uploadedBy,
        uploadedByName: users.name,
      })
      .from(attachments)
      .leftJoin(users, eq(users.id, attachments.uploadedBy))
      .where(and(eq(attachments.projectId, p.id), eq(attachments.entityType, q.entityType), eq(attachments.entityId, q.entityId)))
      .orderBy(attachments.createdAt);
    res.json({ items: rows });
  });

  router.post('/', requireProjectRole('tester'), limiters.upload, upload.single('file'), async (req, res) => {
    const p = projectOf(req);
    const me = authOf(req);
    const entityType = String(req.body?.entityType ?? '') as AttachmentEntityType;
    const entityId = String(req.body?.entityId ?? '');
    const parsed = attachmentQuery.safeParse({ entityType, entityId });
    if (!parsed.success || !ATTACHMENT_ENTITY_TYPES.includes(entityType)) throw badRequest('Invalid attachment target');
    if (!req.file) throw badRequest('No file uploaded');
    await assertEntity(p.id, parsed.data.entityType, parsed.data.entityId);

    const mimeType = await detectType(req.file.buffer, req.file.originalname);
    if (!mimeType) throw badRequest('This file type is not allowed');

    const storedName = randomUUID();
    const { dir, full } = fileOnDisk(p.id, storedName);
    await fs.mkdir(dir, { recursive: true, mode: 0o700 });
    await fs.writeFile(full, req.file.buffer, { mode: 0o600, flag: 'wx' });
    const [row] = await ctx.db
      .insert(attachments)
      .values({
        projectId: p.id,
        entityType: parsed.data.entityType,
        entityId: parsed.data.entityId,
        fileName: safeFileName(req.file.originalname),
        storedName,
        mimeType,
        sizeBytes: req.file.size,
        sha256: createHash('sha256').update(req.file.buffer).digest('hex'),
        uploadedBy: me.userId,
      })
      .returning();
    await audit(ctx, req, 'attachment.uploaded', {
      entityType: parsed.data.entityType,
      entityId: parsed.data.entityId,
      details: { attachmentId: row?.id, mimeType, size: req.file.size },
    });
    res.status(201).json({ attachment: { id: row?.id, fileName: row?.fileName, mimeType, sizeBytes: row?.sizeBytes } });
  });

  router.get('/:attachmentId/download', async (req, res) => {
    const p = projectOf(req);
    const row = await load(p.id, uuidParam(req, 'attachmentId', 'Attachment'));
    const { full } = fileOnDisk(p.id, row.storedName);
    const data = await fs.readFile(full).catch(() => {
      throw notFound('Attachment');
    });
    const inline = req.query.inline === '1' && row.mimeType.startsWith('image/');
    const encoded = encodeURIComponent(row.fileName);
    res.setHeader('Content-Type', ALLOWED.has(row.mimeType) ? row.mimeType : 'application/octet-stream');
    res.setHeader('Content-Length', String(data.length));
    res.setHeader(
      'Content-Disposition',
      `${inline ? 'inline' : 'attachment'}; filename="${encoded.replace(/%[0-9A-F]{2}/g, '_')}"; filename*=UTF-8''${encoded}`,
    );
    // Even if a browser renders the file, it runs in a sandbox with no script execution.
    res.setHeader('Content-Security-Policy', "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox");
    res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
    res.send(data);
  });

  router.delete('/:attachmentId', requireProjectRole('tester'), async (req, res) => {
    const p = projectOf(req);
    const me = authOf(req);
    const row = await load(p.id, uuidParam(req, 'attachmentId', 'Attachment'));
    if (row.uploadedBy !== me.userId && !hasProjectRole(p.role, 'lead')) {
      throw forbidden('Only the uploader or a project lead can delete this attachment');
    }
    await ctx.db.delete(attachments).where(eq(attachments.id, row.id));
    await fs.rm(fileOnDisk(p.id, row.storedName).full, { force: true });
    await audit(ctx, req, 'attachment.deleted', { entityType: row.entityType, entityId: row.entityId, details: { attachmentId: row.id } });
    res.status(204).end();
  });

  return router;
}
