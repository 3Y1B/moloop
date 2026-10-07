import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Task } from '@/lib/schema';
import { SparkInterpreter } from './interpreter';

const keys = ['OPENAI_API_KEY', 'MODEL_PROVIDER', 'SPARK_BASE_URL', 'SPARK_API_KEY'];
beforeEach(() => { for (const key of keys) vi.stubEnv(key, undefined); });
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe('multi-person interpretation (offline decisions)', () => {
  const task = (helperStatus: 'notified' | 'accepted'): Task => ({
    id: 'task', title: 'Assess heat symptoms', summary: 'Known heat concern', category: 'heat', priority: 'P2', teamSlug: 'first-aid',
    zoneSlug: null, locationHint: null, status: 'accepted', assigneeId: 'owner', reporter: { kind: 'system', quote: 'Test', language: 'en' },
    handledBy: 'human', createdAt: 0, assignedAt: 0, etaAt: null, lastActivityAt: 0, nudgeCount: 0, lastNudgeAt: null,
    leadAlertedAt: null, resolvedAt: null, escalation: null, requiredCount: 2,
    helpers: [{ volunteerId: 'helper', status: helperStatus, assignedAt: 0, respondedAt: null }],
    resolution: null, requestId: null, mobilizationId: null,
  });
  it.each(['accept', 'decline'] as const)('lets a notified helper %s independently of the accepted owner', async (kind) => {
    vi.stubEnv('OPENAI_API_KEY', 'test-only');
    vi.stubGlobal('fetch', async () => new Response(JSON.stringify({ answers: [{ type: 'choice', name: 'kind', choice: kind,
      probabilities: [{ value: kind, probability: 0.99 }], confidence: 0.99 }] }), { status: 200 }));
    const result = await new SparkInterpreter().interpret({ tasks: [task('notified')], meId: 'helper', text: kind === 'accept' ? 'on my way' : "I cannot take it" });
    expect(result.intent).toEqual({ kind: 'reply', taskId: 'task', reply: kind });
  });

  it.each([
    ['notified', 'done', 'report'], ['accepted', 'accept', 'report'],
    ['accepted', 'done', 'reply'], ['accepted', 'need_help', 'report'],
  ] as const)('keeps a %s helper reply %s within their assignment permissions', async (status, kind, intentKind) => {
    vi.stubEnv('OPENAI_API_KEY', 'test-only');
    vi.stubGlobal('fetch', async () => new Response(JSON.stringify({ answers: [{ type: 'choice', name: 'kind', choice: kind,
      probabilities: [{ value: kind, probability: 0.99 }], confidence: 0.99 }] }), { status: 200 }));
    const result = await new SparkInterpreter().interpret({ tasks: [task(status)], meId: 'helper', text: kind });
    expect(result.intent.kind).toBe(intentKind);
    if (intentKind === 'reply') expect(result.intent).toEqual({ kind: 'reply', taskId: 'task', reply: kind });
  });
});
