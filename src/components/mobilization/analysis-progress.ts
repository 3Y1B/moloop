/** Friendly activity copy, not a measurement of the model's current phase. */
export const ANALYSIS_PROGRESS_MESSAGES = [
  'Understanding the situation…',
  'Checking response playbooks…',
  'Building a coordinated plan…',
  'Finding available volunteers…',
] as const;

export const ANALYSIS_MESSAGE_DURATION_MS = 10_000;

/** Uses the original start time so moving between screens never restarts the sequence. */
export function analysisProgressMessage(startedAt: number, now: number): string {
  const elapsed = Number.isFinite(startedAt) && Number.isFinite(now) ? Math.max(0, now - startedAt) : 0;
  const index = Math.floor(elapsed / ANALYSIS_MESSAGE_DURATION_MS) % ANALYSIS_PROGRESS_MESSAGES.length;
  return ANALYSIS_PROGRESS_MESSAGES[index];
}
