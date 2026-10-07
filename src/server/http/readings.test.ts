import { afterEach, describe, expect, it, vi } from 'vitest';
import { isServerKey, parseReading, readings } from './readings';

vi.mock('../world', () => ({ sql: () => { throw new Error('No database in unit tests'); } }));
vi.mock('../models', () => ({ generate: () => Promise.reject(new Error('No live model in unit tests')) }));

const zones = ['lawn-stage', 'gate-a', 'water-1'];
const now = Date.parse('2026-10-08T10:00:00Z');
const wind = { key: 'weather.windSpeed', zoneSlug: 'lawn-stage', value: 72, source: 'simulated' };
const error = (body: unknown) => {
  const out = parseReading(body, zones, now);
  return 'error' in out ? out.error : null;
};

describe('POST /api/reading: what it takes', () => {
  it('a catalog reading at a real place, observed now unless it says when', () => {
    expect(parseReading(wind, zones, now)).toEqual({ reading: { key: 'weather.windSpeed', zoneSlug: 'lawn-stage',
      value: 72, observedAt: now, source: 'simulated' } });
    const earlier = parseReading({ ...wind, observedAt: '2026-10-08T09:58:00Z' }, zones, now);
    expect('reading' in earlier && earlier.reading.observedAt).toBe(now - 2 * 60_000);
  });

  it('the built-in weather, which the planner reads from readings', () => {
    expect(error({ key: 'weather.warning', zoneSlug: null, value: 'storm', source: 'sensor' })).toBeNull();
    expect(error({ key: 'weather.warning', zoneSlug: null, value: 'severe', source: 'sensor' })).toMatch(/invalid status/);
    expect(error({ key: 'currentRoster', zoneSlug: null, value: 'everyone', source: 'sensor' })).toMatch(/isn't a reading/);
  });

  it('an unknown place is a 400, not nowhere (audit S8)', () => {
    expect(error({ ...wind, zoneSlug: 'main-stage' })).toBe('Unknown zone main-stage');
    expect(error({ key: 'gateCounts', zoneSlug: null, source: 'sensor',
      value: { coverage: 'partial', entries: [{ zoneSlug: 'gate-z', count: 10 }] } })).toMatch(/Unknown observation zone gate-z/);
  });

  it.each([
    ['an unknown key', { ...wind, key: 'weather.vibes' }, /Unknown reading key/],
    ['the wrong kind of value', { ...wind, value: 'gusty' }, /expected number/i],
    ['a number out of range', { ...wind, value: 400 }, /exceeds 300/],
    ['no value', { ...wind, value: null }, /value: required/],
    ['a zone fact with no zone', { key: 'crowd.densityByZone', zoneSlug: null, value: 5, source: 'sensor' }, /zone scope/],
    ['an unknown source', { ...wind, source: 'guess' }, /source/],
    ['a time that isn’t one', { ...wind, observedAt: 'soon' }, /observedAt/],
    ['a time in the future', { ...wind, observedAt: '2026-10-08T10:05:00Z' }, /in the future/],
    ['no body', null, /body/],
  ])('refuses %s', (_, body, message) => {
    expect(error(body)).toMatch(message);
  });
});

describe('POST /api/reading: server key only', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('the secret key gets in; a session token, another key or none doesn’t', () => {
    vi.stubEnv('SUPABASE_SECRET_KEY', 'sb_secret_test');
    expect(isServerKey('Bearer sb_secret_test')).toBe(true);
    expect(isServerKey('Bearer eyJhbGciOi.user.jwt')).toBe(false);
    expect(isServerKey('Bearer sb_secret_tes')).toBe(false);
    expect(isServerKey(undefined)).toBe(false);
  });

  it('with no key configured, nobody does', () => {
    vi.stubEnv('SUPABASE_SECRET_KEY', '');
    expect(isServerKey('Bearer ')).toBe(false);
  });

  it('a caller without it is a 401 before anything is read', async () => {
    vi.stubEnv('SUPABASE_SECRET_KEY', 'sb_secret_test');
    const res = await readings.request('/reading', { method: 'POST', body: JSON.stringify(wind),
      headers: { authorization: 'Bearer app-session', 'content-type': 'application/json' } });
    expect(res.status).toBe(401);
  });
});
