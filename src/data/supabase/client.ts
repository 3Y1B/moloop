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

/**
 * Crew: email only. The server checks the email is crew and hands back a session (src/server/http/sign-in.ts);
 * crew accounts are pre-created (`npm run db:seed`), so no sign-ups here.
 */
export async function signInWithEmail(email: string) {
  const server = (process.env.EXPO_PUBLIC_SERVER_URL ?? 'http://127.0.0.1:8787').replace(/\/+$/, '');
  const res = await fetch(`${server}/auth/sign-in`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: email.trim() }),
  });
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error(res.status === 404 ? 'not found' : (body?.error ?? `sign-in failed (${res.status})`));
  const { error } = await getSupabase().auth.setSession({ access_token: body.access_token, refresh_token: body.refresh_token });
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
