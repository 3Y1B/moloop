import { createHash, timingSafeEqual } from 'node:crypto';
import { Hono } from 'hono';
import { z } from 'zod';

import { ObservationSchema, observationDefinition, observationReferenceErrors } from '@/lib/mobilization-observations';
import { onReading, type Place, type Reading } from '../triggers';
import { sql } from '../world';

/**
 * POST /api/reading: one measurement, from a sensor or the demo simulator (docs/plans/2026-10-08-mobilization-plan.md,
 * "Readings"). Server key only: the caller sends the Supabase secret key as its bearer token, which the app never has.
 * Stored, then checked against the playbooks' lines (T3, ../triggers.ts) after the response.
 */
export const readings = new Hono();

/** The built-in weather the planner reads from readings (scenarioFrom in ../predict/plan.ts). */
const WEATHER = new Set(['weather.temperature', 'weather.warning', 'weatherStatus']);
/** A little clock skew, not a forecast. */
const FUTURE_MS = 60_000;

const Body = z.object({
  key: z.string().trim().min(1).max(120),
  zoneSlug: z.string().trim().min(1).max(80).nullable().default(null),
  value: z.unknown(),
  observedAt: z.iso.datetime({ offset: true }).optional(),
  source: z.enum(['sensor', 'simulated']),
});

export type ParsedReading = Omit<Reading, 'id'>;

/** A reading the catalog knows, at places that exist, or why not. */
export function parseReading(body: unknown, zoneSlugs: readonly string[], now = Date.now()):
  { reading: ParsedReading } | { error: string } {
  const parsed = Body.safeParse(body);
  if (!parsed.success) return { error: parsed.error.issues.map((i) => `${i.path.join('.') || 'body'}: ${i.message}`).join('; ') };
  const { key, zoneSlug, value, observedAt, source } = parsed.data;
  const definition = observationDefinition(key);
  if (!definition) return { error: `Unknown reading key ${key}` };
  if (definition.builtin && !WEATHER.has(key)) return { error: `${key} isn't a reading` };
  if (value == null) return { error: 'value: required' };
  // Audit S8: an unknown place is refused, never stored as nowhere.
  if (zoneSlug != null && !zoneSlugs.includes(zoneSlug)) return { error: `Unknown zone ${zoneSlug}` };
  const row = ObservationSchema.safeParse({ key, kind: definition.kind, zoneSlug, minutesAgo: 0, value });
  // The catalog keeps the built-in weather out of a form's overrides; as a reading it's fine.
  const issues = row.success ? [] : row.error.issues.map((i) => i.message)
    .filter((m) => !(definition.builtin && m.startsWith(`${key} is supplied by built-in controls`)));
  if (issues.length) return { error: issues.join('; ') };
  // The places inside a value (a count per gate) must exist too.
  const refs = row.success ? observationReferenceErrors([row.data], zoneSlugs) : [];
  if (refs.length) return { error: refs.join('; ') };
  const at = observedAt ? Date.parse(observedAt) : now;
  if (at > now + FUTURE_MS) return { error: 'observedAt: in the future' };
  return { reading: { key, zoneSlug, value, observedAt: at, source } };
}

const digest = (s: string) => createHash('sha256').update(s).digest();
/** The Supabase secret key, compared in constant time. No key set: nobody gets in. */
export function isServerKey(header: string | undefined): boolean {
  const key = process.env.SUPABASE_SECRET_KEY;
  const token = header?.replace(/^Bearer\s+/i, '');
  return !!key && !!token && timingSafeEqual(digest(token), digest(key));
}

readings.post('/reading', async (c) => {
  if (!isServerKey(c.req.header('authorization'))) return c.json({ error: 'unauthenticated' }, 401);
  const zones = await sql()<{ id: string; slug: string; kind: string; capacity: number | null }[]>`
    select id, slug, kind, capacity from zones`;
  const out = parseReading(await c.req.json().catch(() => null), zones.map((z) => z.slug));
  if ('error' in out) return c.json({ error: out.error }, 400);
  const r = out.reading;
  const zoneId = zones.find((z) => z.slug === r.zoneSlug)?.id ?? null;
  const [row] = await sql()<{ id: string }[]>`
    insert into readings (key, zone_id, value, observed_at, source)
    values (${r.key}, ${zoneId}, ${sql().json(r.value as Parameters<ReturnType<typeof sql>['json']>[0])},
      ${new Date(r.observedAt).toISOString()}::timestamptz, ${r.source})
    returning id`;
  const places: Record<string, Place> = Object.fromEntries(zones.map((z) => [z.slug, { kind: z.kind, capacity: z.capacity }]));
  // Off the sender's path: the planner can take a while.
  setTimeout(() => onReading({ ...r, id: row.id }, places).catch((e) => console.error(`reading ${row.id} failed`, e)), 0);
  return c.json({ id: row.id }, 201);
});
