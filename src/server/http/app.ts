import { Hono } from 'hono';
import { cors } from 'hono/cors';

import { POLICY } from '@/lib/lifecycle';
import { requireCaller, type AuthEnv } from './auth';
import { live } from '../models/interpreter';
import { briefsEnabled, speechAvailable } from '../models/speech';
import { commands } from './commands';
import { voice } from './voice';

/**
 * The server's HTTP surface. Phones read Supabase directly; every write comes through here so the
 * lifecycle runs in one place (docs/PLAN-LIVE.md).
 */
export const app = new Hono<AuthEnv>();

// Mo's console is the web build on another origin.
app.use('/api/*', cors({ origin: (origin) => origin, allowHeaders: ['authorization', 'content-type'] }));

// The timings in force, so a test can check it's talking to a fast-policy server. And whether voice is on.
app.get('/health', (c) => c.json({ ok: true, policy: POLICY, models: live ? 'live' : 'keywords', speech: { transcribe: speechAvailable(), briefs: briefsEnabled() } }));

app.use('/api/*', requireCaller);

// One route per Repo command (./commands.ts), and speech in (./voice.ts).
app.route('/api', commands);
app.route('/api', voice);
