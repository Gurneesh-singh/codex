import type { Request, Response } from 'express';
import { logger } from '../config/logger.js';
import { getDatabaseHealth, getServiceHealth } from '../services/healthService.js';

export function serviceHealth(_request: Request, response: Response) {
  response.json(getServiceHealth());
}

export async function databaseHealth(_request: Request, response: Response) {
  try {
    const result = await getDatabaseHealth();
    response.status(result.status === 'ok' ? 200 : 503).json(result);
  } catch (error) {
    logger.error({ err: error }, 'Database health check failed');
    response.status(503).json({ status: 'unavailable', database: 'disconnected' });
  }
}
