import cors from 'cors';
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import helmet from 'helmet';
import type { Config } from '../config/env.js';

/**
 * Strict security headers. The web client is a static Vite build with no inline scripts
 * or styles, so the Content-Security-Policy can forbid inline code entirely.
 */
export function securityHeaders(config: Config): RequestHandler[] {
  const httpsDeployment = config.publicUrl?.startsWith('https://') ?? false;
  return [
    helmet({
      contentSecurityPolicy: {
        useDefaults: false,
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'"],
          imgSrc: ["'self'", 'data:', 'blob:'],
          fontSrc: ["'self'"],
          connectSrc: ["'self'"],
          mediaSrc: ["'self'", 'blob:'],
          workerSrc: ["'self'"],
          manifestSrc: ["'self'"],
          objectSrc: ["'none'"],
          frameSrc: ["'none'"],
          frameAncestors: ["'none'"],
          baseUri: ["'self'"],
          formAction: ["'self'"],
          ...(httpsDeployment ? { upgradeInsecureRequests: [] } : {}),
        },
      },
      crossOriginOpenerPolicy: { policy: 'same-origin' },
      crossOriginResourcePolicy: { policy: 'same-origin' },
      referrerPolicy: { policy: 'no-referrer' },
      strictTransportSecurity: httpsDeployment ? { maxAge: 63072000, includeSubDomains: true } : false,
      xFrameOptions: { action: 'deny' },
      xPoweredBy: false,
    }),
    (_req: Request, res: Response, next: NextFunction) => {
      res.setHeader(
        'Permissions-Policy',
        'camera=(), microphone=(), geolocation=(), payment=(), usb=(), serial=(), bluetooth=(), interest-cohort=()',
      );
      next();
    },
  ];
}

/** API responses contain private data: never let browsers or proxies cache them. */
export function noStore(_req: Request, res: Response, next: NextFunction) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Pragma', 'no-cache');
  next();
}

export function isAllowedOrigin(config: Config, origin: string, req?: Request): boolean {
  if (config.corsOrigins.includes(origin)) return true;
  if (!req) return false;
  try {
    // Same-origin requests (browser sends Origin on POST even when same-origin).
    return new URL(origin).host === req.get('host');
  } catch {
    return false;
  }
}

/** CORS with an explicit allow-list. Unknown origins get no CORS headers at all. */
export function corsPolicy(config: Config): RequestHandler {
  return cors({
    origin(origin, callback) {
      if (!origin) return callback(null, true);
      callback(null, config.corsOrigins.includes(origin));
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'X-Setup-Token'],
    exposedHeaders: ['X-Request-Id', 'Content-Disposition', 'RateLimit', 'RateLimit-Policy', 'Retry-After'],
    maxAge: 600,
  });
}
