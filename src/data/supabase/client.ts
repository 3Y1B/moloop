import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { AppState, Platform } from 'react-native';

import type { Database } from '@/lib/database.types';

let client: SupabaseClient<Database> | undefined;

/**
 * The app's Supabase client (Expo's Supabase guide, SDK 57): the session persists on the device through
 * expo-sqlite's localStorage, and refreshes only while the app is in the foreground.
 * Created on first use.
 */
export function getSupabase(): SupabaseClient<Database> {
  if (client) return client;
  // Installs `localStorage` on iOS and Android; nothing on web, where the browser has its own.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('./local-storage');
  const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
  const key = process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) throw new Error('Set EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY (see .env.example)');

  const c = createClient<Database>(url, key, {
    auth: {
      // None while the web build renders on the server: that session lives in memory and is thrown away.
      storage: Platform.OS === 'web' && typeof window === 'undefined' ? undefined : localStorage,
      autoRefreshToken: true,
      persistSession: true,
      // Phones have no URL to read a session from.
      detectSessionInUrl: false,
    },
  });
  // On iOS and Android the refresh loop would otherwise run in the background too. The web client
  // watches page visibility itself.
  if (Platform.OS !== 'web') {
    AppState.addEventListener('change', (state) => {
      if (state === 'active') c.auth.startAutoRefresh();
      else c.auth.stopAutoRefresh();
    });
  }
  client = c;
  return c;
}

// ── sign-in ──

/** Crew: a 6-digit code by email. Crew accounts are pre-created (`npm run db:seed`), so no sign-ups here. */
export async function sendCode(email: string) {
  const { error } = await getSupabase().auth.signInWithOtp({ email: email.trim(), options: { shouldCreateUser: false } });
  if (error) throw error;
}

export async function verifyCode(email: string, code: string) {
  const { error } = await getSupabase().auth.verifyOtp({ email: email.trim(), token: code.trim(), type: 'email' });
  if (error) throw error;
}

/** Festival-goers: an anonymous session for this device. */
export async function signInAsGuest() {
  const { error } = await getSupabase().auth.signInAnonymously();
  if (error) throw error;
}

export async function signOut() {
  const { error } = await getSupabase().auth.signOut();
  if (error) throw error;
}
