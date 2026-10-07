import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { simulationRun } from './simulation';

const { query } = vi.hoisted(() => ({ query: vi.fn<(...args: unknown[]) => Promise<unknown[]>>() }));
vi.mock('../world', () => ({ sql: () => query, loadWorld: vi.fn(), transact: vi.fn() }));
vi.mock('../models', () => ({
  chatModelReadiness: () => ({ ready: true, model: 'test-only', missing: [] }), generateWithReadTool: vi.fn(),
}));

describe('simulation audit expiration uses its configured model budget', () => {
  beforeEach(() => { query.mockReset(); query.mockResolvedValue([]); });
  afterEach(() => { vi.unstubAllEnvs(); });

  it.each([
    [undefined, 240_000], ['60000', 120_000], ['300000', 360_000], ['invalid', 360_000],
  ] as const)('uses %s configuration and %s ms stale bound for the owner', async (value, expected) => {
    vi.stubEnv('MOBILIZATION_MODEL_TIMEOUT_MS', value);
    expect(await simulationRun('run-test', 'actor-test')).toBeNull();
    expect(query).toHaveBeenCalledTimes(2);
    expect(query.mock.calls[0].slice(1)).toEqual(['run-test', 'actor-test', expected]);
    const sql = (query.mock.calls[0][0] as TemplateStringsArray).join('?');
    expect(sql).toContain("* interval '1 millisecond'");
    expect(sql).not.toContain("interval '2 minutes'");
  });

  it('uses the same dynamic bound when another Mo reviews the shared audit', async () => {
    vi.stubEnv('MOBILIZATION_MODEL_TIMEOUT_MS', '180000');
    expect(await simulationRun('run-test')).toBeNull();
    expect(query.mock.calls[0].slice(1)).toEqual(['run-test', 240_000]);
  });
});
