const DEFAULT_MODEL_TIMEOUT_MS = 180_000;
const MIN_MODEL_TIMEOUT_MS = 60_000;
const MAX_MODEL_TIMEOUT_MS = 300_000;
const CALL_BUFFER_MS = 30_000;
const STALE_BUFFER_MS = 60_000;

export type MobilizationTimeouts = {
  modelTimeoutMs: number;
  wholeCallTimeoutMs: number;
  staleRunTimeoutMs: number;
};

/** Mobilization-only limits; never change the shared intake/voice timeouts. */
export function mobilizationTimeouts(raw: string | undefined): MobilizationTimeouts {
  const value = raw?.trim();
  const modelTimeoutMs = value ? Number(value) : DEFAULT_MODEL_TIMEOUT_MS;
  if ((value && !/^\d+$/.test(value)) || !Number.isSafeInteger(modelTimeoutMs) ||
    modelTimeoutMs < MIN_MODEL_TIMEOUT_MS || modelTimeoutMs > MAX_MODEL_TIMEOUT_MS) {
    // Do not echo arbitrary env contents into a public configuration error.
    throw new RangeError('MOBILIZATION_MODEL_TIMEOUT_MS must be an integer between 60000 and 300000.');
  }
  return {
    modelTimeoutMs,
    wholeCallTimeoutMs: modelTimeoutMs + CALL_BUFFER_MS,
    staleRunTimeoutMs: modelTimeoutMs + STALE_BUFFER_MS,
  };
}

/** Bad current configuration must not hide existing audit records or prematurely expire an older run. */
export function mobilizationStaleRunTimeoutMs(raw: string | undefined): number {
  try { return mobilizationTimeouts(raw).staleRunTimeoutMs; }
  catch { return MAX_MODEL_TIMEOUT_MS + STALE_BUFFER_MS; }
}
