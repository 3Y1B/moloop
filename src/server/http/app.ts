import { Hono } from 'hono';
import { cors } from 'hono/cors';

import { POLICY } from '@/lib/lifecycle';
import { requireCaller, type AuthEnv } from './auth';
import { briefsEnabled, speechAvailable } from '../models/speech';
import { commands } from './commands';
import { readings } from './readings';
import { signIn } from './sign-in';
import { voice } from './voice';

/**
 * The server's HTTP surface. Phones read Supabase directly; every write comes through here so the
 * lifecycle runs in one place (docs/PLAN-LIVE.md).
 */
export const app = new Hono<AuthEnv>();

// Mo's console is the web build on another origin.
app.use('/api/*', cors({ origin: (origin) => origin, allowHeaders: ['authorization', 'content-type'] }));

// The timings in force, so a test can check it's talking to a fast-policy server. And whether voice is on.
app.get('/health', (c) =>
  c.json({
    ok: true,
    policy: POLICY,
    schedulerEveryMs: Number(process.env.SCHEDULER_MS ?? 5_000),
    speech: { transcribe: speechAvailable(), briefs: briefsEnabled() },
  }),
);

// Crew sign-in by email (./sign-in.ts): before there's a session, so outside /api.
app.use('/auth/*', cors({ origin: (origin) => origin, allowHeaders: ['content-type'] }));
app.route('/auth', signIn);

// Sensors and the demo simulator (./readings.ts): the server key, not a session, so before requireCaller.
app.route('/api', readings);

app.use('/api/*', requireCaller);

// One route per Repo command (./commands.ts).
app.route('/api', commands);
app.route('/api', voice);
