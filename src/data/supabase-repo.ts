import type { RealtimeChannel, RealtimePostgresChangesPayload, Session, SupabaseClient } from '@supabase/supabase-js';

import type { Database } from '@/lib/database.types';
import { applyReply } from '@/lib/lifecycle';
import type { Duty, GuestRequest, Message, Proposal, ReplyKind, Task, TaskEvent, Volunteer } from '@/lib/schema';
import type { BroadcastScope, Heard, Interpretation, Recording, Repo, RespondInput, Snapshot } from './repo';
import {
  DELIVERY_SELECT, PROFILE_SELECT, PROPOSAL_ACTION_SELECT, PROPOSAL_CANDIDATE_SELECT, refsFrom, TASK_SELECT,
  toGuestRequest, toMessage, toProposal, toTask, toTaskEvent, toTeam, toVolunteer, toZone, emptyRefs,
  type DeliveryRow, type ProfileRow, type ProposalActionRow, type ProposalCandidateRow, type Refs, type Row, type TaskRow,
} from './supabase/rows';

type Db = SupabaseClient<Database>;

export type SupabaseRepoOptions = {
  /** The command server (Hono on Bun). Defaults to EXPO_PUBLIC_SERVER_URL, then http://127.0.0.1:8787. */
  serverUrl?: string;
  /** How often `now` moves forward with nothing else changing. Same as the mock's scheduler. */
  tickMs?: number;
  /** For tests. */
  fetch?: typeof fetch;
  /** Realtime join: how long to wait before hydrating anyway (the app works, just not live). */
  subscribeTimeoutMs?: number;
};

/** A command the server refused: `status` is the HTTP status, `message` its `{ error }`. */
export class CommandError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
    this.name = 'CommandError';
  }
}

const DEFAULT_SERVER_URL = 'http://127.0.0.1:8787';
const TICK_MS = 5_000;
const ASSIGNED: Row<'task_assignments'>['status'][] = ['approved', 'notified', 'accepted', 'en_route', 'on_scene', 'done'];

const blank = (status: Snapshot['status']): Snapshot => ({
  status, now: Date.now(), meId: null, guestId: null,
  teams: {}, zones: {}, volunteers: {}, tasks: {}, events: [], messages: [], requests: {}, proposals: {},
});

const without = <T>(record: Record<string, T>, ...ids: string[]) => {
  const next = { ...record };
  for (const id of ids) delete next[id];
  return next;
};

const must = <T>(res: { data: T | null; error: { message: string } | null }, what: string): T => {
  if (res.error) throw new Error(`${what}: ${res.error.message}`);
  return res.data ?? ([] as unknown as T);
};

type Change<T extends keyof Database['public']['Tables']> = RealtimePostgresChangesPayload<Row<T>>;

/**
 * The live Repo. Reads straight from Supabase (RLS decides what this caller sees) and stays fresh over
 * realtime; every command is a POST to the server, which runs the lifecycle in one place.
 *
 * The Supabase client is injected, so the app passes its persisted client and a Bun script can pass one
 * with in-memory auth. The session decides who `meId` is: an anonymous user is the festival-goer.
 */
export class SupabaseRepo implements Repo {
  private state: Snapshot = blank('loading');
  private listeners = new Set<() => void>();
  private refs: Refs = emptyRefs();
  /** task id → report id, so a realtime row (no embed) keeps its reporter unless the report changed. */
  private reportOf = new Map<string, string>();

  private userId: string | null | undefined = undefined;
  private anonymous = false;
  /** Bumped on every session change: async work for an older session drops its result. */
  private gen = 0;
  private channel: RealtimeChannel | null = null;
  private joinTimer: ReturnType<typeof setTimeout> | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private retryMs = 1_000;
  /** Changes that arrive while a hydrate is in flight wait here, then replay on top of it. */
  private hydrating = false;
  private inFlight = false;
  private rehydrate = false;
  private queue: (() => void)[] = [];

  private readonly serverUrl: string;
  private readonly fetch: typeof fetch;
  private readonly subscribeTimeoutMs: number;
  private readonly ticker: ReturnType<typeof setInterval>;
  private readonly authSub: { unsubscribe(): void };

  constructor(private readonly db: Db, opts: SupabaseRepoOptions = {}) {
    this.serverUrl = (opts.serverUrl ?? process.env.EXPO_PUBLIC_SERVER_URL ?? DEFAULT_SERVER_URL).replace(/\/+$/, '');
    this.fetch = opts.fetch ?? ((...args) => fetch(...args));
    this.subscribeTimeoutMs = opts.subscribeTimeoutMs ?? 3_000;
    this.ticker = setInterval(() => {
      if (this.state.status === 'ready') this.set({});
    }, opts.tickMs ?? TICK_MS);
    // Supabase warns against awaiting other client calls inside this callback: defer the work.
    const { data } = db.auth.onAuthStateChange((_event, session) => {
      setTimeout(() => void this.onSession(session), 0);
    });
    this.authSub = data.subscription;
  }

  getSnapshot = () => this.state;

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  /** Re-read everything, e.g. when the app comes back to the foreground. */
  resync() {
    if (this.userId) void this.hydrate(this.gen);
    if (this.userId && !this.channel) this.connect(this.gen);
  }

  /** Stop the clock, realtime and auth listener. For scripts and tests; the app keeps one repo for its lifetime. */
  async dispose() {
    clearInterval(this.ticker);
    this.authSub.unsubscribe();
    this.gen++;
    await this.disconnect();
  }

  // ── volunteer commands ──

  async reply(taskId: string, reply: ReplyKind, note?: string) {
    // Accept is a button that flips straight away in the UI: show it now, the server confirms over realtime.
    const task = this.state.tasks[taskId];
    const t = reply === 'accept' && task ? applyReply(task, 'accept', Date.now()) : null;
    if (t) this.set({ tasks: { ...this.state.tasks, [taskId]: t.task } });
    await this.command('reply', { taskId, reply, note }, () => this.refetchTasks([taskId]));
  }

  async setDuty(duty: Duty) {
    const me = this.state.meId ? this.state.volunteers[this.state.meId] : undefined;
    if (me) this.set({ volunteers: { ...this.state.volunteers, [me.id]: { ...me, duty } } });
    await this.command('setDuty', { duty }, () => (me ? this.refetchVolunteers([me.id]) : undefined));
  }

  /** Multipart: the clip goes up as a file, so a phone on 4G sends kilobytes, not base64. */
  async transcribe(recording: Recording) {
    const form = new FormData();
    form.append('audio', recording.audio, recording.name);
    return this.send<Heard>('transcribe', form);
  }

  async speechUrl(path: string) {
    const { data, error } = await this.db.storage.from('speech').createSignedUrl(path, 300);
    if (error || !data) throw new Error(`speech ${path}: ${error?.message ?? 'no url'}`);
    return data.signedUrl;
  }

  interpret(text: string) {
    return this.post<Interpretation>('interpret', { text });
  }

  commit(interpretation: Interpretation) {
    return this.post<{ confirmation: string }>('commit', { interpretation });
  }

  async markRead(messageIds: string[]) {
    const ids = new Set(messageIds);
    if (!this.state.messages.some((m) => ids.has(m.id) && !m.read)) return;
    this.set({ messages: this.state.messages.map((m) => (ids.has(m.id) ? { ...m, read: true } : m)) });
    await this.command('markRead', { messageIds }, () => this.refetchMessages(messageIds));
  }

  async guestReply(taskId: string, text: string) {
    await this.post('guestReply', { taskId, text });
  }

  // ── leads and Mo ──

  async respond(taskId: string, response: RespondInput) {
    await this.post('respond', { taskId, response });
  }

  async passToCoordinator(taskId: string) {
    await this.post('passToCoordinator', { taskId });
  }

  async arrived(taskId: string) {
    await this.post('arrived', { taskId });
  }

  async assign(taskId: string, volunteerId: string) {
    await this.post('assign', { taskId, volunteerId });
  }

  async approve(proposalId: string, volunteerId?: string) {
    await this.post('approve', { proposalId, volunteerId });
  }

  async broadcast(body: string, scope?: BroadcastScope) {
    await this.post('broadcast', { body, scope });
  }

  async sendDirect(volunteerId: string, body: string) {
    await this.post('sendDirect', { volunteerId, body });
  }

  // ── festival-goer ──

  async guestAsk(text: string, zoneSlug: string | null, locationHint?: string | null, clips?: string[]) {
    const { requestId } = await this.post<{ requestId: string }>('guestAsk', { text, zoneSlug, locationHint, clips: clips?.length ? clips : undefined });
    // The screen opens the request straight away: make sure it's here before saying where it is.
    if (!this.state.requests[requestId]) await this.refetchRequests([requestId]);
    return requestId;
  }

  async guestRequestHuman(requestId: string) {
    await this.post('guestRequestHuman', { requestId });
  }

  guestAddDetail(requestId: string, text: string) {
    return this.post<{ escalated: boolean }>('guestAddDetail', { requestId, text });
  }

  async guestCancel(requestId: string) {
    await this.post('guestCancel', { requestId });
  }

  async guestReopen(requestId: string) {
    await this.post('guestReopen', { requestId });
  }

  // ── commands: POST /api/<method> ──

  private post<T = Record<string, never>>(method: string, body: Record<string, unknown>): Promise<T> {
    return this.send<T>(method, JSON.stringify(body), { 'content-type': 'application/json' });
  }

  private async send<T>(method: string, body: string | FormData, headers: Record<string, string> = {}): Promise<T> {
    const { data } = await this.db.auth.getSession();
    const token = data.session?.access_token;
    if (!token) throw new CommandError(401, 'unauthenticated');
    let res: Response;
    try {
      res = await this.fetch(`${this.serverUrl}/api/${method}`, {
        method: 'POST',
        headers: { ...headers, authorization: `Bearer ${token}` },
        body,
      });
    } catch (e) {
      throw new CommandError(0, `server unreachable: ${e instanceof Error ? e.message : String(e)}`);
    }
    const json = (await res.json().catch(() => null)) as (T & { error?: unknown }) | null;
    if (!res.ok) {
      const error = json?.error;
      throw new CommandError(res.status, typeof error === 'string' ? error : error ? JSON.stringify(error) : res.statusText);
    }
    return (json ?? {}) as T;
  }

  /** A command with an optimistic change: on failure, put back what the database says, then rethrow. */
  private async command(method: string, body: Record<string, unknown>, rollback: () => Promise<void> | void) {
    try {
      await this.post(method, body);
    } catch (e) {
      await Promise.resolve(rollback()).catch(() => {});
      throw e;
    }
  }

  // ── session ──

  private async onSession(session: Session | null) {
    const uid = session?.user.id ?? null;
    if (uid === this.userId) return; // token refresh: supabase-js hands realtime the new token itself
    this.userId = uid;
    this.anonymous = !!session?.user.is_anonymous;
    const gen = ++this.gen;
    this.queue = [];
    this.reportOf.clear();
    await this.disconnect();
    if (gen !== this.gen) return;
    if (!uid) {
      this.state = blank('ready');
      this.emit();
      return;
    }
    this.state = blank('loading');
    this.emit();
    this.connect(gen);
  }

  // ── realtime ──

  private connect(gen: number) {
    const uid = this.userId;
    if (!uid) return;
    this.hydrating = true;
    const pg = <T extends keyof Database['public']['Tables']>(table: T, handle: (p: Change<T>) => void, filter?: string) =>
      (channel: RealtimeChannel) =>
        channel.on<Row<T>>(
          'postgres_changes',
          { event: '*', schema: 'public', table, ...(filter ? { filter } : {}) },
          (p) => this.receive(gen, () => handle(p as Change<T>)),
        );

    // Every table the phone reads that's in the supabase_realtime publication, minus presence (phase 5)
    // and shift_assignments (not in the snapshot). `messages` arrive through the caller's own deliveries.
    let channel = this.db.channel(`repo:${uid}:${gen}`, { config: { postgres_changes_options: { wait: true } } });
    for (const add of [
      pg('tasks', (p) => this.onTask(p)),
      pg('task_assignments', (p) => this.onAssignment(p)),
      pg('task_events', (p) => this.onEvent(p)),
      pg('agent_actions', (p) => this.onAction(p)),
      pg('message_deliveries', (p) => this.onDelivery(p), `recipient_id=eq.${uid}`),
      pg('guest_requests', (p) => this.onRequest(p)),
      pg('profiles', (p) => this.onProfile(p)),
    ]) channel = add(channel);
    // The join reply only says the channel is open. The server confirms the Postgres side separately
    // ("Subscribed to PostgreSQL"), on every join and rejoin. Changes before that are lost, so that's
    // when to (re)read everything: nothing falls between the read and the first change.
    let live = false;
    channel = channel.on('system', {}, (p: { extension?: string; status?: string; message?: string }) => {
      if (gen !== this.gen || channel !== this.channel || p.extension !== 'postgres_changes') return;
      if (p.status === 'ok') {
        live = true;
        this.retryMs = 1_000;
        void this.hydrate(gen);
      } else {
        console.warn('[SupabaseRepo] realtime postgres_changes', p.message);
        this.scheduleReconnect(gen);
      }
    });
    this.channel = channel;

    // If realtime is slow or down, hydrate anyway after a moment: the app works, just not live.
    this.joinTimer = setTimeout(() => {
      if (!live && gen === this.gen) void this.hydrate(gen);
    }, this.subscribeTimeoutMs);

    channel.subscribe((status, err) => {
      if (gen !== this.gen || channel !== this.channel) return;
      if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
        live = false;
        if (err) console.warn(`[SupabaseRepo] realtime ${status}`, err);
        // realtime-js rejoins errored channels itself; a closed one we rebuild.
        if (status === 'CLOSED') this.scheduleReconnect(gen);
      }
    });
  }

  private scheduleReconnect(gen: number) {
    if (this.retryTimer) return;
    this.retryTimer = setTimeout(async () => {
      this.retryTimer = null;
      if (gen !== this.gen) return;
      await this.disconnect();
      if (gen === this.gen) this.connect(gen);
    }, this.retryMs);
    this.retryMs = Math.min(this.retryMs * 2, 30_000);
  }

  private async disconnect() {
    if (this.joinTimer) clearTimeout(this.joinTimer);
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.joinTimer = this.retryTimer = null;
    const channel = this.channel;
    this.channel = null;
    if (channel) await this.db.removeChannel(channel).catch(() => {});
  }

  /** Apply a change now, or after the hydrate in flight lands on top of it. */
  private receive(gen: number, apply: () => void) {
    if (gen !== this.gen) return;
    if (this.hydrating) this.queue.push(apply);
    else apply();
  }

  // ── hydrate ──

  private async hydrate(gen: number) {
    if (this.inFlight) {
      this.rehydrate = true;
      return;
    }
    this.inFlight = true;
    this.hydrating = true;
    try {
      do {
        this.rehydrate = false;
        const next = await this.load();
        if (gen !== this.gen) return;
        this.state = next;
      } while (this.rehydrate);
      this.hydrating = false;
      const queued = this.queue;
      this.queue = [];
      for (const apply of queued) apply();
      this.emit();
    } catch (e) {
      if (gen !== this.gen) return;
      console.warn('[SupabaseRepo] hydrate failed', e);
      this.hydrating = false;
      if (this.state.status !== 'ready') this.set({ status: 'error' });
      // Try again shortly: a flaky connection on the oval shouldn't strand the app on "error".
      setTimeout(() => {
        if (gen === this.gen) void this.hydrate(gen);
      }, 3_000);
    } finally {
      if (gen === this.gen) this.inFlight = false;
    }
  }

  /** Everything this caller can read, as one snapshot. RLS decides the contents per role. */
  private async load(): Promise<Snapshot> {
    const uid = this.userId!;
    const db = this.db;
    const [teams, zones, profiles, skills, contacts, tasks, events, deliveries, requests, actions, candidates] = await Promise.all([
      db.from('teams').select('id, slug, name, color'),
      db.from('zones').select('id, slug, name'),
      db.from('profiles').select(PROFILE_SELECT),
      db.from('volunteer_skills').select('volunteer_id, skill:skills!volunteer_skills_skill_id_fkey(slug)'),
      db.from('profile_private').select('id, phone'),
      db.from('tasks').select(TASK_SELECT),
      db.from('task_events').select('*').order('created_at'),
      db.from('message_deliveries').select(DELIVERY_SELECT).eq('recipient_id', uid),
      db.from('guest_requests').select('*'),
      db.from('agent_actions').select(PROPOSAL_ACTION_SELECT).eq('type', 'assign_volunteer'),
      db.from('task_assignments').select(PROPOSAL_CANDIDATE_SELECT),
    ]);

    const teamRows = must(teams, 'teams');
    const zoneRows = must(zones, 'zones');
    this.refs = refsFrom(teamRows, zoneRows);

    const skillsBy = new Map<string, string[]>();
    for (const s of must(skills, 'volunteer_skills') as { volunteer_id: string; skill: { slug: string } | null }[]) {
      if (s.skill) skillsBy.set(s.volunteer_id, [...(skillsBy.get(s.volunteer_id) ?? []), s.skill.slug]);
    }
    const phoneBy = new Map(must(contacts, 'profile_private').map((c) => [c.id, c.phone]));
    const volunteers = Object.fromEntries((must(profiles, 'profiles') as ProfileRow[]).map((p) => [
      p.id, toVolunteer(p, this.refs, { skills: skillsBy.get(p.id), phone: phoneBy.get(p.id) ?? null }),
    ]));

    const taskRows = must(tasks, 'tasks') as unknown as TaskRow[];
    this.reportOf = new Map(taskRows.map((t) => [t.id, t.report_id]));
    const assignmentRows = must(candidates, 'task_assignments') as ProposalCandidateRow[];
    const meId = uid;

    return {
      status: 'ready',
      now: Date.now(),
      meId,
      guestId: this.anonymous ? meId : null,
      teams: Object.fromEntries(teamRows.map((t) => [t.slug, toTeam(t)])),
      zones: Object.fromEntries(zoneRows.map((z) => [z.slug, toZone(z)])),
      volunteers,
      tasks: Object.fromEntries(taskRows.map((t) => [t.id, toTask(t, this.refs)])),
      events: must(events, 'task_events').map((e) => this.event(e, volunteers)),
      messages: (must(deliveries, 'message_deliveries') as unknown as DeliveryRow[])
        .map(toMessage).filter((m): m is Message => !!m),
      requests: Object.fromEntries(must(requests, 'guest_requests').map((r) => [r.id, toGuestRequest(r, this.refs)])),
      proposals: Object.fromEntries((must(actions, 'agent_actions') as ProposalActionRow[]).map((a) => {
        const p = this.proposal(a, assignmentRows, taskRows.find((t) => t.id === a.task_id)?.assignee_id ?? null);
        return [p.id, p];
      })),
    };
  }

  private event(row: Row<'task_events'>, volunteers = this.state.volunteers): TaskEvent {
    return toTaskEvent(row, row.actor_id ? volunteers[row.actor_id]?.name : undefined);
  }

  /** Who got a decided proposal: the assignment that went ahead, else whoever owns the task now. */
  private proposal(action: ProposalActionRow, assignments: ProposalCandidateRow[], taskAssignee: string | null): Proposal {
    const taken = assignments
      .filter((a) => a.task_id === action.task_id && ASSIGNED.includes(a.status))
      .sort((a, b) => a.created_at.localeCompare(b.created_at))[0];
    return toProposal(action, assignments, taken?.volunteer_id ?? taskAssignee);
  }

  // ── refetch: where patching from the change alone isn't enough ──

  /** Re-read tasks with their reports. Any the caller can no longer see leave the snapshot. */
  private async refetchTasks(ids: string[]) {
    if (!ids.length) return;
    const gen = this.gen;
    const rows = must(await this.db.from('tasks').select(TASK_SELECT).in('id', ids), 'tasks') as unknown as TaskRow[];
    if (gen !== this.gen) return;
    const tasks = without(this.state.tasks, ...ids);
    for (const row of rows) {
      this.reportOf.set(row.id, row.report_id);
      tasks[row.id] = toTask(row, this.refs);
    }
    const gone = new Set(ids.filter((id) => !tasks[id]));
    this.set({
      tasks,
      ...(gone.size ? { events: this.state.events.filter((e) => !gone.has(e.taskId)) } : {}),
    });
    await this.ensurePeople(rows.map((r) => toTask(r, this.refs)));
  }

  /** A festival-goer only sees who's helping them once they're on the task: fetch them as they appear. */
  private async ensurePeople(tasks: Task[]) {
    const missing = [...new Set(tasks.flatMap((t) => [t.assigneeId, ...t.helperIds]))]
      .filter((id): id is string => !!id && !this.state.volunteers[id]);
    if (missing.length) await this.refetchVolunteers(missing);
  }

  private async refetchVolunteers(ids: string[]) {
    const gen = this.gen;
    const [profiles, skills, contacts] = await Promise.all([
      this.db.from('profiles').select(PROFILE_SELECT).in('id', ids),
      this.db.from('volunteer_skills').select('volunteer_id, skill:skills!volunteer_skills_skill_id_fkey(slug)').in('volunteer_id', ids),
      this.db.from('profile_private').select('id, phone').in('id', ids),
    ]);
    if (gen !== this.gen) return;
    const skillsBy = new Map<string, string[]>();
    for (const s of must(skills, 'volunteer_skills') as { volunteer_id: string; skill: { slug: string } | null }[]) {
      if (s.skill) skillsBy.set(s.volunteer_id, [...(skillsBy.get(s.volunteer_id) ?? []), s.skill.slug]);
    }
    const phoneBy = new Map(must(contacts, 'profile_private').map((c) => [c.id, c.phone]));
    const volunteers = without(this.state.volunteers, ...ids);
    for (const p of must(profiles, 'profiles') as ProfileRow[]) {
      volunteers[p.id] = toVolunteer(p, this.refs, { skills: skillsBy.get(p.id), phone: phoneBy.get(p.id) ?? null });
    }
    this.set({ volunteers });
  }

  private async refetchMessages(messageIds: string[]) {
    if (!this.userId || !messageIds.length) return;
    const gen = this.gen;
    const rows = must(
      await this.db.from('message_deliveries').select(DELIVERY_SELECT).eq('recipient_id', this.userId).in('message_id', messageIds),
      'message_deliveries',
    ) as unknown as DeliveryRow[];
    if (gen !== this.gen) return;
    const fresh = new Map(rows.map(toMessage).filter((m): m is Message => !!m).map((m) => [m.id, m]));
    const ids = new Set(messageIds);
    const kept = this.state.messages.filter((m) => !ids.has(m.id));
    this.set({ messages: [...kept, ...fresh.values()] });
  }

  private async refetchRequests(ids: string[]) {
    const gen = this.gen;
    const rows = must(await this.db.from('guest_requests').select('*').in('id', ids), 'guest_requests');
    if (gen !== this.gen) return;
    const requests = without(this.state.requests, ...ids);
    for (const r of rows) requests[r.id] = toGuestRequest(r, this.refs);
    this.set({ requests });
    await this.ensureTasksFor(Object.values(requests).filter((r) => ids.includes(r.id)));
  }

  /** A request just got its task: the festival-goer can read it from now on. */
  private async ensureTasksFor(requests: GuestRequest[]) {
    const missing = requests.map((r) => r.taskId).filter((id): id is string => !!id && !this.state.tasks[id]);
    if (missing.length) await this.refetchTasks(missing);
  }

  /** Proposals for some tasks (or by action id), with their candidates. Staff only: RLS returns nothing to anyone else. */
  private async refetchProposals(by: { taskIds?: string[]; actionIds?: string[] }) {
    const gen = this.gen;
    let q = this.db.from('agent_actions').select(PROPOSAL_ACTION_SELECT).eq('type', 'assign_volunteer');
    if (by.taskIds) q = q.in('task_id', by.taskIds);
    if (by.actionIds) q = q.in('id', by.actionIds);
    const actions = must(await q, 'agent_actions') as ProposalActionRow[];
    const taskIds = [...new Set([...(by.taskIds ?? []), ...actions.map((a) => a.task_id).filter((id): id is string => !!id)])];
    const assignments = taskIds.length
      ? must(await this.db.from('task_assignments').select(PROPOSAL_CANDIDATE_SELECT).in('task_id', taskIds), 'task_assignments') as ProposalCandidateRow[]
      : [];
    if (gen !== this.gen) return;
    const stale = Object.values(this.state.proposals)
      .filter((p) => by.actionIds?.includes(p.id) || by.taskIds?.includes(p.taskId))
      .map((p) => p.id);
    const proposals = without(this.state.proposals, ...stale);
    for (const a of actions) proposals[a.id] = this.proposal(a, assignments, a.task_id ? this.state.tasks[a.task_id]?.assigneeId ?? null : null);
    this.set({ proposals });
  }

  // ── realtime handlers ──

  private onTask(p: Change<'tasks'>) {
    if (p.eventType === 'DELETE') {
      const id = p.old.id;
      if (!id) return;
      this.reportOf.delete(id);
      this.set({
        tasks: without(this.state.tasks, id),
        events: this.state.events.filter((e) => e.taskId !== id),
        proposals: Object.fromEntries(Object.entries(this.state.proposals).filter(([, x]) => x.taskId !== id)),
      });
      return;
    }
    const row = p.new;
    const known = this.state.tasks[row.id];
    if (!known || this.reportOf.get(row.id) !== row.report_id) {
      void this.refetchTasks([row.id]).catch(warn('task'));
      return;
    }
    const task = toTask(row, this.refs, known.reporter);
    this.set({ tasks: { ...this.state.tasks, [row.id]: task } });
    void this.ensurePeople([task]).catch(warn('people'));
  }

  private onAssignment(p: Change<'task_assignments'>) {
    const row = p.eventType === 'DELETE' ? p.old : p.new;
    const me = this.state.meId ? this.state.volunteers[this.state.meId] : undefined;
    const staff = !!me && me.role !== 'volunteer';
    if (staff) {
      // A delete only carries the primary key: re-read every proposal rather than guess which task it was.
      void this.refetchProposals(row.task_id ? { taskIds: [row.task_id] } : {}).catch(warn('proposals'));
    }
    // Being proposed for, or taken off, a task changes whether a volunteer can see it.
    if (row.task_id && row.volunteer_id === this.state.meId) void this.refetchTasks([row.task_id]).catch(warn('task'));
  }

  private onEvent(p: Change<'task_events'>) {
    if (p.eventType === 'DELETE') {
      if (p.old.id) this.set({ events: this.state.events.filter((e) => e.id !== p.old.id) });
      return;
    }
    const event = this.event(p.new);
    const events = this.state.events.filter((e) => e.id !== event.id);
    this.set({ events: [...events, event] });
  }

  private onAction(p: Change<'agent_actions'>) {
    if (p.eventType === 'DELETE') {
      if (p.old.id) this.set({ proposals: without(this.state.proposals, p.old.id) });
      return;
    }
    if (p.new.type !== 'assign_volunteer') return;
    void this.refetchProposals({ actionIds: [p.new.id] }).catch(warn('proposal'));
  }

  private onDelivery(p: Change<'message_deliveries'>) {
    if (p.eventType === 'DELETE') {
      const id = p.old.message_id;
      if (id) this.set({ messages: this.state.messages.filter((m) => m.id !== id) });
      return;
    }
    const row = p.new;
    if (row.recipient_id !== this.state.meId) return;
    const known = this.state.messages.find((m) => m.id === row.message_id);
    if (!known) {
      // The message itself only becomes readable once this delivery exists, so fetch it now.
      void this.refetchMessages([row.message_id]).catch(warn('message'));
      return;
    }
    const delivery = row.delivery === 'spoken' || row.delivery === 'ping' ? row.delivery : undefined;
    // The spoken version lands a moment after the message: that's this update.
    const next: Message = {
      ...known, read: row.read_at !== null, ...(row.body_local ? { body: row.body_local } : {}), ...(row.audio_path ? { audio: row.audio_path } : {}),
    };
    if (delivery) next.delivery = delivery;
    else delete next.delivery;
    this.set({ messages: this.state.messages.map((m) => (m.id === next.id ? next : m)) });
  }

  private onRequest(p: Change<'guest_requests'>) {
    if (p.eventType === 'DELETE') {
      if (p.old.id) this.set({ requests: without(this.state.requests, p.old.id) });
      return;
    }
    const row = p.new;
    if (!Array.isArray(row.thread)) {
      // A large thread can arrive without its value: read the row instead.
      void this.refetchRequests([row.id]).catch(warn('request'));
      return;
    }
    const request = toGuestRequest(row, this.refs);
    this.set({ requests: { ...this.state.requests, [request.id]: request } });
    void this.ensureTasksFor([request]).catch(warn('task'));
  }

  private onProfile(p: Change<'profiles'>) {
    if (p.eventType === 'DELETE') {
      if (p.old.id) this.set({ volunteers: without(this.state.volunteers, p.old.id) });
      return;
    }
    const row = p.new;
    const known: Volunteer | undefined = this.state.volunteers[row.id];
    if (!known) {
      void this.refetchVolunteers([row.id]).catch(warn('volunteer'));
      return;
    }
    // Skills and phone live in other tables: keep what we have.
    const v = toVolunteer(row, this.refs, { skills: known.skills, phone: known.phone });
    this.set({ volunteers: { ...this.state.volunteers, [v.id]: v } });
  }

  // ── plumbing ──

  private set(patch: Partial<Snapshot>) {
    this.state = { ...this.state, ...patch, now: Date.now() };
    // While a hydrate is in flight the screen keeps the last full snapshot; it emits once that lands.
    if (!this.hydrating || this.state.status !== 'loading') this.emit();
  }

  private emit() {
    this.listeners.forEach((l) => l());
  }
}

const warn = (what: string) => (e: unknown) => console.warn(`[SupabaseRepo] refresh ${what} failed`, e);
