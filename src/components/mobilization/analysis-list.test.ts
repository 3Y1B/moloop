import { describe, expect, it } from 'vitest';

import type { MobilizationAnalysisJob } from '@/data/mobilization-analysis';
import type { Mobilization } from '@/lib/schema';
import { visibleAnalysisJobs } from './analysis-list';

function job(overrides: Partial<MobilizationAnalysisJob> = {}): MobilizationAnalysisJob {
  return { id: 'test', title: 'Heat + water shortage', startedAt: 100, input: {} as MobilizationAnalysisJob['input'],
    error: null, result: null, status: 'running', ...overrides };
}
function completed(ids = ['one', 'two']): MobilizationAnalysisJob {
  return job({ status: 'completed', result: { runId: 'run', status: 'completed', decision: 'propose',
    mobilizationIds: ids, validationErrors: [], error: null, snapshot: null, output: null,
    promptVersion: 'test', model: null, createdAt: '' } });
}
function plan(runId: string): Mobilization { return { analysisRunId: runId } as Mobilization; }

describe('analysis waiting rows', () => {
  it('appears before a server run identity is available', () => {
    const pending = job();
    expect(visibleAnalysisJobs([pending], {})).toEqual([pending]);
  });
  it('waits for every persisted proposal before removing the placeholder', () => {
    const ready = completed();
    expect(visibleAnalysisJobs([ready], { one: plan('run') })).toEqual([ready]);
    expect(visibleAnalysisJobs([ready], { one: plan('run'), two: plan('run') })).toEqual([]);
  });
  it('does not replace the row with objects from a different analysis', () => {
    const ready = completed();
    expect(visibleAnalysisJobs([ready], { one: plan('run'), two: plan('different') })).toEqual([ready]);
  });
  it('does not silently disappear when no real proposals were saved', () => {
    const ready = completed([]);
    expect(visibleAnalysisJobs([ready], {})).toEqual([ready]);
  });
  it.each(['no_mobilization', 'insufficient_data'] as const)('retains the readable %s result', (decision) => {
    const ready = completed([]);
    ready.result = { ...ready.result!, decision };
    expect(visibleAnalysisJobs([ready], {})).toEqual([ready]);
  });
  it('retains failure so Mo can reconnect or retry', () => {
    const failed = job({ status: 'failed', error: 'Check the connection.' });
    expect(visibleAnalysisJobs([failed], {})).toEqual([failed]);
  });
  it('shows the latest submitted situation first without mutating the source array', () => {
    const old = job({ id: 'old', startedAt: 100 });
    const latest = job({ id: 'latest', startedAt: 200 });
    const source = [old, latest];
    expect(visibleAnalysisJobs(source, {})).toEqual([latest, old]);
    expect(source).toEqual([old, latest]);
  });
});
