import { describe, expect, it } from 'vitest';

import { isModelQuotaFailure } from './model-failure';

describe('quota failure presentation', () => {
  it.each(['insufficient_quota', 'credit_balance_exhausted', 'organization_spend_limit_exceeded',
    'project_spend_limit_exceeded', 'organization_usage_limit_exceeded'])('recognises %s', (code) => {
    expect(isModelQuotaFailure(`Model provider billing limit reached (HTTP 429; ${code}).`)).toBe(true);
  });

  it.each([null, undefined, '', 'Model provider returned HTTP 429',
    'Model provider rate limit reached (HTTP 429; rate_limit_exceeded). Try again later.',
    'Model output failed semantic validation', 'Unexpected text: credit_balance_exhausted'])
  ('does not invent a quota diagnosis for %s', (message) => {
    expect(isModelQuotaFailure(message)).toBe(false);
  });
});
