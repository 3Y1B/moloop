import { createClient, type SupabaseClient } from '@supabase/supabase-js';

let client: SupabaseClient | undefined;

/** The server's Supabase client: secret key, bypasses RLS. Never import this from app code. */
export function db(): SupabaseClient {
  client ??= createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return client;
}
