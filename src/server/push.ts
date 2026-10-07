import type { Batch } from '@/lib/batch';
import { pushable, pushFor } from '@/lib/push';
import { sql } from './world';

/**
 * Push notifications (docs/plans/2026-10-08-push-notifications-plan.md). Every message a commit writes also goes to
 * its recipient's devices through Expo, except one that only confirms what they just did (src/lib/push.ts).
 *
 *  - Send: after commit, fire and forget like the spoken briefs (./voice.ts). One Expo message per device, 100 to a
 *    request. A failed push logs and never reaches the command. The delivery row gets `pushed_at`.
 *  - Receipts: tickets are kept in memory and checked about 15 min later. `DeviceNotRegistered`, on a ticket or a
 *    receipt, deletes the token. A restart loses the tickets: the next push to a dead token says so again.
 *  - Tokens: POST /api/registerPush and /api/unregisterPush (./http/commands.ts), any signed-in person.
 */

const SEND_URL = 'https://exp.host/--/api/v2/push/send';
const RECEIPTS_URL = 'https://exp.host/--/api/v2/push/getReceipts';
const SEND_CHUNK = 100;
const RECEIPT_CHUNK = 1000;
export const RECEIPT_DELAY_MS = 15 * 60_000;
/** Expo keeps receipts for a day; a ticket with none by then is given up on. */
const RECEIPT_GIVE_UP_MS = 24 * 60 * 60_000;

export type Platform = 'ios' | 'android';
export type DeviceToken = { token: string; personId: string };

/** The rows push touches. The server's is Postgres; tests keep them in memory. */
export type PushStore = {
  tokens(personIds: string[]): Promise<DeviceToken[]>;
  pushed(deliveries: { messageId: string; recipientId: string }[]): Promise<void>;
  drop(tokens: string[]): Promise<void>;
};

type Ticket = { status: 'ok'; id: string } | { status: 'error'; message?: string; details?: { error?: string } };
type Receipt = { status: 'ok' } | { status: 'error'; message?: string; details?: { error?: string } };

export function pusher({
  store,
  fetch: send = fetch,
  accessToken = process.env.EXPO_ACCESS_TOKEN,
  now = Date.now,
}: {
  store: PushStore;
  fetch?: typeof fetch;
  accessToken?: string;
  now?: () => number;
}) {
  /** Tickets waiting for a receipt. */
  const tickets = new Map<string, { token: string; at: number }>();
  const headers = {
    accept: 'application/json',
    'content-type': 'application/json',
    ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {}),
  };

  async function post<T>(url: string, body: unknown): Promise<T> {
    const res = await send(url, { method: 'POST', headers, body: JSON.stringify(body) });
    if (!res.ok) throw new Error(`${res.status} ${(await res.text().catch(() => '')).slice(0, 300)}`);
    return (await res.json()) as T;
  }

  async function sendBatch(b: Pick<Batch, 'messages' | 'quiet' | 'senders'>) {
    const messages = pushable(b);
    if (!messages.length) return;
    const devices = await store.tokens([...new Set(messages.map((m) => m.recipientId))]);
    const byPerson = new Map<string, string[]>();
    for (const d of devices) byPerson.set(d.personId, [...(byPerson.get(d.personId) ?? []), d.token]);

    const out = messages.flatMap((m) =>
      (byPerson.get(m.recipientId) ?? []).map((to) => ({ to, m, push: { to, ...pushFor(m) } })),
    );
    if (!out.length) return;

    const pushed = new Map<string, { messageId: string; recipientId: string }>();
    const dead: string[] = [];
    let failed = 0;
    for (let i = 0; i < out.length; i += SEND_CHUNK) {
      const chunk = out.slice(i, i + SEND_CHUNK);
      try {
        const { data } = await post<{ data?: Ticket[] }>(SEND_URL, chunk.map((c) => c.push));
        chunk.forEach(({ to, m }, j) => {
          const t = data?.[j];
          if (t?.status === 'ok') {
            tickets.set(t.id, { token: to, at: now() });
            pushed.set(`${m.id} ${m.recipientId}`, { messageId: m.id, recipientId: m.recipientId });
            return;
          }
          failed++;
          if (t?.details?.error === 'DeviceNotRegistered') dead.push(to);
          else console.error(`[push] ${m.id} to ${to.slice(0, 30)}…: ${t?.details?.error ?? t?.message ?? 'no ticket'}`);
        });
      } catch (e) {
        failed += chunk.length;
        console.error(`[push] sending ${chunk.length} failed`, e);
      }
    }
    if (dead.length) await store.drop(dead);
    if (pushed.size) await store.pushed([...pushed.values()]);
    console.log(`[push] ${out.length - failed}/${out.length} sent for ${messages.length} message(s)${dead.length ? `, ${dead.length} dead token(s) dropped` : ''}`);
  }

  /** Receipts for tickets at least `delayMs` old. Dead devices lose their token; other errors log. */
  async function checkReceipts(delayMs = RECEIPT_DELAY_MS) {
    const due = [...tickets].filter(([, t]) => now() - t.at >= delayMs);
    const dead: string[] = [];
    for (let i = 0; i < due.length; i += RECEIPT_CHUNK) {
      const chunk = due.slice(i, i + RECEIPT_CHUNK);
      try {
        const { data } = await post<{ data?: Record<string, Receipt> }>(RECEIPTS_URL, { ids: chunk.map(([id]) => id) });
        for (const [id, t] of chunk) {
          const r = data?.[id];
          if (!r) {
            // Not ready yet: tried again next time, until Expo can't have it any more.
            if (now() - t.at > RECEIPT_GIVE_UP_MS) tickets.delete(id);
            continue;
          }
          tickets.delete(id);
          if (r.status === 'ok') continue;
          if (r.details?.error === 'DeviceNotRegistered') dead.push(t.token);
          else console.error(`[push] receipt ${id}: ${r.details?.error ?? r.message ?? 'error'}`);
        }
      } catch (e) {
        console.error(`[push] fetching ${chunk.length} receipt(s) failed`, e);
      }
    }
    if (dead.length) await store.drop([...new Set(dead)]);
  }

  return { send: sendBatch, checkReceipts, waiting: () => tickets.size };
}

// ── the server's ──

export const postgresStore: PushStore = {
  async tokens(personIds) {
    if (!personIds.length) return [];
    return sql()<DeviceToken[]>`
      select token, person_id as "personId" from push_tokens where person_id = any(${personIds}::uuid[])`;
  },
  async pushed(deliveries) {
    await sql()`
      update message_deliveries d set pushed_at = now()
      from unnest(${deliveries.map((d) => d.messageId)}::uuid[], ${deliveries.map((d) => d.recipientId)}::uuid[]) as x(m, r)
      where d.message_id = x.m and d.recipient_id = x.r`;
  },
  async drop(tokens) {
    await sql()`delete from push_tokens where token = any(${tokens}::text[])`;
  },
};

let server: ReturnType<typeof pusher> | undefined;
const live = () => (server ??= pusher({ store: postgresStore }));

/** After commit: push what the batch wrote. Never throws. */
export function sendPushes(b: Batch) {
  void live()
    .send(b)
    .catch((e) => console.error('[push] failed', e));
}

/** Check receipts every few minutes; each ticket is looked at once it's ~15 min old. */
export function startReceiptChecks(everyMs = 5 * 60_000) {
  const timer = setInterval(() => {
    live()
      .checkReceipts()
      .catch((e) => console.error('[push] receipts failed', e));
  }, everyMs);
  return () => clearInterval(timer);
}

/** This device now pushes to `personId`. A shared phone's token moves to whoever signed in last. */
export async function registerToken(personId: string, token: string, platform: Platform) {
  await sql()`
    insert into push_tokens ${sql()({ token, person_id: personId, platform })}
    on conflict (token) do update set person_id = excluded.person_id, platform = excluded.platform, updated_at = now()`;
}

/** Signed out: this device stops pushing to `personId`. Someone else's token is left alone. */
export async function unregisterToken(personId: string, token: string) {
  await sql()`delete from push_tokens where token = ${token} and person_id = ${personId}`;
}
