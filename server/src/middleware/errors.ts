import type { NextFunction, Request, Response } from 'express';
import multer from 'multer';
import type { Logger } from '../lib/logger.js';
import { AppError, notFound } from '../lib/errors.js';

interface PgLikeError {
  code?: string;
  cause?: { code?: string };
}

function pgCode(err: unknown): string | undefined {
  const e = err as PgLikeError;
  return e?.cause?.code ?? e?.code;
}

export function apiNotFound(_req: Request, _res: Response, next: NextFunction) {
  next(notFound('Endpoint'));
}

/**
 * Central error handler. Clients only ever receive a stable error code and a safe message;
 * stack traces, SQL and internal details are logged server-side with the request id.
 */
export function errorHandler(logger: Logger) {
  return (err: unknown, req: Request, res: Response, _next: NextFunction) => {
    const requestId = String(req.id ?? '');
    const send = (status: number, code: string, message: string, details?: unknown) =>
      res.status(status).json({ error: { code, message, ...(details ? { details } : {}) }, requestId });

    if (err instanceof AppError) {
      if (err.status >= 500) logger.error({ err, requestId }, err.message);
      return send(err.status, err.code, err.message, err.details);
    }

    const httpErr = err as { type?: string; status?: number };
    if (httpErr?.type === 'entity.too.large') return send(413, 'PAYLOAD_TOO_LARGE', 'Request body is too large');
    if (httpErr?.type === 'entity.parse.failed') return send(400, 'INVALID_JSON', 'Request body is not valid JSON');
    if (httpErr?.type === 'charset.unsupported' || httpErr?.type === 'encoding.unsupported') {
      return send(415, 'UNSUPPORTED_ENCODING', 'Unsupported request encoding');
    }
    // Client errors raised by Express internals (e.g. static file 404s for dotfiles).
    if (typeof httpErr?.status === 'number' && httpErr.status >= 400 && httpErr.status < 500) {
      return httpErr.status === 404
        ? send(404, 'NOT_FOUND', 'Not found')
        : send(httpErr.status, 'BAD_REQUEST', 'Bad request');
    }
    if (err instanceof multer.MulterError) {
      return err.code === 'LIMIT_FILE_SIZE'
        ? send(413, 'FILE_TOO_LARGE', 'File is too large')
        : send(400, 'UPLOAD_ERROR', 'Invalid file upload');
    }

    switch (pgCode(err)) {
      case '23505':
        return send(409, 'ALREADY_EXISTS', 'An item with the same unique value already exists');
      case '23503':
        return send(400, 'INVALID_REFERENCE', 'A referenced item does not exist');
      case '22P02':
      case '22007':
      case '22008':
        return send(400, 'INVALID_VALUE', 'Invalid value in request');
      default:
        break;
    }

    logger.error({ err, requestId }, 'unhandled error');
    return send(500, 'INTERNAL_ERROR', 'An unexpected error occurred');
  };
}
