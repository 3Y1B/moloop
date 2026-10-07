import type { Session, SupabaseClient } from '@supabase/supabase-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Database } from '@/lib/database.types';
import { SupabaseRepo } from './supabase-repo';
import type { Refs } from './supabase/rows';
import { toPlan } from './venue';

type AuthCallback = (event: string, session: Session | null) => void;
type Result = { data: Record<string, unknown>[]; error: null };

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((yes) => { resolve = yes; });
  return { promise, resolve };
}

const session = (id: string, anonymous = false) => ({ user: { id, is_anonymous: anonymous } }) as Session;

/** Mirrors the SDK's topic cache, once-only subscribe, and delayed leave acknowledgement. */
class StrictChannel {
  subscribed = false;
  teardownCount = 0;
  readonly fallbackTimeouts: number[] = [];
  private bindings: { event: string; table?: string; callback: (payload: unknown) => void }[] = [];
  private status: ((status: string) => void) | null = null;

  constructor(readonly topic: string, private evict: () => void) {}

  on(event: string, filter: { table?: string }, callback: (payload: unknown) => void) {
    if (event === 'postgres_changes' && this.subscribed) {
      throw new Error(`cannot add postgres_changes callbacks for ${this.topic} after subscribe()`);
    }
    this.bindings.push({ event, table: filter.table, callback });
    return this;
  }

  subscribe(callback: (status: string) => void) {
    if (this.subscribed) throw new Error('channel already subscribed');
    this.subscribed = true;
    this.status = callback;
    return this;
  }

  emitStatus(status: string) { this.status?.(status); }
  emitSystem() { this.emit('system', { extension: 'postgres_changes', status: 'ok' }); }
  emitPresence(lat: number) {
    this.emit('postgres_changes', {
      eventType: 'INSERT', new: { person_id: 'person', lat, lng: 144, accuracy: 2, heading: null, at: '2026-10-08T00:00:00Z' },
    }, 'presence');
  }
  private emit(event: string, payload: unknown, table?: string) {
    for (const binding of this.bindings) {
      if (binding.event === event && binding.table === table) binding.callback(payload);
    }
  }

  async unsubscribe(timeout: number) {
    this.fallbackTimeouts.push(timeout);
    this.evict(); // Phoenix leave's close hook removes the topic before resolving.
    return 'ok' as const;
  }
  close() { this.evict(); }
  teardown() {
    this.teardownCount++;
    this.bindings = [];
    this.status = null;
  }
}

class SharedClient {
  readonly channels = new Map<string, StrictChannel>();
  readonly created: StrictChannel[] = [];
  readonly authCallbacks = new Set<AuthCallback>();
  readonly historicalAuthCallbacks: AuthCallback[] = [];
  readonly pendingRemovals: { channel: StrictChannel; done: ReturnType<typeof deferred<void>> }[] = [];
  readonly gates = new Map<string, ReturnType<typeof deferred<void>>>();
  uid = '';
  delayRemoval = false;
  removalResult: 'ok' | 'timed out' | 'error' | 'throw' = 'ok';
  removeCalls = 0;
  authUnsubscribes = 0;

  readonly auth = {
    onAuthStateChange: (callback: AuthCallback) => {
      this.authCallbacks.add(callback);
      this.historicalAuthCallbacks.push(callback);
      return { data: { subscription: { unsubscribe: () => {
        this.authUnsubscribes++;
        this.authCallbacks.delete(callback);
      } } } };
    },
  };

  signIn(id: string, anonymous = false) {
    this.uid = id;
    for (const callback of this.authCallbacks) callback('SIGNED_IN', session(id, anonymous));
  }
  channel(topic: string) {
    const cached = this.channels.get(topic);
    if (cached) return cached;
    const created = new StrictChannel(topic, () => this.channels.delete(topic));
    this.channels.set(topic, created);
    this.created.push(created);
    return created;
  }
  async removeChannel(channel: StrictChannel) {
    this.removeCalls++;
    if (this.delayRemoval) {
      const done = deferred<void>();
      this.pendingRemovals.push({ channel, done });
      await done.promise;
    }
    if (this.removalResult === 'throw') throw new Error('leave transport failed');
    if (this.removalResult !== 'error') channel.close();
    return this.removalResult;
  }
  releaseRemovals() {
    for (const { done } of this.pendingRemovals.splice(0)) done.resolve();
  }

  from(table: string) {
    const uid = this.uid; // A query is owned by the session in which it began.
    const result = async (): Promise<Result> => {
      await this.gates.get(uid)?.promise;
      const rows: Record<string, unknown>[] = table === 'teams'
        ? [{ id: `${uid}-team`, slug: 'first-aid', name: uid, color: null }]
        : table === 'zones' ? [{ id: `${uid}-zone`, slug: `${uid}-zone`, name: uid }]
        : table === 'tasks' ? [{
          id: `${uid}-task`, report_id: `${uid}-report`, title: uid, summary: uid,
          category: 'facilities', priority: 'P2', team_id: `${uid}-team`, zone_id: `${uid}-zone`,
          status: 'unassigned', assignee_id: null, handled_by: 'human', created_at: '2026-10-08T00:00:00Z',
          last_activity_at: '2026-10-08T00:00:00Z', required_count: 1,
        }] : [];
      return { data: rows, error: null };
    };
    const query = {
      select: (_columns: string) => query,
      eq: (_column: string, _value: unknown) => query,
      order: (_column: string) => query,
      then: (fulfilled: (result: Result) => unknown, rejected?: (error: unknown) => unknown) => result().then(fulfilled, rejected),
    };
    return query;
  }
  asDb() { return this as unknown as SupabaseClient<Database>; }
}

const repos: SupabaseRepo[] = [];
const clients: SharedClient[] = [];
function make(client = new SharedClient()) {
  if (!clients.includes(client)) clients.push(client);
  const repo = new SupabaseRepo(client.asDb(), { subscribeTimeoutMs: 60_000 });
  repos.push(repo);
  return { client, repo };
}
const flush = () => vi.advanceTimersByTimeAsync(0);

beforeEach(() => vi.useFakeTimers());
afterEach(async () => {
  for (const client of clients.splice(0)) {
    client.delayRemoval = false;
    client.releaseRemovals();
    for (const gate of client.gates.values()) gate.resolve();
  }
  for (const repo of repos.splice(0)) await repo.dispose();
  vi.useRealTimers();
});

describe('SupabaseRepo resource lifecycle', () => {
  it('recreates a Repo on a shared client while the previous removal is pending', async () => {
    const { client, repo: old } = make();
    client.signIn('user');
    await flush();
    const oldChannel = client.created[0];
    const staleAuth = client.historicalAuthCallbacks[0];
    client.delayRemoval = true;
    const oldDisposal = old.dispose();
    expect(old.dispose()).toBe(oldDisposal);

    const { repo: next } = make(client);
    client.signIn('user');
    await flush();
    expect(client.created).toHaveLength(2);
    expect(client.created[1].topic).not.toBe(oldChannel.topic);
    expect(client.channels.size).toBe(2);
    expect(client.authCallbacks.size).toBe(1);
    expect(client.authUnsubscribes).toBe(1);
    expect(client.removeCalls).toBe(1);

    staleAuth('SIGNED_IN', session('user'));
    oldChannel.emitStatus('CLOSED');
    old.resync();
    await flush();
    expect(client.created).toHaveLength(2);
    client.releaseRemovals();
    await oldDisposal;
    expect(client.channels.size).toBe(1);
    expect(oldChannel.teardownCount).toBe(1);
    expect(client.channels.get(client.created[1].topic)).toBe(client.created[1]);

    const nextDisposal = next.dispose();
    client.releaseRemovals();
    await nextDisposal;
    expect(client.channels.size).toBe(0);
    expect(client.authCallbacks.size).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('cancels an auth notification queued before disposal', async () => {
    const { client, repo } = make();
    client.signIn('user');
    const listener = vi.fn();
    repo.subscribe(listener);
    await repo.dispose();
    await flush();
    expect(client.created).toHaveLength(0);
    expect(listener).not.toHaveBeenCalled();
    expect(client.authCallbacks.size).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('clears the previous role immediately while its channel removal is pending', async () => {
    const { client, repo } = make();
    client.signIn('old');
    await flush();
    client.created[0].emitSystem();
    await flush();
    expect(repo.getSnapshot().tasks['old-task']).toBeDefined();
    client.delayRemoval = true;
    client.signIn('next');
    await flush();
    expect(repo.getSnapshot()).toMatchObject({ status: 'loading', meId: null, tasks: {}, volunteers: {} });
    expect(client.created).toHaveLength(1);
    client.releaseRemovals();
    await flush();
    expect(client.created).toHaveLength(2);
    client.created[1].emitSystem();
    await flush();
    expect(repo.getSnapshot().meId).toBe('next');
    expect(repo.getSnapshot().tasks['old-task']).toBeUndefined();
  });

  it('gets a fresh reconnect topic and ignores old-channel data while leave is pending', async () => {
    const { client, repo } = make();
    client.signIn('user');
    await flush();
    const oldChannel = client.created[0];
    client.delayRemoval = true;
    oldChannel.emitStatus('CLOSED');
    await vi.advanceTimersByTimeAsync(1_000);
    repo.resync(); // Foreground resync overlaps the pending reconnect's leave.
    await flush();
    expect(client.created).toHaveLength(2);
    const nextChannel = client.created[1];
    expect(nextChannel.topic).not.toBe(oldChannel.topic);
    oldChannel.emitPresence(1);
    nextChannel.emitSystem();
    await flush();
    nextChannel.emitPresence(2);
    expect(repo.getSnapshot().positions.person.y).toBe(toPlan([144, 2]).y);
    oldChannel.emitPresence(3);
    expect(repo.getSnapshot().positions.person.y).toBe(toPlan([144, 2]).y);
    client.releaseRemovals();
    await flush();
    expect(client.created).toHaveLength(2);
    expect(client.channels.size).toBe(1);
  });

  it.each(['timed out', 'error', 'throw'] as const)('fully tears down a %s removal', async (result) => {
    const { client, repo } = make();
    client.signIn('user');
    await flush();
    const channel = client.created[0];
    client.removalResult = result;
    await repo.dispose();
    expect(channel.fallbackTimeouts).toEqual(result === 'timed out' ? [] : [0]);
    expect(channel.teardownCount).toBe(1);
    expect(client.channels.size).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('hydrates a new session while the old load is pending, without stale refs or report mappings', async () => {
    const { client, repo } = make();
    const oldLoad = deferred<void>();
    client.gates.set('old', oldLoad);
    client.signIn('old', true);
    await flush();
    client.created[0].emitSystem();
    await flush();
    client.signIn('next');
    await flush();
    client.created[1].emitSystem();
    await flush();
    expect(repo.getSnapshot()).toMatchObject({ status: 'ready', meId: 'next', guestId: null });
    expect(repo.getSnapshot().tasks['next-task'].zoneSlug).toBe('next-zone');
    const internals = repo as unknown as { refs: Refs; reportOf: Map<string, string> };
    expect([...internals.reportOf]).toEqual([['next-task', 'next-report']]);
    oldLoad.resolve();
    await flush();
    expect(repo.getSnapshot().meId).toBe('next');
    expect([...internals.refs.zones]).toEqual([['next-zone', 'next-zone']]);
    expect([...internals.reportOf]).toEqual([['next-task', 'next-report']]);
    repo.resync();
    await flush();
    expect(repo.getSnapshot().status).toBe('ready');
  });
});
