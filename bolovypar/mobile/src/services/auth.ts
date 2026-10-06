import { makeRedirectUri } from 'expo-auth-session';
import * as WebBrowser from 'expo-web-browser';
import { Platform } from 'react-native';
import { supabase } from './supabase';

WebBrowser.maybeCompleteAuthSession();

export const authRedirectUri = Platform.OS === 'web' && typeof window !== 'undefined'
  ? window.location.origin
  : makeRedirectUri({ scheme: 'bolovyapar', path: 'auth/callback' });

let lastCallbackUrl: string | null = null;
let lastCallbackResult: Promise<{ recovery: boolean }> | null = null;

function requireClient() {
  if (!supabase) throw new Error('Supabase is not configured');
  return supabase;
}

export function handleAuthUrl(url: string): Promise<{ recovery: boolean }> {
  if (url === lastCallbackUrl && lastCallbackResult) return lastCallbackResult;
  lastCallbackUrl = url;
  lastCallbackResult = completeAuthUrl(url);
  return lastCallbackResult;
}

async function completeAuthUrl(url: string): Promise<{ recovery: boolean }> {
  const client = requireClient();
  const parsed = new URL(url);
  const hash = new URLSearchParams(parsed.hash.replace(/^#/, ''));
  const error = parsed.searchParams.get('error_description') ?? hash.get('error_description');
  if (error) throw new Error(error);
  const code = parsed.searchParams.get('code') ?? hash.get('code');
  const accessToken = parsed.searchParams.get('access_token') ?? hash.get('access_token');
  const refreshToken = parsed.searchParams.get('refresh_token') ?? hash.get('refresh_token');
  const recovery = (parsed.searchParams.get('type') ?? hash.get('type')) === 'recovery';
  if (code) {
    const result = await client.auth.exchangeCodeForSession(code);
    if (result.error) throw result.error;
  } else if (accessToken && refreshToken) {
    const result = await client.auth.setSession({ access_token: accessToken, refresh_token: refreshToken });
    if (result.error) throw result.error;
  }
  return { recovery };
}

export async function signInWithGoogle(linkExisting = false) {
  const client = requireClient();
  if (Platform.OS === 'web') {
    const result = linkExisting
      ? await client.auth.linkIdentity({ provider: 'google', options: { redirectTo: authRedirectUri } })
      : await client.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: authRedirectUri } });
    if (result.error) throw result.error;
    if (linkExisting && result.data?.url && typeof window !== 'undefined') window.location.assign(result.data.url);
    return;
  }
  const result = linkExisting
    ? await client.auth.linkIdentity({ provider: 'google', options: { redirectTo: authRedirectUri, skipBrowserRedirect: true } })
    : await client.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: authRedirectUri, skipBrowserRedirect: true } });
  if (result.error) throw result.error;
  if (!result.data?.url) throw new Error('Google sign-in URL was not returned');
  const browser = await WebBrowser.openAuthSessionAsync(result.data.url, authRedirectUri);
  if (browser.type === 'success') await handleAuthUrl(browser.url);
}

export async function signUp(email: string, password: string, displayName: string) {
  const result = await requireClient().auth.signUp({
    email, password,
    options: { emailRedirectTo: authRedirectUri, data: { full_name: displayName.trim() } }
  });
  if (result.error) throw result.error;
  return result.data;
}

export async function signIn(email: string, password: string) {
  const result = await requireClient().auth.signInWithPassword({ email, password });
  if (result.error) throw result.error;
  return result.data;
}

export async function sendPasswordReset(email: string) {
  const result = await requireClient().auth.resetPasswordForEmail(email, { redirectTo: authRedirectUri });
  if (result.error) throw result.error;
}

export async function updatePassword(password: string) {
  const result = await requireClient().auth.updateUser({ password });
  if (result.error) throw result.error;
}

export async function signOut() {
  const result = await requireClient().auth.signOut();
  if (result.error) throw result.error;
}
