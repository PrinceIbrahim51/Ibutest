import type { ZodError } from 'zod';

export class AppError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export const badRequest = (message = 'Bad request', details?: unknown) =>
  new AppError(400, 'BAD_REQUEST', message, details);
export const unauthorized = (message = 'Authentication required') => new AppError(401, 'UNAUTHORIZED', message);
export const forbidden = (message = 'You do not have permission to perform this action') =>
  new AppError(403, 'FORBIDDEN', message);
export const notFound = (what = 'Resource') => new AppError(404, 'NOT_FOUND', `${what} not found`);
export const conflict = (message: string, code = 'CONFLICT') => new AppError(409, code, message);
export const tooMany = (message = 'Too many requests, please try again later') =>
  new AppError(429, 'RATE_LIMITED', message);
export const serviceUnavailable = (message: string) => new AppError(503, 'SERVICE_UNAVAILABLE', message);

/** Converts zod issues into a safe, minimal shape (no regex patterns or internal values). */
export function validationError(error: ZodError): AppError {
  const details = error.issues.slice(0, 20).map((i) => ({ path: i.path.join('.'), message: i.message }));
  return new AppError(400, 'VALIDATION_ERROR', 'Invalid request', details);
}
