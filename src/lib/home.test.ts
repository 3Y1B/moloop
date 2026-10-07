import { describe, expect, it } from 'vitest';

import { homeFor } from './home';

describe('homeFor', () => {
  it('sends the coordinator to their own console', () => {
    expect(homeFor('coordinator')).toBe('(mo)');
  });

  it('keeps leads and volunteers on the map and sheet', () => {
    expect(homeFor('team_lead')).toBe('(staff)');
    expect(homeFor('volunteer')).toBe('(staff)');
  });

  it('sends festival-goers to the guest app', () => {
    expect(homeFor('guest')).toBe('(guest)');
  });

  it('has no home until the role is known', () => {
    expect(homeFor(null)).toBeNull();
  });
});
