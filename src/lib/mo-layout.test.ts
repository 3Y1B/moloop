import { describe, expect, it } from 'vitest';

import { moLayout } from './mo-layout';

describe('moLayout', () => {
  it('gives a phone four tabs, the map among them', () => {
    expect(moLayout(390)).toEqual({ split: false, tabs: ['index', 'tasks', 'crew', 'map'] });
  });

  it('splits a laptop into a column of three tabs beside an always-on map', () => {
    expect(moLayout(1440)).toEqual({ split: true, tabs: ['index', 'tasks', 'crew'] });
  });

  it('splits from 1000 px exactly', () => {
    expect(moLayout(999).split).toBe(false);
    expect(moLayout(1000).split).toBe(true);
  });
});
