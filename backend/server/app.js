import express from 'express';
import { createAuthRouter } from './auth/router.js';
import { createNatyashalaRouter } from './natyashala/router.js';

export function createApp(database, options = {}) {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '100kb' }));
  app.use('/api/natyashala/auth', createAuthRouter(database, options.auth));
  app.use('/api/natyashala', createNatyashalaRouter(database, options.inquiries));

  app.get('/api/health', (_req, res) => res.json({ status: 'ok' }));
  app.get('/api/health/db', async (_req, res) => {
    try {
      await database.query('SELECT 1 AS connected');
      res.json({ status: 'ok', database: 'connected' });
    } catch {
      res.status(503).json({ status: 'error', message: 'Database unavailable' });
    }
  });

  app.use((_req, res) => res.status(404).json({ message: 'Route not found' }));
  app.use((error, _req, res, _next) => {
    const status = error.type === 'entity.parse.failed' ? 400
      : error.type === 'entity.too.large' ? 413 : 500;
    res.status(status).json({ message: status === 400 ? 'Invalid JSON'
      : status === 413 ? 'Request body too large' : 'Internal server error' });
  });
  return app;
}
