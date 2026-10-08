import type { SimulationInput, SimulationRunResult } from '@/lib/mobilization-contracts';
import { isModelQuotaFailure } from '@/lib/model-failure';

import type { MobilizationControls } from './repo';

export type MobilizationAnalysisJob = {
  /** The idempotent request key, not the subsequently assigned server run id. */
  id: string;
  title: string;
  startedAt: number;
  input: SimulationInput;
  result: SimulationRunResult | null;
  /** Display-safe text only. Provider messages and diagnostics stay private. */
  error: string | null;
  status: 'running' | 'completed' | 'failed';
  /** Definite command rejection: correct the input/session, rather than recovering an unknown run. */
  submissionRejected?: boolean;
};

type Controls = Pick<MobilizationControls, 'simulate' | 'getRun'>;
type Timer = ReturnType<typeof setTimeout>;
type Attempt = { generation: number; timer: Timer | null; inFlight: boolean };
type Options = {
  now?: () => number;
  newRequestId?: () => string;
  allowed?: () => boolean;
  schedule?: (callback: () => void, milliseconds: number) => Timer;
  cancel?: (timer: Timer) => void;
  pollIntervalMs?: number;
};

const newRequestId = () =>
  `scenario-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;

function displayFailure(result: SimulationRunResult): string {
  if (result.status === 'configuration_required')
    return 'The analysis connection needs attention. Check its setup before retrying.';
  if (result.validationErrors.length)
    return 'The proposed response did not pass the safety checks. No mobilization was created.';
  if (isModelQuotaFailure(result.error))
    return 'Analysis credits or account limits need attention before you can retry.';
  if (/\b429\b|rate.?limit|too many requests/i.test(result.error ?? ''))
    return 'The analysis service is busy. Wait a moment before retrying.';
  if (/timed? out|timeout|deadline/i.test(result.error ?? ''))
    return 'The analysis took too long to finish. You can retry when you are ready.';
  return 'The analysis could not finish. No mobilization was created. You can retry when you are ready.';
}

function rejectedSubmission(cause: unknown): string | null {
  const status = cause && typeof cause === 'object' && 'status' in cause ? cause.status : null;
  // A definite client-command rejection did not start a new analysis. A transport timeout or
  // server failure may have lost the response after persistence, so those retain the request key.
  if (typeof status !== 'number' || status < 400 || status >= 500 || status === 408) return null;
  if (status === 401) return 'Your session needs attention. Sign in again before testing a situation.';
  if (status === 403) return 'You do not have permission to test this situation.';
  if (status === 404) return 'The analysis service is unavailable. Check the connection before testing again.';
  if (status === 409) return 'This request no longer matches the saved situation. Review its settings and start a new test.';
  if (status === 429) return 'The analysis service is busy. Wait a moment before starting a new test.';
  return 'This situation could not be submitted. Review its settings and try again.';
}

/**
 * Screen-independent, account-owned analysis controller. Starting a job publishes its placeholder
 * synchronously; changing routes never interrupts the request or its sequential status checks.
 * Timers and the clock are injectable, so tests never need a model, database, or native runtime.
 */
export class MobilizationAnalysisStore {
  private jobs: readonly MobilizationAnalysisJob[] = [];
  private listeners = new Set<() => void>();
  private attempts = new Map<string, Attempt>();
  private unknownSubmissions = new Set<string>();
  private disposed = false;
  private leases = 0;
  private generation = 0;
  private readonly now: () => number;
  private readonly makeRequestId: () => string;
  private readonly allowed: () => boolean;
  private readonly schedule: NonNullable<Options['schedule']>;
  private readonly cancel: NonNullable<Options['cancel']>;
  private readonly interval: number;

  constructor(private readonly controls: Controls | undefined, options: Options = {}) {
    this.now = options.now ?? Date.now;
    this.makeRequestId = options.newRequestId ?? newRequestId;
    this.allowed = options.allowed ?? (() => true);
    this.schedule = options.schedule ?? setTimeout;
    this.cancel = options.cancel ?? clearTimeout;
    this.interval = options.pollIntervalMs ?? 1500;
  }

  getSnapshot = (): readonly MobilizationAnalysisJob[] => this.jobs;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };

  getAnalysis = (id: string): MobilizationAnalysisJob | undefined =>
    this.jobs.find((job) => job.id === id);

  /** A committed provider lease; immediate StrictMode cleanup/setup is not an actual unmount. */
  retain = (): (() => void) => {
    this.leases++;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.leases--;
      void Promise.resolve().then(() => { if (!this.leases) this.dispose(); });
    };
  };

  startAnalysis = (input: SimulationInput, title: string): string => {
    this.assertAllowed();
    const existing = this.getAnalysis(input.requestId);
    if (existing) {
      if (JSON.stringify(existing.input) !== JSON.stringify(input))
        throw new Error('This test request belongs to a different situation. Start a new test.');
      // An in-flight request is never submitted twice, including a rapid double tap.
      return existing.id;
    }
    const captured = JSON.parse(JSON.stringify(input)) as SimulationInput;
    const job: MobilizationAnalysisJob = {
      id: captured.requestId, title: title.trim() || 'Situation analysis', startedAt: this.now(),
      input: captured, result: null, error: null, status: 'running', submissionRejected: false,
    };
    const attempt: Attempt = { generation: ++this.generation, timer: null, inFlight: false };
    this.attempts.set(job.id, attempt);
    this.publish([job, ...this.jobs]);
    void this.submit(job.id, attempt);
    return job.id;
  };

  retryAnalysis = (id: string): string | undefined => {
    this.assertAllowed();
    const job = this.getAnalysis(id);
    if (!job || job.status !== 'failed') return undefined;
    if (job.submissionRejected) return undefined;
    if (this.unknownSubmissions.has(id)) {
      // The server may already have started the model before the response was lost. Recover with
      // the same request key: its idempotency lookup returns that run without another model call.
      const attempt: Attempt = { generation: ++this.generation, timer: null, inFlight: false };
      this.attempts.set(id, attempt);
      this.update(id, { status: 'running', error: null });
      void this.submit(id, attempt);
      return id;
    }
    // A known terminal server run cannot be revived. Only an explicit user retry creates a new run.
    const freshId = this.makeRequestId();
    if (this.getAnalysis(freshId)) throw new Error('Could not start a new test. Please try again.');
    const replacement = this.startAnalysis({ ...job.input, requestId: freshId }, job.title);
    this.remove(id);
    return replacement;
  };

  dismissAnalysis = (id: string): void => {
    this.assertAllowed();
    // Hiding a still-running analysis would suggest cancellation, which the server does not offer.
    if (this.getAnalysis(id)?.status === 'running') return;
    this.remove(id);
  };

  /** Sign-out, role loss, Repo replacement, or provider unmount invalidates every outstanding callback. */
  dispose = (): void => {
    if (this.disposed) return;
    this.disposed = true;
    for (const attempt of this.attempts.values())
      if (attempt.timer !== null) this.cancel(attempt.timer);
    this.attempts.clear();
    this.unknownSubmissions.clear();
    this.publish([]);
    this.listeners.clear();
  };

  private assertAllowed(): void {
    if (this.disposed || !this.allowed())
      throw new Error('Only the signed-in coordinator can test a situation.');
    if (!this.controls) throw new Error('Situation analysis is not available on this connection.');
  }

  private current(id: string, attempt: Attempt): boolean {
    if (this.disposed) return false;
    if (!this.allowed()) {
      this.dispose();
      return false;
    }
    return this.attempts.get(id) === attempt && this.getAnalysis(id)?.status === 'running';
  }

  private async submit(id: string, attempt: Attempt): Promise<void> {
    if (!this.current(id, attempt) || !this.controls) return;
    const input = this.getAnalysis(id)!.input;
    attempt.inFlight = true;
    try {
      const result = await this.controls.simulate(input);
      if (!this.current(id, attempt)) return;
      this.unknownSubmissions.delete(id);
      this.accept(id, attempt, result);
    } catch (cause) {
      if (!this.current(id, attempt)) return;
      const rejected = rejectedSubmission(cause);
      if (!rejected) this.unknownSubmissions.add(id);
      this.update(id, {
        status: 'failed',
        submissionRejected: !!rejected,
        error: rejected ?? 'The connection was interrupted. Check again to retrieve this analysis without starting another test.',
      });
      this.attempts.delete(id);
    } finally {
      attempt.inFlight = false;
    }
  }

  private accept(id: string, attempt: Attempt, result: SimulationRunResult): void {
    const failed = result.status === 'failed' || result.status === 'configuration_required' ||
      (result.status === 'completed' && result.validationErrors.length > 0);
    this.update(id, {
      result, status: failed ? 'failed' : result.status === 'completed' ? 'completed' : 'running',
      error: failed ? displayFailure(result) : null,
    });
    if (result.status === 'running') this.pollLater(id, attempt, result.runId);
    else this.attempts.delete(id);
  }

  private pollLater(id: string, attempt: Attempt, runId: string): void {
    if (!this.current(id, attempt)) return;
    attempt.timer = this.schedule(() => {
      attempt.timer = null;
      void this.poll(id, attempt, runId);
    }, this.interval);
  }

  private async poll(id: string, attempt: Attempt, runId: string): Promise<void> {
    if (!this.current(id, attempt) || !this.controls || attempt.inFlight) return;
    attempt.inFlight = true;
    try {
      const result = await this.controls.getRun(runId);
      if (!this.current(id, attempt)) return;
      if (result.runId !== runId) throw new Error('The saved analysis did not match.');
      this.accept(id, attempt, result);
    } catch {
      if (!this.current(id, attempt)) return;
      // A status-check outage is not a model failure. Keep checking the same persisted run, without
      // automatically starting a model retry or creating duplicate proposals.
      this.update(id, { error: 'Still checking the saved analysis. Reconnecting…' });
      this.pollLater(id, attempt, runId);
    } finally {
      attempt.inFlight = false;
    }
  }

  private update(id: string, changes: Partial<MobilizationAnalysisJob>): void {
    this.publish(this.jobs.map((job) => job.id === id ? { ...job, ...changes } : job));
  }

  private remove(id: string): void {
    const attempt = this.attempts.get(id);
    if (attempt?.timer !== null && attempt?.timer !== undefined) this.cancel(attempt.timer);
    this.attempts.delete(id);
    this.unknownSubmissions.delete(id);
    this.publish(this.jobs.filter((job) => job.id !== id));
  }

  private publish(jobs: readonly MobilizationAnalysisJob[]): void {
    this.jobs = jobs;
    for (const listener of this.listeners) listener();
  }
}
