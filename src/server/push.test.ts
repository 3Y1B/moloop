import { afterEach, describe, expect, it, vi } from 'vitest';

import type { Batch } from '@/lib/batch';
import type { Message } from '@/lib/schema';
import { pusher, RECEIPT_DELAY_MS, type DeviceToken, type PushStore } from './push';

vi.mock('./world', () => ({ sql: () => { throw new Error('No database in unit tests'); } }));

const NOW = 1_800_000_000_000;

/** Tokens and delivery rows in memory. */
function store(tokens: DeviceToken[]) {
  const s = {
    tokens: [...tokens],
    pushed: [] as { messageId: string; recipientId: string }[],
    dropped: [] as string[],
  };
  const api: PushStore = {
    tokens: async (ids) => s.tokens.filter((t) => ids.includes(t.personId)),
    pushed: async (d) => void s.pushed.push(...d),
    drop: async (ts) => {
      s.dropped.push(...ts);
      s.tokens = s.tokens.filter((t) => !ts.includes(t.token));
    },
  };
  return { s, api };
}

type Sent = { url: string; body: any; headers: Record<string, string> };

/** Expo's push API: every send is ok unless `tickets` says otherwise for that token. */
function expo({ tickets = {}, receipts = {}, fail }: {
  tickets?: Record<string, object>;
  receipts?: Record<string, object>;
  fail?: () => Response | never;
} = {}) {
  const sent: Sent[] = [];
  let n = 0;
  const fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body));
    sent.push({ url: String(url), body, headers: init?.headers as Record<string, string> });
    if (fail) return fail();
    if (String(url).endsWith('/send'))
      return Response.json({
        data: (body as { to: string }[]).map((m) => tickets[m.to] ?? { status: 'ok', id: `ticket-${++n}-${m.to}` }),
      });
    return Response.json({ data: Object.fromEntries((body.ids as string[]).flatMap((id) => (receipts[id] ? [[id, receipts[id]]] : []))) });
  });
  return { fetch: fetch as unknown as typeof globalThis.fetch, sent };
}

const msg = (id: string, recipientId: string, kind: Message['kind'], over: Partial<Message> = {}): Message => ({
  id, recipientId, at: NOW, kind, fromName: 'Moloop', body: `${kind} for ${recipientId}`, read: false, taskId: 't1', ...over,
});
const batch = (messages: Message[], extra: { quiet?: string[]; senders?: Record<string, string> } = {}) =>
  ({ messages, quiet: new Set(extra.quiet ?? []), senders: extra.senders ?? {} }) as Pick<Batch, 'messages' | 'quiet' | 'senders'>;

const sends = (sent: Sent[]) => sent.filter((s) => s.url.endsWith('/push/send'));
const pushes = (sent: Sent[]) => sends(sent).flatMap((s) => s.body as { to: string; title: string; interruptionLevel: string; sound: string | null; channelId: string; data: object }[]);

afterEach(() => vi.restoreAllMocks());

describe('sendPushes', () => {
  it('a task, a heads-up to 150 and a closed: right level, sound and channel each, 150 heads-ups in 2 requests', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const crowd = Array.from({ length: 150 }, (_, i) => `v${i}`);
    const { s, api } = store([{ token: 'tok-priya', personId: 'priya' }, ...crowd.map((p) => ({ token: `tok-${p}`, personId: p }))]);
    const { fetch, sent } = expo();
    const p = pusher({ store: api, fetch, now: () => NOW });

    await p.send(batch([
      msg('task', 'priya', 'task'),
      msg('done', 'priya', 'closed'),
    ]));
    await p.send(batch(crowd.map((v, i) => msg(`b${i}`, v, 'broadcast', { fromName: 'Jordan Lee', taskId: undefined }))));

    const all = pushes(sent);
    expect(all.find((m) => m.data && (m.data as { messageId: string }).messageId === 'task')).toMatchObject({
      to: 'tok-priya', title: 'New task', interruptionLevel: 'time-sensitive', sound: 'default', channelId: 'tasks',
      data: { messageId: 'task', taskId: 't1' },
    });
    expect(all.find((m) => (m.data as { messageId: string }).messageId === 'done')).toMatchObject({
      interruptionLevel: 'passive', sound: null, channelId: 'updates',
    });
    expect(all.filter((m) => m.title === 'Jordan Lee')).toHaveLength(150);
    expect(sends(sent).map((r) => r.body.length)).toEqual([2, 100, 50]);
    expect(sends(sent)[0].headers).toMatchObject({ accept: 'application/json', 'content-type': 'application/json' });
    expect(s.pushed).toHaveLength(152);
    expect(p.waiting()).toBe(152);
  });

  it('a recipient with no token is skipped; two devices for one person get two pushes', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const { s, api } = store([{ token: 'phone', personId: 'priya' }, { token: 'tablet', personId: 'priya' }]);
    const { fetch, sent } = expo();
    await pusher({ store: api, fetch }).send(batch([msg('a', 'priya', 'task'), msg('b', 'sam', 'task')]));

    expect(pushes(sent).map((m) => m.to)).toEqual(['phone', 'tablet']);
    expect(s.pushed).toEqual([{ messageId: 'a', recipientId: 'priya' }]);
  });

  it('nothing to push sends nothing', async () => {
    const { api } = store([]);
    const { fetch, sent } = expo();
    await pusher({ store: api, fetch }).send(batch([msg('a', 'priya', 'task')]));
    expect(sent).toEqual([]);
  });

  it('own actions are skipped: quiet, or sent by the recipient', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const { api } = store([{ token: 'p', personId: 'priya' }, { token: 'l', personId: 'lee' }]);
    const { fetch, sent } = expo();
    await pusher({ store: api, fetch }).send(batch(
      [msg('echo', 'priya', 'system'), msg('self', 'lee', 'direct'), msg('ask', 'lee', 'escalation')],
      { quiet: ['echo'], senders: { self: 'lee' } },
    ));
    expect(pushes(sent).map((m) => (m.data as { messageId: string }).messageId)).toEqual(['ask']);
  });

  it('the access token goes along when set', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const { api } = store([{ token: 'p', personId: 'priya' }]);
    const { fetch, sent } = expo();
    await pusher({ store: api, fetch, accessToken: 'secret' }).send(batch([msg('a', 'priya', 'task')]));
    expect(sent[0].headers.authorization).toBe('Bearer secret');
  });

  it('a send that throws or answers 5xx logs and never throws', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const { s, api } = store([{ token: 'p', personId: 'priya' }]);
    const thrown = expo({ fail: () => { throw new Error('offline'); } });
    await expect(pusher({ store: api, fetch: thrown.fetch }).send(batch([msg('a', 'priya', 'task')]))).resolves.toBeUndefined();
    const down = expo({ fail: () => new Response('bad gateway', { status: 502 }) });
    await expect(pusher({ store: api, fetch: down.fetch }).send(batch([msg('a', 'priya', 'task')]))).resolves.toBeUndefined();
    expect(error).toHaveBeenCalledTimes(2);
    expect(s.pushed).toEqual([]);
  });

  it('a DeviceNotRegistered ticket deletes that token straight away; other errors log', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const { s, api } = store([{ token: 'dead', personId: 'priya' }, { token: 'big', personId: 'priya' }, { token: 'ok', personId: 'priya' }]);
    const { fetch } = expo({
      tickets: {
        dead: { status: 'error', message: 'gone', details: { error: 'DeviceNotRegistered' } },
        big: { status: 'error', message: 'too big', details: { error: 'MessageTooBig' } },
      },
    });
    await pusher({ store: api, fetch }).send(batch([msg('a', 'priya', 'task')]));
    expect(s.dropped).toEqual(['dead']);
    expect(error).toHaveBeenCalledTimes(1);
    expect(s.pushed).toEqual([{ messageId: 'a', recipientId: 'priya' }]);
  });
});

describe('checkReceipts', () => {
  it('after the delay, DeviceNotRegistered deletes the token, others don’t; a missing receipt waits', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'log').mockImplementation(() => {});
    let now = NOW;
    const { s, api } = store(['gone', 'fine', 'rate', 'late'].map((token) => ({ token, personId: 'priya' })));
    const { fetch, sent } = expo({
      receipts: {
        'ticket-1-gone': { status: 'error', details: { error: 'DeviceNotRegistered' } },
        'ticket-2-fine': { status: 'ok' },
        'ticket-3-rate': { status: 'error', details: { error: 'MessageRateExceeded' } },
      },
    });
    const p = pusher({ store: api, fetch, now: () => now });
    await p.send(batch([msg('a', 'priya', 'task')]));

    await p.checkReceipts();
    expect(sent.filter((r) => r.url.endsWith('getReceipts'))).toEqual([]);

    now += RECEIPT_DELAY_MS;
    await p.checkReceipts();
    expect(sent.at(-1)?.body.ids).toHaveLength(4);
    expect(s.dropped).toEqual(['gone']);
    expect(error).toHaveBeenCalledTimes(1);
    expect(p.waiting()).toBe(1);
  });
});
