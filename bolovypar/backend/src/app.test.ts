import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import type { Server } from 'node:http';
import { app } from './app.js';
import { env } from './config/env.js';
import { pool } from './database/pool.js';

let server: Server;
let baseUrl: string;

before(async () => {
  server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Missing test server address');
  baseUrl = `http://127.0.0.1:${address.port}`;
});

after(async () => {
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
});

test('health route responds with service status', async () => {
  const response = await fetch(`${baseUrl}/api/health`);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { status: 'ok', service: 'bolovyapar-api' });
});

test('unknown routes use a structured 404', async () => {
  const response = await fetch(`${baseUrl}/api/missing`);
  assert.equal(response.status, 404);
  assert.deepEqual(await response.json(), { error: { code: 'NOT_FOUND', message: 'Route not found' } });
});

test('account routes require a verified bearer session', async () => {
  const response = await fetch(`${baseUrl}/api/account/me`);
  assert.equal(response.status, env.SUPABASE_URL && env.SUPABASE_PUBLISHABLE_KEY ? 401 : 503);
  const body = await response.json() as { error: { code: string } };
  assert.equal(body.error.code, env.SUPABASE_URL && env.SUPABASE_PUBLISHABLE_KEY ? 'UNAUTHORIZED' : 'AUTH_NOT_CONFIGURED');
});

test('database health reports missing configuration', { skip: Boolean(pool) }, async () => {
  const response = await fetch(`${baseUrl}/api/health/db`);
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { status: 'unavailable', database: 'not_configured' });
});

test('local web app can read the API in development', { skip: env.NODE_ENV !== 'development' || Boolean(env.CORS_ORIGIN) }, async () => {
  const response = await fetch(`${baseUrl}/api/health`, { headers: { Origin: 'http://localhost:8081' } });
  assert.equal(response.headers.get('access-control-allow-origin'), 'http://localhost:8081');
});
