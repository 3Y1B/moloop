import { describe, expect, it } from 'vitest';

import { ANALYSIS_PROGRESS_MESSAGES, analysisProgressMessage } from './analysis-progress';

const START = 1_800_000_000_000;

describe('analysis activity copy', () => {
  it.each([
    [0, 0], [9_999, 0], [10_000, 1], [19_999, 1],
    [20_000, 2], [29_999, 2], [30_000, 3], [39_999, 3],
    [40_000, 0], [50_000, 1], [70_000, 3], [80_000, 0],
  ])('shows the expected message %i ms after the original start', (elapsed, message) => {
    expect(analysisProgressMessage(START, START + elapsed)).toBe(ANALYSIS_PROGRESS_MESSAGES[message]);
  });

  it('does not restart the sequence when a screen opens after the analysis began', () => {
    expect(analysisProgressMessage(START, START + 25_000)).toBe('Building a coordinated plan…');
    expect(analysisProgressMessage(START, START + 35_000)).toBe('Finding available volunteers…');
  });

  it('keeps the first message when the device clock moves before the start time', () => {
    expect(analysisProgressMessage(START, START - 1)).toBe(ANALYSIS_PROGRESS_MESSAGES[0]);
    expect(analysisProgressMessage(START, START - 60_000)).toBe(ANALYSIS_PROGRESS_MESSAGES[0]);
  });

  it.each([NaN, Infinity, -Infinity])('has safe copy for an invalid timestamp: %s', (invalid) => {
    expect(analysisProgressMessage(invalid, START)).toBe(ANALYSIS_PROGRESS_MESSAGES[0]);
    expect(analysisProgressMessage(START, invalid)).toBe(ANALYSIS_PROGRESS_MESSAGES[0]);
  });
});
