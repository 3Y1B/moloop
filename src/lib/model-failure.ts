const QUOTA_CODES = [
  'insufficient_quota', 'credit_balance_exhausted', 'organization_spend_limit_exceeded',
  'project_spend_limit_exceeded', 'organization_usage_limit_exceeded',
];

/** Only recognise standard codes in our safe provider messages; HTTP 429 alone is not a quota diagnosis. */
export function isModelQuotaFailure(message: string | null | undefined): boolean {
  return !!message?.startsWith('Model provider ') && QUOTA_CODES.some((code) => message.includes(code));
}
