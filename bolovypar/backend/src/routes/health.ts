import { Router } from 'express';
import { databaseHealth, serviceHealth } from '../controllers/healthController.js';

export const healthRouter = Router();

healthRouter.get('/', serviceHealth);
healthRouter.get('/db', databaseHealth);
