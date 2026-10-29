import pino from 'pino';

export type Logger = pino.Logger;

/** Structured JSON logger. Credentials, cookies and tokens are always redacted. */
export function createLogger(level: string): Logger {
  return pino({
    level,
    base: { service: 'ibutest' },
    redact: {
      paths: [
        'req.headers.authorization',
        'req.headers.cookie',
        'req.headers["x-setup-token"]',
        'res.headers["set-cookie"]',
        '*.password',
        '*.newPassword',
        '*.currentPassword',
        '*.token',
        '*.accessToken',
        '*.refreshToken',
        '*.apiKey',
        '*.secret',
      ],
      censor: '[REDACTED]',
    },
    timestamp: pino.stdTimeFunctions.isoTime,
  });
}
