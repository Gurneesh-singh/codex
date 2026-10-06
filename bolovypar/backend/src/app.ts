import cors from 'cors';
import express, { type ErrorRequestHandler } from 'express';
import helmet from 'helmet';
import { pinoHttp } from 'pino-http';
import { env } from './config/env.js';
import { logger } from './config/logger.js';
import { healthRouter } from './routes/health.js';
import { accountRouter } from './routes/account.js';

export const app = express();

app.disable('x-powered-by');
app.use(helmet());
app.use(pinoHttp({ logger }));
const corsOrigin = env.CORS_ORIGIN?.split(',').map((origin) => origin.trim())
  ?? (env.NODE_ENV === 'development' ? /^http:\/\/(localhost|127\.0\.0\.1):8081$/ : undefined);
if (corsOrigin) app.use(cors({ origin: corsOrigin }));
app.use(express.json({ limit: '1mb' }));
app.use('/api/health', healthRouter);
app.use('/api/account', accountRouter);

app.use((_request, response) => {
  response.status(404).json({ error: { code: 'NOT_FOUND', message: 'Route not found' } });
});

const errorHandler: ErrorRequestHandler = (error: unknown, _request, response, _next) => {
  logger.error({ err: error }, 'Request failed');
  if (response.headersSent) return;
  response.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } });
};

app.use(errorHandler);
