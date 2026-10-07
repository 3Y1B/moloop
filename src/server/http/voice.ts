import { Hono } from 'hono';

import { speechAvailable } from '../models/speech';
import { hear, MAX_CLIP_BYTES } from '../voice';
import type { AuthEnv } from './auth';

/**
 * POST /api/transcribe: multipart, one `audio` file (a hold of the pill). Anyone signed in, festival-goers too.
 * Answers `{ text, clip }`: what was heard, and the clip's path to send along with whatever it becomes.
 * 503 when the server has no Spark key: the phone says so and typing still works.
 */
export const voice = new Hono<AuthEnv>();

voice.post('/transcribe', async (c) => {
  if (!speechAvailable()) return c.json({ error: 'speech is off on this server' }, 503);
  const body = await c.req.parseBody().catch(() => null);
  const file = body?.audio;
  if (!(file instanceof File) || !file.size) return c.json({ error: 'invalid body: send one audio file as `audio`' }, 400);
  if (file.size > MAX_CLIP_BYTES) return c.json({ error: 'clip too long' }, 413);
  try {
    return c.json(await hear(c.get('caller').id, file));
  } catch (e) {
    console.error('/api/transcribe failed', e);
    return c.json({ error: 'speech unavailable' }, 502);
  }
});
