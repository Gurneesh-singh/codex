import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import * as Linking from 'expo-linking';
import type { Session } from '@supabase/supabase-js';
import { Platform } from 'react-native';
import { accountApi, type Account } from '../services/accountApi';
import { handleAuthUrl } from '../services/auth';
import { supabase } from '../services/supabase';

type AuthState = {
  session: Session | null;
  account: Account | null;
  loading: boolean;
  error: string | null;
  recoveryMode: boolean;
  setRecoveryMode: (value: boolean) => void;
  refreshAccount: () => void;
};

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [account, setAccount] = useState<Account | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [accountLoading, setAccountLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [recoveryMode, setRecoveryMode] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    const client = supabase;
    if (!client) {
      setAuthLoading(false);
      return;
    }
    let active = true;
    const callbackUrl = Platform.OS === 'web' && typeof window !== 'undefined' ? window.location.href : null;
    const hasWebCallback = Boolean(callbackUrl && /[?&#](code|access_token|error_description|type)=/.test(callbackUrl));
    let webCallbackPending = hasWebCallback;
    const loadSession = () => {
      void client.auth.getSession().then(({ data, error: cause }) => {
        if (!active) return;
        if (cause) setError(cause.message);
        setSession(data.session);
        setAuthLoading(false);
      });
    };
    const { data: { subscription } } = client.auth.onAuthStateChange((event, nextSession) => {
      if (!active) return;
      if (webCallbackPending) return;
      if (event === 'PASSWORD_RECOVERY') setRecoveryMode(true);
      if (event === 'SIGNED_OUT') { setAccount(null); setError(null); }
      setSession(nextSession);
      setAuthLoading(false);
    });
    const onUrl = (url: string) => {
      if (!/[?&#](code|access_token|error_description|type)=/.test(url)) return;
      setAuthLoading(true);
      void handleAuthUrl(url).then(({ recovery }) => {
        if (active) {
          setError(null);
          if (recovery) setRecoveryMode(true);
        }
      }).catch((cause: unknown) => {
        if (active) setError(cause instanceof Error ? cause.message : 'Could not complete sign-in');
      }).finally(() => {
        if (Platform.OS === 'web' && typeof window !== 'undefined') {
          const cleanUrl = new URL(window.location.href);
          for (const key of ['code', 'access_token', 'refresh_token', 'expires_at', 'expires_in', 'token_type', 'type', 'error', 'error_description']) {
            cleanUrl.searchParams.delete(key);
          }
          cleanUrl.hash = '';
          window.history.replaceState(window.history.state, '', cleanUrl.pathname + cleanUrl.search);
          webCallbackPending = false;
          loadSession();
        } else if (active) setAuthLoading(false);
      });
    };
    const linkSubscription = Platform.OS !== 'web' ? Linking.addEventListener('url', ({ url }) => onUrl(url)) : null;
    if (Platform.OS === 'web' && callbackUrl && hasWebCallback) onUrl(callbackUrl);
    else loadSession();
    if (Platform.OS !== 'web') void Linking.getInitialURL().then((url) => { if (url && active) onUrl(url); });
    return () => {
      active = false;
      subscription.unsubscribe();
      linkSubscription?.remove();
    };
  }, []);

  useEffect(() => {
    if (!session) {
      setAccount(null);
      setAccountLoading(false);
      return;
    }
    let active = true;
    setAccountLoading(true);
    setError(null);
    void accountApi.me(session.access_token).then((result) => {
      if (active) setAccount(result);
    }).catch((cause: unknown) => {
      if (active) {
        setAccount(null);
        if (cause instanceof Error && cause.message === 'Your session expired. Please sign in again.') {
          setSession(null);
          setError(null);
        } else setError(cause instanceof Error ? cause.message : 'Could not load account');
      }
    }).finally(() => {
      if (active) setAccountLoading(false);
    });
    return () => { active = false; };
  }, [session?.access_token, refreshKey]);

  const value = useMemo<AuthState>(() => ({
    session, account, loading: authLoading || accountLoading, error, recoveryMode,
    setRecoveryMode, refreshAccount: () => setRefreshKey((key) => key + 1)
  }), [session, account, authLoading, accountLoading, error, recoveryMode]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) throw new Error('AuthProvider is missing');
  return value;
}
