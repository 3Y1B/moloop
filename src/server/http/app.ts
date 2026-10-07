import { Hono } from 'hono';
import { cors } from 'hono/cors';

import { POLICY } from '@/lib/lifecycle';
import { ReportInput } from '@/lib/schema';
import { handleReport } from '../pipeline';
import { requireCaller, type AuthEnv } from './auth';
import { commands } from './commands';

/**
 * The server's HTTP surface. Phones read Supabase directly; every write comes through here so the
 * lifecycle runs in one place (docs/PLAN-LIVE.md).
 */
export const app = new Hono<AuthEnv>();

// Mo's console is the web build on another origin.
app.use('/api/*', cors({ origin: (origin) => origin, allowHeaders: ['authorization', 'content-type'] }));

// The timings in force, so a test can check it's talking to a fast-policy server.
app.get('/health', (c) => c.json({ ok: true, policy: POLICY }));

app.use('/api/*', requireCaller);

app.post('/api/reports', async (c) => {
  const parsed = ReportInput.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: parsed.error.flatten() }, 400);

  // Who reported comes from the session, not the body.
  const caller = c.get('caller');
  const input: ReportInput = caller.kind === 'crew'
    ? { ...parsed.data, reporterId: caller.id, reporterKind: caller.role === 'volunteer' ? 'volunteer' : 'staff' }
    : { ...parsed.data, reporterId: undefined, reporterKind: 'festivalgoer' };

  try {
    return c.json(await handleReport(input));
  } catch (e) {
    console.error('pipeline failed', e);
    // Never leave a reporter hanging: fail closed to a human.
    return c.json({ error: 'pipeline_failed' }, 502);
  }
});

// One route per Repo command (./commands.ts).
app.route('/api', commands);
