import * as C from '@/lib/commands';
import type { GuestRequest } from '@/lib/schema';
import { interpreter } from './models/interpreter';
import { matchOpen } from './retriage';
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
    // Again while they added to it during the model call: the model reads the whole conversation each time.
    while (await understandOnce(requestId) === 'changed');
  } finally {
    inFlight.delete(requestId);
  }
}

async function understandOnce(requestId: string): Promise<'done' | 'changed'> {
  const r = await read({ requestIds: [requestId] }, ({ world }) => world.requests[requestId]);
  if (!r || r.stage !== 'understanding') return 'done';
  const { value, run } = await interpreter.understand({ text: conversation(r), zoneSlug: r.zoneSlug, locationHint: r.locationHint, from: { kind: 'festivalgoer' } });
  // A report (not a question) may be about something already open nearby.
  const matched = value.kind === 'task'
    ? await read({}, ({ world }) => Object.values(world.tasks)).then((tasks) => matchOpen(tasks, {
      text: r.heard, zoneSlug: r.zoneSlug ?? value.zoneSlug, locationHint: r.locationHint ?? value.locationHint,
    }))
    : undefined;
  const taskId = matched?.value?.taskId;
  return transact({ requestIds: [requestId], taskIds: taskId ? [taskId] : [] }, (b) => {
    if (b.requests[requestId]?.thread.length !== r.thread.length) return 'changed' as const;
    C.understand(b, requestId, value, matched?.value);
    return 'done' as const;
  }, {
    run: taskId ? { ...matched!.run, requestId, taskId } : { ...run, requestId },
  });
}

/** The first ask is just what they said; after "not solved", the model sees what it already told them. */
function conversation(r: GuestRequest) {
  if (!r.thread.some((e) => e.from === 'ai')) return r.heard;
  return r.thread.map((e) => `${e.from === 'ai' ? 'You answered' : 'Festival-goer'}: ${e.text}`).join('\n');
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
