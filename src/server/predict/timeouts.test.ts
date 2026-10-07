import { describe, expect, it } from 'vitest';
import { mobilizationStaleRunTimeoutMs, mobilizationTimeouts } from './timeouts';

describe('Mobilization-specific timeout configuration', () => {
  it.each([undefined, '', '  '])('defaults a missing/empty value (%s) to a three-minute model budget', (value) => {
    expect(mobilizationTimeouts(value)).toEqual({
      modelTimeoutMs: 180_000, wholeCallTimeoutMs: 210_000, staleRunTimeoutMs: 240_000,
    });
  });

  it.each([60_000, 180_000, 300_000])('keeps model, whole-call and stale limits coherent for %s ms', (value) => {
    const timeouts = mobilizationTimeouts(String(value));
    expect(timeouts.modelTimeoutMs).toBe(value);
    expect(timeouts.wholeCallTimeoutMs).toBe(value + 30_000);
    expect(timeouts.staleRunTimeoutMs).toBe(value + 60_000);
    expect(timeouts.modelTimeoutMs).toBeLessThan(timeouts.wholeCallTimeoutMs);
    expect(timeouts.wholeCallTimeoutMs).toBeLessThan(timeouts.staleRunTimeoutMs);
    expect(mobilizationStaleRunTimeoutMs(String(value))).toBe(timeouts.staleRunTimeoutMs);
  });

  it('accepts surrounding whitespace without allowing unbounded values', () => {
    expect(mobilizationTimeouts(' 120000 ').modelTimeoutMs).toBe(120_000);
  });

  it.each(['0', '-60000', '59999', '300001', '1.5', '180000.0', '1e6', 'NaN', 'Infinity',
    '0x2bf20', '180_000', '9007199254740993', 'do-not-echo-this-secret'])('rejects invalid value %s', (value) => {
    expect(() => mobilizationTimeouts(value)).toThrow(RangeError);
    expect(() => mobilizationTimeouts(value)).toThrow(
      'MOBILIZATION_MODEL_TIMEOUT_MS must be an integer between 60000 and 300000.',
    );
  });

  it('uses the maximum safe stale limit when config is invalid, so old audits remain accessible', () => {
    expect(mobilizationStaleRunTimeoutMs('not-valid')).toBe(360_000);
    expect(mobilizationStaleRunTimeoutMs('59999')).toBe(360_000);
    expect(mobilizationStaleRunTimeoutMs(undefined)).toBe(240_000);
  });
});
