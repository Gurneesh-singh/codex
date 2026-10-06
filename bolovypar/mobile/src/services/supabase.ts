import 'react-native-url-polyfill/auto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import * as SecureStore from 'expo-secure-store';
import { AppState, Platform } from 'react-native';

const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
const key = process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

export const supabase: SupabaseClient | null = url && key
  ? createClient(url, key, {
      auth: {
        storage: Platform.OS === 'web' ? globalThis.localStorage : {
          getItem: (storageKey: string) => SecureStore.getItemAsync(storageKey),
          setItem: (storageKey: string, value: string) => SecureStore.setItemAsync(storageKey, value),
          removeItem: (storageKey: string) => SecureStore.deleteItemAsync(storageKey)
        },
        flowType: 'pkce',
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: false
      }
    })
  : null;

export const isSupabaseConfigured = Boolean(supabase);

if (Platform.OS !== 'web' && supabase) {
  AppState.addEventListener('change', (state) => {
    if (state === 'active') supabase.auth.startAutoRefresh();
    else supabase.auth.stopAutoRefresh();
  });
}
