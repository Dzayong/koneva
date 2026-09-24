import express, { type ErrorRequestHandler } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import config from '../shared/config';
import pool from '../shared/database/connection';
import { getRedisClient } from '../shared/redis';
import logger from '../shared/utils/logger';
import { adminAuth, tenantAuth } from './middleware/auth';
import adminRoutes from './routes/admin.routes';
import deviceRoutes from './routes/device.routes';
import messageRoutes from './routes/message.routes';
import { ServiceError } from './services/message.service';

const app = express();
app.disable('x-powered-by');
app.use(helmet());
app.use(cors());
app.use(express.json({ limit: '1mb' }));
app.use(rateLimit({ windowMs: 60_000, limit: 120, standardHeaders: 'draft-8', legacyHeaders: false }));
app.use((request, response, next) => {
  const started = Date.now();
  response.on('finish', () => logger.info('HTTP request', {
    method: request.method, path: request.path, status: response.statusCode,
    duration: Date.now() - started,
  }));
  next();
});

app.get('/health', (_request, response) => response.json({ status: 'ok' }));
app.get('/ready', async (_request, response) => {
  try {
    await Promise.all([
      pool.query('SELECT 1'),
      getRedisClient(config.redis.url).ping(),
    ]);
    response.json({ status: 'ready' });
  } catch (error) {
    logger.warn('Readiness check failed', { error });
    response.status(503).json({ status: 'not_ready' });
  }
});
app.use('/api/v1', tenantAuth, messageRoutes, deviceRoutes);
app.use('/admin', adminAuth, adminRoutes);
app.use((_request, response) => response.status(404).json({
  success: false, error: { code: 'NOT_FOUND', message: 'Route not found' },
}));

const errorHandler: ErrorRequestHandler = (error, _request, response, _next) => {
  logger.error('Request failed', { error });
  if (error instanceof ServiceError) {
    response.status(error.status).json({ success: false, error: { code: error.code, message: error.message } });
    return;
  }
  response.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } });
};
app.use(errorHandler);

const server = app.listen(config.port, () => logger.info(`API Gateway listening on port ${config.port}`));

function shutdown(): void {
  server.close(() => process.exit(0));
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

export default app;
