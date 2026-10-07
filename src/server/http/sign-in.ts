import { createClient } from '@supabase/supabase-js';
import { Hono } from 'hono';

import { db } from '../db';
import { sql } from '../world';

/**
 * Crew sign-in by email alone: no code, no email sent. The email must belong to a crew profile (seeded);
 * the server mints a magic link with the secret key and redeems it on a throwaway client, handing the
 * phone a real Supabase session, so RLS and auth.uid() work as before.
 */
export const signIn = new Hono();

signIn.post('/sign-in', async (c) => {
  const body = await c.req.json().catch(() => null);
  const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : '';
  if (!/^\S+@\S+\.\S+$/.test(email)) return c.json({ error: 'invalid_email' }, 400);

  const [crew] = await sql()`select u.id from auth.users u join public.profiles p on p.id = u.id where lower(u.email) = ${email} limit 1`;
  if (!crew) return c.json({ error: 'not_crew' }, 404);

  const { data: link, error } = await db().auth.admin.generateLink({ type: 'magiclink', email });
  if (error) return c.json({ error: error.message }, 500);

  // Its own client: redeeming on the shared one would swap the server's secret key for this user's token.
  const auth = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  }).auth;
  const { data, error: e2 } = await auth.verifyOtp({ email, token: link.properties.email_otp, type: 'email' });
  if (e2 || !data.session) return c.json({ error: e2?.message ?? 'no session' }, 500);

  const { access_token, refresh_token } = data.session;
  return c.json({ access_token, refresh_token });
});
