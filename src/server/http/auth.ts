import { createMiddleware } from 'hono/factory';

import type { VolunteerRole } from '@/lib/schema';
import { db } from '../db';

/** Who is calling: crew (has a profile) or a festival-goer (anonymous sign-in). */
export type Caller =
  | { kind: 'crew'; id: string; role: VolunteerRole | 'safety_lead' | 'admin' }
  | { kind: 'guest'; id: string };

export type AuthEnv = { Variables: { caller: Caller } };

/** Every command needs a Supabase session. The JWT is verified here; the role comes from profiles, never the token. */
export const requireCaller = createMiddleware<AuthEnv>(async (c, next) => {
  const jwt = c.req.header('authorization')?.replace(/^Bearer\s+/i, '');
  if (!jwt) return c.json({ error: 'unauthenticated' }, 401);

  const { data, error } = await db().auth.getClaims(jwt);
  if (error || !data) return c.json({ error: 'unauthenticated' }, 401);
  const id = data.claims.sub;

  const { data: profile } = await db().from('profiles').select('role').eq('id', id).maybeSingle();
  c.set('caller', profile ? { kind: 'crew', id, role: profile.role } : { kind: 'guest', id });
  await next();
});
