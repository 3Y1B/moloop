import * as C from '@/lib/commands';
import { interpreter } from './models/interpreter';
import { read, sql, transact } from './world';

/**
 * The AI step of a festival-goer's request, run after the request is saved so the phone shows "Understanding"
 * meanwhile. The model is asked outside the world lock (it takes seconds); the answer goes in as one command.
 */

const inFlight = new Set<string>();

export async function understandRequest(requestId: string) {
  if (inFlight.has(requestId)) return;
  inFlight.add(requestId);
  try {
    const r = await read({ requestIds: [requestId] }, ({ world }) => world.requests[requestId]);
    if (!r || r.stage !== 'understanding') return;
    const { value, run } = await interpreter.understand({ text: r.heard, zoneSlug: r.zoneSlug, locationHint: r.locationHint });
    await transact({ requestIds: [requestId] }, (b) => C.understand(b, requestId, value), { run: { ...run, requestId } });
  } finally {
    inFlight.delete(requestId);
  }
}

export function understandLater(requestId: string) {
  setTimeout(() => understandRequest(requestId).catch((e) => console.error(`understand ${requestId} failed`, e)), 0);
}

/** Requests stuck at "Understanding": the server restarted after someone asked, or a model call died. */
export async function sweepUnderstanding(olderThanMs = 20_000) {
  const rows = await sql()<{ id: string }[]>`
    select id from guest_requests
    where stage = 'understanding' and created_at < now() - ${olderThanMs / 1000} * interval '1 second'
    order by created_at limit 20`;
  for (const { id } of rows) await understandRequest(id).catch((e) => console.error(`understand ${id} failed`, e));
}
