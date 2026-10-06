import { supabase } from './supabase';

let refreshPending: Promise<string | null> | null = null;

function refreshAccessToken(): Promise<string | null> {
  if (!supabase) return Promise.resolve(null);
  if (!refreshPending) {
    refreshPending = supabase.auth.refreshSession()
      .then(({ data, error }) => error ? null : (data.session?.access_token ?? null))
      .catch(() => null)
      .finally(() => { refreshPending = null; });
  }
  return refreshPending;
}

export async function authenticatedFetch(token: string, input: string, init: RequestInit = {}): Promise<Response> {
  const send = (accessToken: string) => {
    const headers = new Headers(init.headers);
    headers.set('Authorization', `Bearer ${accessToken}`);
    return fetch(input, { ...init, headers });
  };
  const response = await send(token);
  if (response.status !== 401) return response;

  const refreshedToken = await refreshAccessToken();
  if (refreshedToken) {
    const retried = await send(refreshedToken);
    if (retried.status !== 401) return retried;
  }

  // The saved session can no longer authenticate; return to the sign-in screen.
  await supabase?.auth.signOut({ scope: 'local' });
  throw new Error('Your session expired. Please sign in again.');
}
