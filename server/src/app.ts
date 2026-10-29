import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import cookieParser from 'cookie-parser';
import express, { type NextFunction, type Request, type Response } from 'express';
import { pinoHttp } from 'pino-http';
import type { AppContext } from './context.js';
import { authenticate } from './middleware/auth.js';
import { apiNotFound, errorHandler } from './middleware/errors.js';
import { createRateLimiters } from './middleware/rateLimit.js';
import { corsPolicy, noStore, securityHeaders } from './middleware/security.js';
import { adminRouter } from './modules/admin/routes.js';
import { authRouter } from './modules/auth/routes.js';
import { automationRouter } from './modules/automation/routes.js';
import { projectsRouter } from './modules/projects/routes.js';
import { usersRouter } from './modules/users/routes.js';

export function createApp(ctx: AppContext) {
  const { config, logger } = ctx;
  const app = express();
  const limiters = createRateLimiters(config);

  app.disable('x-powered-by');
  app.set('trust proxy', config.trustProxy);
  app.set('etag', false);
  app.set('query parser', 'simple');

  app.use(
    pinoHttp({
      logger,
      genReqId: (_req, res) => {
        const id = randomUUID();
        res.setHeader('X-Request-Id', id);
        return id;
      },
      // Only log metadata; never request bodies.
      serializers: {
        req: (req: { id: string; method: string; url: string }) => ({ id: req.id, method: req.method, url: req.url.split('?')[0] }),
        res: (res: { statusCode: number }) => ({ statusCode: res.statusCode }),
      },
      autoLogging: { ignore: (req) => req.url === '/api/health' },
    }),
  );
  app.use(securityHeaders(config));

  // ------------------------------------------------------------------ API
  const api = express.Router();
  api.use(corsPolicy(config));
  api.use(noStore);
  api.use(limiters.api);
  api.use(cookieParser());

  api.get('/health', (_req, res) => {
    res.json({ status: 'ok' });
  });

  // Automation endpoints accept larger payloads (bulk results); everything else is capped at 1 MB.
  api.use('/automation', express.json({ limit: '5mb', strict: true }), automationRouter(ctx, limiters));
  api.use(express.json({ limit: '1mb', strict: true }));

  api.use('/auth', authRouter(ctx, limiters));
  api.use('/admin', authenticate(ctx), adminRouter(ctx));
  api.use('/users', authenticate(ctx), usersRouter(ctx));
  api.use('/projects', authenticate(ctx), projectsRouter(ctx, limiters));
  api.use(apiNotFound);

  app.use('/api', api);

  app.get('/.well-known/security.txt', (_req, res) => {
    res.type('text/plain').send(
      [
        `Contact: ${config.publicUrl ? new URL('/security', config.publicUrl).toString() : 'mailto:security@example.invalid'}`,
        `Expires: ${new Date(Date.now() + 180 * 24 * 3600 * 1000).toISOString()}`,
        'Preferred-Languages: en',
        '',
      ].join('\n'),
    );
  });

  // ------------------------------------------------------------------ Web client (SPA)
  const clientDir = config.clientDistDir ? path.resolve(config.clientDistDir) : null;
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- path from server config
  if (clientDir && fs.existsSync(path.join(clientDir, 'index.html'))) {
    const indexHtml = path.join(clientDir, 'index.html');
    app.use(
      '/assets',
      express.static(path.join(clientDir, 'assets'), {
        dotfiles: 'ignore',
        index: false,
        immutable: true,
        maxAge: '365d',
        fallthrough: false,
      }),
    );
    app.use(
      express.static(clientDir, {
        dotfiles: 'ignore',
        index: false,
        redirect: false,
        setHeaders: (res, filePath) => {
          // The service worker and manifest must always be revalidated.
          if (/\b(sw\.js|manifest\.webmanifest)$/.test(filePath)) res.setHeader('Cache-Control', 'no-cache');
        },
      }),
    );
    // SPA fallback: only extension-less paths outside /api (so /.env, /x/.git etc. are plain 404s).
    app.get(/^\/(?!api(?:\/|$))[^.]*$/, (req: Request, res: Response, next: NextFunction) => {
      if (!req.accepts('html')) return next();
      res.setHeader('Cache-Control', 'no-cache');
      res.sendFile(indexHtml);
    });
  }

  app.use((_req: Request, res: Response) => {
    res.status(404).type('text/plain').send('Not found');
  });
  app.use(errorHandler(logger));
  return app;
}
