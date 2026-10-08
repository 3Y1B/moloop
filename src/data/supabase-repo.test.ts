import type { SupabaseClient } from '@supabase/supabase-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Database } from '@/lib/database.types';
import type { Task } from '@/lib/schema';
import { CommandError, SupabaseRepo } from './supabase-repo';

const NOW = 1_800_000_000_000;
const repos: SupabaseRepo[] = [];

function task(over: Partial<Task> = {}): Task {
  return {
    id: 'response-task', title: 'Refill water', summary: 'Refill the station.',
    category: 'facilities', priority: 'P2', teamSlug: 'first-aid', zoneSlug: 'water-1', locationHint: null,
    status: 'assigned', assigneeId: 'owner',
    reporter: { kind: 'system', quote: '', language: 'en' }, handledBy: 'human',
    createdAt: NOW - 2_000, assignedAt: NOW - 1_000, etaAt: null, lastActivityAt: NOW - 1_000,
    nudgeCount: 0, lastNudgeAt: null, leadAlertedAt: null, resolvedAt: null, escalation: null,
    requiredCount: 2, helpers: [{ volunteerId: 'helper', status: 'notified', assignedAt: NOW - 1_000, respondedAt: null }],
    resolution: null, requestId: null, mobilizationId: 'mobilization', ...over,
  };
}

/** Transport-only client: no credentials, network, Supabase rows, or model calls. */
function repoFor(actorId: string, initial: Task, response = Response.json({})) {
  const db = {
    auth: {
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
      getSession: async () => ({ data: { session: { access_token: 'test-token' } } }),
    },
  } as unknown as SupabaseClient<Database>;
  const send = vi.fn<(input: unknown, init?: unknown) => Promise<Response>>().mockResolvedValue(response);
  const repo = new SupabaseRepo(db, { fetch: send });
  // Inject a hydrated snapshot; hydration and RLS are covered by scripts/check-repo.ts.
  Object.assign(repo, { state: { ...repo.getSnapshot(), status: 'ready', meId: actorId, tasks: { [initial.id]: initial } } });
  repos.push(repo);
  return { repo, send };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});

afterEach(async () => {
  for (const repo of repos.splice(0)) await repo.dispose();
  vi.useRealTimers();
});

describe('SupabaseRepo forwards merged command contracts', () => {
  it('does not expose the retired immediately-active mobilization creation bypass', () => {
    const { repo } = repoFor('mo', task());
    expect('create' in repo.mobilizations).toBe(false);
  });

  it('forwards named helpers to manual assign and ordinary proposal approval', async () => {
    const { repo, send } = repoFor('mo', task());
    await repo.assign('manual-task', 'owner', ['helper']);
    await repo.approve('ordinary-proposal', undefined, ['helper']);
    expect(JSON.parse(String((send.mock.calls[0][1] as RequestInit).body))).toEqual({
      taskId: 'manual-task', volunteerId: 'owner', helperIds: ['helper'],
    });
    expect(JSON.parse(String((send.mock.calls[1][1] as RequestInit).body))).toEqual({
      proposalId: 'ordinary-proposal', helperIds: ['helper'],
    });
  });

  it('preserves the read-only voice response result contract', async () => {
    const response = { done: false, open: '000' as const };
    const { repo, send } = repoFor('mo', task(), Response.json(response));
    await expect(repo.respondByVoice('response-task', 'Call an ambulance')).resolves.toEqual(response);
    expect(JSON.parse(String((send.mock.calls[0][1] as RequestInit).body))).toEqual({
      taskId: 'response-task', text: 'Call an ambulance',
    });
  });

  it('forwards the exact reviewed analysis and explicit gap acknowledgement', async () => {
    const { repo, send } = repoFor('mo', task());
    await repo.mobilizations.approve('plan', { reviewedRunId: 'reviewed-run', acknowledgeGaps: true });
    expect(JSON.parse(String((send.mock.calls[0][1] as RequestInit).body))).toEqual({
      mobilizationId: 'plan', reviewedRunId: 'reviewed-run', acknowledgeGaps: true,
    });
  });

  it('keeps manual situation analysis and polling on the shared server', async () => {
    const result = { runId: 'run', status: 'running', mobilizationIds: [] };
    const { repo, send } = repoFor('mo', task(), Response.json(result));
    const input = {
      requestId: 'scenario-test',
      weather: { temperatureC: 41, trendCPerHour: null, condition: 'clear' as const,
        warning: 'heat' as const, warningInMinutes: null },
      upcomingSets: [], crowdByZone: [], recentIncidents: [], observations: [],
    };
    await expect(repo.mobilizations.simulate(input)).resolves.toEqual(result);
    // Each HTTP response has its own body, as a real transport does.
    send.mockResolvedValueOnce(Response.json(result));
    await expect(repo.mobilizations.getRun('run')).resolves.toEqual(result);
    expect(send.mock.calls.map(([url]) => String(url))).toEqual([
      'http://127.0.0.1:8787/api/simulateMobilization', 'http://127.0.0.1:8787/api/getMobilizationRun',
    ]);
    expect(JSON.parse(String((send.mock.calls[0][1] as RequestInit).body))).toEqual(input);
    expect(JSON.parse(String((send.mock.calls[1][1] as RequestInit).body))).toEqual({ runId: 'run' });
    expect(repo.getSnapshot().tasks['response-task'].requiredCount).toBe(2);
  });

  it('keeps Mo playbook revisions and optimistic publication tokens', async () => {
    const version = { id: 'draft', version: 4, status: 'draft' };
    const { repo, send } = repoFor('mo', task(), Response.json({ playbooks: [version] }));
    await expect(repo.playbooks.list()).resolves.toEqual([version]);
    send.mockResolvedValueOnce(Response.json({ playbook: version }));
    await expect(repo.playbooks.revise('published')).resolves.toEqual(version);
    send.mockResolvedValueOnce(Response.json({ playbook: { ...version, status: 'published' } }));
    await repo.playbooks.publish('draft', '2026-10-08T00:00:00.123456+00:00');
    expect(send.mock.calls.map(([url]) => String(url))).toEqual([
      'http://127.0.0.1:8787/api/playbooks/list', 'http://127.0.0.1:8787/api/playbooks/revise',
      'http://127.0.0.1:8787/api/playbooks/publish',
    ]);
    expect(JSON.parse(String((send.mock.calls[2][1] as RequestInit).body))).toEqual({
      id: 'draft', expectedUpdatedAt: '2026-10-08T00:00:00.123456+00:00',
    });
  });
});

describe('SupabaseRepo optimistic Accept', () => {
  it('updates only the helper slot when the owner has not replied', async () => {
    const initial = task();
    const { repo, send } = repoFor('helper', initial);

    const pending = repo.reply(initial.id, 'accept');
    const next = repo.getSnapshot().tasks[initial.id];
    expect(next.status).toBe('assigned');
    expect(next.assigneeId).toBe('owner');
    expect(next.etaAt).toBeNull();
    expect(next.helpers[0]).toMatchObject({ status: 'accepted', respondedAt: NOW });
    expect(initial.helpers[0].status).toBe('notified');
    await pending;
    const sent = send.mock.calls[0][1] as RequestInit;
    expect(JSON.parse(String(sent.body))).toEqual({ taskId: initial.id, reply: 'accept' });
  });

  it('updates the helper immediately even when the owner is already accepted', async () => {
    const initial = task({ status: 'accepted', etaAt: NOW + 60_000 });
    const { repo } = repoFor('helper', initial);
    const pending = repo.reply(initial.id, 'accept');

    expect(repo.getSnapshot().tasks[initial.id]).toMatchObject({
      status: 'accepted', etaAt: initial.etaAt, lastActivityAt: initial.lastActivityAt,
      helpers: [{ volunteerId: 'helper', status: 'accepted', respondedAt: NOW }],
    });
    await pending;
  });

  it('preserves the owner transition without accepting helpers for them', async () => {
    const initial = task();
    const { repo } = repoFor('owner', initial);
    const pending = repo.reply(initial.id, 'accept');

    expect(repo.getSnapshot().tasks[initial.id]).toMatchObject({ status: 'accepted', lastActivityAt: NOW });
    expect(repo.getSnapshot().tasks[initial.id].etaAt).toBeGreaterThan(NOW);
    expect(repo.getSnapshot().tasks[initial.id].helpers).toEqual(initial.helpers);
    await pending;
  });

  it('does not optimistically accept on behalf of someone unrelated to the task', async () => {
    const initial = task();
    const { repo } = repoFor('unrelated', initial);
    const pending = repo.reply(initial.id, 'accept');

    expect(repo.getSnapshot().tasks[initial.id]).toBe(initial);
    await pending;
  });

  it('refetches authoritative state and rethrows when a helper Accept fails', async () => {
    const initial = task();
    const { repo } = repoFor('helper', initial, Response.json({ error: 'task_changed' }, { status: 409 }));
    const authoritative = task({ summary: 'Updated on the server.' });
    const refetch = vi.spyOn(repo as unknown as { refetchTasks(ids: string[]): Promise<void> }, 'refetchTasks')
      .mockImplementation(async () => {
        Object.assign(repo, { state: { ...repo.getSnapshot(), tasks: { [authoritative.id]: authoritative } } });
      });

    const pending = repo.reply(initial.id, 'accept');
    expect(repo.getSnapshot().tasks[initial.id].helpers[0].status).toBe('accepted');
    await expect(pending).rejects.toBeInstanceOf(CommandError);
    await expect(pending).rejects.toMatchObject({ status: 409, message: 'task_changed' });
    expect(refetch).toHaveBeenCalledWith([initial.id]);
    expect(repo.getSnapshot().tasks[initial.id]).toBe(authoritative);
    expect(repo.getSnapshot().tasks[initial.id].helpers[0].status).toBe('notified');
  });
});
