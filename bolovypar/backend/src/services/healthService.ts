import { checkDatabase } from '../database/pool.js';

export function getServiceHealth() {
  return { status: 'ok' as const, service: 'bolovyapar-api' };
}

export async function getDatabaseHealth() {
  const database = await checkDatabase();
  return {
    status: database === 'connected' ? 'ok' as const : 'unavailable' as const,
    database
  };
}
