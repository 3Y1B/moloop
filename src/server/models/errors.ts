export const MODEL_PROVIDER_ERROR_CODES = [
  'insufficient_quota', 'credit_balance_exhausted', 'organization_spend_limit_exceeded',
  'project_spend_limit_exceeded', 'organization_usage_limit_exceeded',
  'rate_limit_exceeded', 'slow_down', 'server_is_overloaded',
] as const;
export type ModelProviderErrorCode = typeof MODEL_PROVIDER_ERROR_CODES[number];
export type ModelHttpErrorKind = 'quota' | 'rate_limit' | 'http';

export function modelProviderErrorCode(value: unknown): ModelProviderErrorCode | undefined {
  return typeof value === 'string' && MODEL_PROVIDER_ERROR_CODES.includes(value as ModelProviderErrorCode)
    ? value as ModelProviderErrorCode : undefined;
}

const QUOTA_CODES = new Set<ModelProviderErrorCode>([
  'insufficient_quota', 'credit_balance_exhausted', 'organization_spend_limit_exceeded',
  'project_spend_limit_exceeded', 'organization_usage_limit_exceeded',
]);

/** Public/audit-safe provider errors: only known codes, never response bodies, messages or endpoints. */
export class ModelHttpError extends Error {
  readonly code: ModelProviderErrorCode | undefined;
  readonly kind: ModelHttpErrorKind;
  readonly retryAfterMs: number | undefined;

  constructor(readonly status: number, details: { code?: ModelProviderErrorCode; quota?: boolean; retryAfterMs?: number } = {}) {
    const code = modelProviderErrorCode(details.code);
    const kind = details.quota || (code && QUOTA_CODES.has(code)) ? 'quota' : status === 429 ? 'rate_limit' : 'http';
    const retryAfterMs = Number.isFinite(details.retryAfterMs) && details.retryAfterMs! >= 0 ? details.retryAfterMs : undefined;
    super(publicMessage(status, kind, code, retryAfterMs));
    this.name = 'ModelHttpError';
    this.code = code;
    this.kind = kind;
    this.retryAfterMs = retryAfterMs;
  }
}

function publicMessage(status: number, kind: ModelHttpErrorKind, code?: ModelProviderErrorCode, retryAfterMs?: number): string {
  const marker = `HTTP ${status}${code ? `; ${code}` : ''}`;
  if (kind === 'quota') {
    if (code === 'credit_balance_exhausted') {
      return `Model provider credits exhausted (${marker}). Add API credits before retrying.`;
    }
    if (code === 'organization_spend_limit_exceeded' || code === 'project_spend_limit_exceeded') {
      const scope = code === 'organization_spend_limit_exceeded' ? 'organization' : 'project';
      return `Model provider ${scope} spending limit reached (${marker}). Check API billing limits before retrying.`;
    }
    if (code === 'organization_usage_limit_exceeded') {
      return `Model provider organization usage limit reached (${marker}). Check API usage limits before retrying.`;
    }
    return `Model provider API quota exhausted (${marker}). Check API credits and billing limits before retrying.`;
  }
  if (kind === 'rate_limit') {
    return `Model provider rate limit reached (${marker}). ${retryAfterMs == null ? 'Try again later.'
      : `Retry after at least ${Math.ceil(retryAfterMs / 1000)} seconds.`}`;
  }
  return `Model provider returned ${marker}`;
}

export class ModelTransportError extends Error {
  constructor() {
    super('Model provider connection failed. Try again later.');
    this.name = 'ModelTransportError';
  }
}

/** Audit storage failure is not a model failure: trying another provider must not bypass it. */
export class ModelAuditError extends Error {
  constructor() { super('Model reply audit could not be saved'); this.name = 'ModelAuditError'; }
}
