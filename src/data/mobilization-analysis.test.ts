import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { SimulationInput, SimulationRunResult } from '@/lib/mobilization-contracts';

import { MobilizationAnalysisStore } from './mobilization-analysis';

const input = (requestId = 'scenario-test-request-01'): SimulationInput => ({
  requestId,
  weather: { temperatureC: 41, trendCPerHour: null, condition: 'clear', warning: 'heat', warningInMinutes: 0 },
  upcomingSets: [], crowdByZone: [], recentIncidents: [], observations: [],
});
const run = (changes: Partial<SimulationRunResult> = {}): SimulationRunResult => ({
  runId: 'saved-run-01', status: 'running', decision: null, output: null,
  mobilizationIds: [], validationErrors: [], error: null, snapshot: null,
  promptVersion: 'test', model: 'test', createdAt: '2026-10-08T00:00:00Z', ...changes,
});
const complete = (decision: 'propose' | 'no_mobilization' | 'insufficient_data' = 'no_mobilization') =>
  run({ status: 'completed', decision, output: {
    decision,
    assessment: { summary: 'Assessment complete.', severity: 'minor', findings: [], missingInputs: [], playbookAssessments: [] },
    mobilizations: [],
  } });
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (cause: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function fixture() {
  const controls = { simulate: vi.fn<(facts: SimulationInput) => Promise<SimulationRunResult>>(), getRun: vi.fn<(id: string) => Promise<SimulationRunResult>>() };
  controls.simulate.mockResolvedValue(run());
  controls.getRun.mockResolvedValue(complete());
  const store = new MobilizationAnalysisStore(controls, {
    now: () => 1000, newRequestId: () => 'scenario-explicit-retry-02',
  });
  return { controls, store };
}
const flush = () => vi.advanceTimersByTimeAsync(0);
beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('account-owned mobilization analyses', () => {
  it('publishes a placeholder synchronously before calling the server and returns its request key', () => {
    const { controls, store } = fixture();
    const order: string[] = [];
    store.subscribe(() => { const job = store.getSnapshot()[0]; if (job) order.push(job.status); });
    controls.simulate.mockImplementation(() => {
      order.push('submit');
      return new Promise(() => {});
    });
    expect(store.startAnalysis(input(), 'Extreme heat')).toBe('scenario-test-request-01');
    expect(order).toEqual(['running', 'submit']);
    expect(store.getSnapshot()[0]).toMatchObject({ title: 'Extreme heat', startedAt: 1000, result: null, error: null });
    store.dispose();
  });

  it('does not duplicate a rapid double tap or an existing running request', async () => {
    const { controls, store } = fixture();
    const pending = deferred<SimulationRunResult>();
    controls.simulate.mockReturnValue(pending.promise);
    const first = store.startAnalysis(input(), 'Heat');
    expect(store.startAnalysis(input(), 'Heat again')).toBe(first);
    expect(controls.simulate).toHaveBeenCalledTimes(1);
    pending.resolve(run());
    await flush();
    expect(store.startAnalysis(input(), 'Heat again')).toBe(first);
    expect(controls.simulate).toHaveBeenCalledTimes(1);
    expect(store.getSnapshot()).toHaveLength(1);
    store.dispose();
  });

  it('will not replace different facts under an existing idempotency key', () => {
    const { controls, store } = fixture();
    store.startAnalysis(input(), 'Heat');
    const changed = input();
    changed.weather.temperatureC = 20;
    expect(() => store.startAnalysis(changed, 'Cold')).toThrow('different situation');
    expect(controls.simulate).toHaveBeenCalledTimes(1);
    store.dispose();
  });

  it('captures facts independently of later edits in the form', () => {
    const { controls, store } = fixture();
    const facts = input();
    store.startAnalysis(facts, 'Heat');
    facts.weather.temperatureC = 20;
    expect(store.getSnapshot()[0].input.weather.temperatureC).toBe(41);
    expect(controls.simulate.mock.calls[0][0].weather.temperatureC).toBe(41);
    store.dispose();
  });

  it('continues after the submitting screen unsubscribes', async () => {
    const { controls, store } = fixture();
    const unsubscribe = store.subscribe(vi.fn());
    store.startAnalysis(input(), 'Heat');
    unsubscribe();
    await flush();
    await vi.advanceTimersByTimeAsync(1500);
    expect(controls.getRun).toHaveBeenCalledWith('saved-run-01');
    expect(store.getSnapshot()[0].status).toBe('completed');
    store.dispose();
  });

  it('polls sequentially instead of overlapping requests', async () => {
    const { controls, store } = fixture();
    const pending = deferred<SimulationRunResult>();
    controls.getRun.mockReturnValueOnce(pending.promise).mockResolvedValueOnce(complete());
    store.startAnalysis(input(), 'Heat');
    await flush();
    await vi.advanceTimersByTimeAsync(9000);
    expect(controls.getRun).toHaveBeenCalledTimes(1);
    pending.resolve(run());
    await flush();
    await vi.advanceTimersByTimeAsync(1499);
    expect(controls.getRun).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(controls.getRun).toHaveBeenCalledTimes(2);
    expect(store.getSnapshot()[0].status).toBe('completed');
    store.dispose();
  });

  it('treats a failed status check as reconnecting, not a failed analysis or a new model call', async () => {
    const { controls, store } = fixture();
    controls.getRun.mockRejectedValueOnce(new Error('secret JSON { zoneSlug: private }')).mockResolvedValueOnce(complete());
    store.startAnalysis(input(), 'Heat');
    await flush();
    await vi.advanceTimersByTimeAsync(1500);
    expect(store.getSnapshot()[0]).toMatchObject({ status: 'running', error: 'Still checking the saved analysis. Reconnecting…' });
    expect(store.getSnapshot()[0].error).not.toContain('secret');
    await vi.advanceTimersByTimeAsync(1500);
    expect(store.getSnapshot()[0]).toMatchObject({ status: 'completed', error: null });
    expect(controls.simulate).toHaveBeenCalledTimes(1);
    store.dispose();
  });

  it('does not attach a different server run returned by a status check', async () => {
    const { controls, store } = fixture();
    controls.getRun.mockResolvedValue(complete());
    controls.getRun.mockResolvedValueOnce(run({ ...complete(), runId: 'another-run' }));
    store.startAnalysis(input(), 'Heat');
    await flush();
    await vi.advanceTimersByTimeAsync(1500);
    expect(store.getSnapshot()[0]).toMatchObject({ status: 'running', error: 'Still checking the saved analysis. Reconnecting…' });
    expect(store.getSnapshot()[0].result?.runId).toBe('saved-run-01');
    await vi.advanceTimersByTimeAsync(1500);
    expect(store.getSnapshot()[0].status).toBe('completed');
    store.dispose();
  });

  it.each(['no_mobilization', 'insufficient_data', 'propose'] as const)('retains a completed %s result without polling or retrying a model', async (decision) => {
    const { controls, store } = fixture();
    controls.simulate.mockResolvedValue(complete(decision));
    const id = store.startAnalysis(input(), 'Heat');
    await flush();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(store.getAnalysis(id)).toMatchObject({ status: 'completed', result: { decision } });
    expect(controls.getRun).not.toHaveBeenCalled();
    expect(store.retryAnalysis(id)).toBeUndefined();
    expect(controls.simulate).toHaveBeenCalledTimes(1);
    store.dispose();
  });

  it.each(['failed', 'configuration_required'] as const)('retains a genuine %s run and retries only explicitly with a new request key', async (status) => {
    const { controls, store } = fixture();
    controls.simulate.mockResolvedValueOnce(run({ status, error: 'raw provider JSON secret' })).mockResolvedValueOnce(complete());
    const id = store.startAnalysis(input(), 'Heat');
    await flush();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(store.getAnalysis(id)).toMatchObject({ status: 'failed', result: { status } });
    expect(store.getAnalysis(id)?.error).not.toContain('secret');
    expect(controls.simulate).toHaveBeenCalledTimes(1);
    expect(store.retryAnalysis(id)).toBe('scenario-explicit-retry-02');
    expect(controls.simulate.mock.calls[1][0].requestId).not.toBe(id);
    expect(store.getAnalysis(id)).toBeUndefined();
    await flush();
    store.dispose();
  });

  it('displays a safety-check failure without exposing technical validation errors', async () => {
    const { controls, store } = fixture();
    controls.simulate.mockResolvedValue(run({ status: 'failed', validationErrors: ['task.evidenceRefs missing demo-raw'], error: 'Model output failed semantic validation' }));
    store.startAnalysis(input(), 'Heat');
    await flush();
    expect(store.getSnapshot()[0]).toMatchObject({ status: 'failed', error: 'The proposed response did not pass the safety checks. No mobilization was created.' });
    expect(controls.getRun).not.toHaveBeenCalled();
    store.dispose();
  });

  it('fails closed if a completed response unexpectedly contains validation errors', async () => {
    const { controls, store } = fixture();
    controls.simulate.mockResolvedValue({ ...complete(), validationErrors: ['unsafe response'] });
    store.startAnalysis(input(), 'Heat');
    await flush();
    expect(store.getSnapshot()[0].status).toBe('failed');
    store.dispose();
  });

  it('preserves quota handling and never retries automatically', async () => {
    const { controls, store } = fixture();
    controls.simulate.mockResolvedValue(run({ status: 'failed', error: 'Model provider returned HTTP 429 (insufficient_quota)' }));
    store.startAnalysis(input(), 'Heat');
    await flush();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(store.getSnapshot()[0].error).toContain('credits or account limits');
    expect(controls.simulate).toHaveBeenCalledTimes(1);
    expect(controls.getRun).not.toHaveBeenCalled();
    store.dispose();
  });

  it('recovers an unknown submission outcome with the same request key', async () => {
    const { controls, store } = fixture();
    controls.simulate.mockRejectedValueOnce(new Error('socket lost; secret endpoint')).mockResolvedValueOnce(run());
    const id = store.startAnalysis(input(), 'Heat');
    await flush();
    expect(store.getAnalysis(id)).toMatchObject({ status: 'failed', result: null });
    expect(store.getAnalysis(id)?.error).not.toContain('secret');
    expect(store.retryAnalysis(id)).toBe(id);
    expect(store.getAnalysis(id)?.status).toBe('running');
    expect(store.retryAnalysis(id)).toBeUndefined();
    expect(controls.simulate.mock.calls.map(([facts]) => facts.requestId)).toEqual([id, id]);
    await flush();
    await vi.advanceTimersByTimeAsync(1500);
    expect(store.getAnalysis(id)?.status).toBe('completed');
    store.dispose();
  });

  it.each([0, 408, 500, 502, 503])('retains an uncertain submission with HTTP %s for same-key recovery', async (status) => {
    const { controls, store } = fixture();
    controls.simulate.mockRejectedValueOnce(Object.assign(new Error('private endpoint diagnostic'), { status })).mockResolvedValueOnce(run());
    const id = store.startAnalysis(input(), 'Heat');
    await flush();
    expect(store.getAnalysis(id)).toMatchObject({ status: 'failed', result: null, submissionRejected: false });
    expect(store.retryAnalysis(id)).toBe(id);
    expect(controls.simulate.mock.calls[1][0].requestId).toBe(id);
    await flush();
    store.dispose();
  });

  it.each([400, 401, 403, 404, 409, 422, 429])('distinguishes a definite HTTP %s rejection from a lost submission response', async (status) => {
    const { controls, store } = fixture();
    controls.simulate.mockRejectedValue(Object.assign(new Error('private JSON evidenceRefs zoneSlug diagnostic'), { status }));
    const id = store.startAnalysis(input(), 'Heat');
    await flush();
    expect(store.getAnalysis(id)).toMatchObject({ status: 'failed', result: null, submissionRejected: true });
    expect(store.getAnalysis(id)?.error).not.toContain('private');
    expect(store.getAnalysis(id)?.error).not.toContain('connection was interrupted');
    expect(store.retryAnalysis(id)).toBeUndefined();
    expect(controls.simulate).toHaveBeenCalledTimes(1);
    expect(controls.getRun).not.toHaveBeenCalled();
    store.dispose();
  });

  it('leaves repeated unknown submissions recoverable under their original request key', async () => {
    const { controls, store } = fixture();
    controls.simulate.mockRejectedValue(new Error('offline'));
    const id = store.startAnalysis(input(), 'Heat');
    await flush();
    expect(store.retryAnalysis(id)).toBe(id);
    await flush();
    expect(store.retryAnalysis(id)).toBe(id);
    await flush();
    expect(controls.simulate.mock.calls.every(([facts]) => facts.requestId === id)).toBe(true);
    expect(store.getSnapshot()).toHaveLength(1);
    store.dispose();
  });

  it('does not dismiss an active job, but can dismiss its terminal result', async () => {
    const { store } = fixture();
    const id = store.startAnalysis(input(), 'Heat');
    store.dismissAnalysis(id);
    expect(store.getAnalysis(id)?.status).toBe('running');
    await flush();
    await vi.advanceTimersByTimeAsync(1500);
    store.dismissAnalysis(id);
    expect(store.getAnalysis(id)).toBeUndefined();
    store.dispose();
  });

  it('cancels polling and removes private jobs on disposal', async () => {
    const { controls, store } = fixture();
    store.startAnalysis(input(), 'Heat');
    await flush();
    expect(vi.getTimerCount()).toBe(1);
    store.dispose();
    expect(store.getSnapshot()).toEqual([]);
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(controls.getRun).not.toHaveBeenCalled();
    expect(() => store.startAnalysis(input('new-request-0016'), 'Heat')).toThrow('signed-in coordinator');
  });

  it('ignores a pending submit response after sign-out or Repo replacement', async () => {
    const { controls, store } = fixture();
    const pending = deferred<SimulationRunResult>();
    controls.simulate.mockReturnValue(pending.promise);
    store.startAnalysis(input(), 'Heat');
    store.dispose();
    pending.resolve(run());
    await flush();
    expect(store.getSnapshot()).toEqual([]);
    expect(controls.getRun).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('ignores an in-flight status check after sign-out', async () => {
    const { controls, store } = fixture();
    const pending = deferred<SimulationRunResult>();
    controls.getRun.mockReturnValue(pending.promise);
    store.startAnalysis(input(), 'Heat');
    await flush();
    await vi.advanceTimersByTimeAsync(1500);
    store.dispose();
    pending.resolve(complete());
    await flush();
    expect(store.getSnapshot()).toEqual([]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('rechecks identity before applying asynchronous results', async () => {
    const { controls } = fixture();
    let sameOwner = true;
    const store = new MobilizationAnalysisStore(controls, { allowed: () => sameOwner });
    const pending = deferred<SimulationRunResult>();
    controls.simulate.mockReturnValue(pending.promise);
    store.startAnalysis(input(), 'Private situation');
    sameOwner = false;
    pending.resolve(run());
    await flush();
    expect(store.getSnapshot()).toEqual([]);
    expect(controls.getRun).not.toHaveBeenCalled();
  });

  it('prevents an unauthorized account or an unsupported Repo from starting', () => {
    const { controls } = fixture();
    const unauthorized = new MobilizationAnalysisStore(controls, { allowed: () => false });
    expect(() => unauthorized.startAnalysis(input(), 'Heat')).toThrow('signed-in coordinator');
    const unsupported = new MobilizationAnalysisStore(undefined);
    expect(() => unsupported.startAnalysis(input(), 'Heat')).toThrow('not available');
    expect(controls.simulate).not.toHaveBeenCalled();
  });

  it('keeps separate owners isolated even when request keys match', () => {
    const first = fixture();
    const second = fixture();
    first.store.startAnalysis(input(), 'First coordinator');
    expect(second.store.getSnapshot()).toEqual([]);
    second.store.startAnalysis(input(), 'Second coordinator');
    first.store.dispose();
    expect(second.store.getSnapshot()[0].title).toBe('Second coordinator');
    second.store.dispose();
  });

  it('maintains a stable external-store snapshot until a state change', async () => {
    const { store } = fixture();
    const before = store.getSnapshot();
    expect(store.getSnapshot()).toBe(before);
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);
    store.startAnalysis(input(), 'Heat');
    const current = store.getSnapshot();
    expect(current).not.toBe(before);
    expect(store.getSnapshot()).toBe(current);
    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
    await flush();
    expect(listener).toHaveBeenCalledTimes(1);
    store.dispose();
  });

  it('survives StrictMode effect cleanup/setup without disposing or duplicating a running request', async () => {
    const { controls, store } = fixture();
    const firstCleanup = store.retain();
    store.startAnalysis(input(), 'Heat');
    firstCleanup();
    const finalCleanup = store.retain();
    await flush();
    expect(store.getSnapshot()[0].status).toBe('running');
    expect(controls.simulate).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(1);
    finalCleanup();
    await flush();
    expect(store.getSnapshot()).toEqual([]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('makes a provider cleanup idempotent and disposes after a real unmount', async () => {
    const { store } = fixture();
    const cleanup = store.retain();
    store.startAnalysis(input(), 'Heat');
    cleanup();
    cleanup();
    await flush();
    expect(store.getSnapshot()).toEqual([]);
    expect(() => store.startAnalysis(input(), 'Heat')).toThrow('signed-in coordinator');
  });
});
