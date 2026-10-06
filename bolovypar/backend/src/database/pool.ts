import { readFileSync } from 'node:fs';
import pg from 'pg';
import { env } from '../config/env.js';

const supabaseCa = env.DATABASE_SSL === 'true'
  ? readFileSync(new URL('../../certs/supabase-root-2021.crt', import.meta.url), 'utf8')
  : undefined;

export const pool = env.DATABASE_URL
  ? new pg.Pool({
      connectionString: env.DATABASE_URL,
      ssl: supabaseCa ? { ca: supabaseCa, rejectUnauthorized: true } : false,
      max: 5,
      connectionTimeoutMillis: 15000,
      idleTimeoutMillis: 30000
    })
  : null;

export async function checkDatabase(): Promise<'connected' | 'not_configured'> {
  if (!pool) return 'not_configured';
  await pool.query('select 1');
  return 'connected';
}
