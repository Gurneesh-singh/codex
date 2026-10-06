import { Platform } from 'react-native';

export type ApiHealth = { status: 'ok'; service: string };
export type DatabaseHealth = { status: 'ok' | 'unavailable'; database: 'connected' | 'not_configured' | 'disconnected' };

const configuredApiUrl = process.env.EXPO_PUBLIC_API_URL?.trim() ?? '';
const localApiHost = /^http:\/\/(?:localhost|127\.0\.0\.1)(?=[:/]|$)/i;
const browserHost = Platform.OS === 'web' && typeof window !== 'undefined' ? window.location.hostname : '';
const androidUsbForwarding = process.env.EXPO_PUBLIC_ANDROID_USB_FORWARDING === 'true';
export const defaultApiUrl = Platform.OS === 'android' && !androidUsbForwarding
  ? configuredApiUrl.replace(localApiHost, 'http://10.0.2.2')
  : browserHost && browserHost !== 'localhost' && browserHost !== '127.0.0.1'
    ? configuredApiUrl.replace(localApiHost, `http://${browserHost}`)
    : configuredApiUrl;

async function getJson<T>(baseUrl: string, path: string): Promise<T> {
  let url: URL;
  try {
    url = new URL(path, `${baseUrl.replace(/\/$/, '')}/`);
    if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Unsupported protocol');
  } catch {
    throw new Error('Enter a valid API URL starting with http:// or https://');
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch(url.toString(), { signal: controller.signal, headers: { Accept: 'application/json' } });
    const body: unknown = await response.json();
    if (!response.ok) {
      if (path === '/api/health/db' && response.status === 503 && typeof body === 'object' && body !== null && 'database' in body) return body as T;
      throw new Error(`API returned ${response.status}`);
    }
    return body as T;
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') throw new Error('Connection timed out');
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

export async function checkApi(baseUrl: string) {
  const api = await getJson<ApiHealth>(baseUrl, '/api/health');
  if (api.status !== 'ok' || api.service !== 'bolovyapar-api') throw new Error('The URL responded, but it is not the BoloVyapar API');
  return api;
}

export function checkDatabase(baseUrl: string) {
  return getJson<DatabaseHealth>(baseUrl, '/api/health/db');
}
