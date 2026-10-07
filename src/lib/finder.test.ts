import { describe, expect, it } from 'vitest';

import { beaconUuid, isClose, readPeer, readSignal } from './finder';

const NOW = 1_800_000_000_000;

/** Heard every 250 ms for the last second at one strength, the way a phone standing still sounds. */
const steady = (rssi: number, until = NOW) => [1000, 750, 500, 250, 0].map((ago) => ({ rssi, at: until - ago }));

describe('beaconUuid: the Bluetooth ID both phones on a task use', () => {
  // The last 8 hex digits are FNV-1a 32 of the task id; "a" and "foobar" are the published FNV test vectors.
  it('is the same fixed ID for the same task, so the volunteer and the festival-goer find each other', () => {
    expect(beaconUuid('a')).toBe('6d6f6c6f-6f70-4000-8000-0000e40c292c');
    expect(beaconUuid('foobar')).toBe('6d6f6c6f-6f70-4000-8000-0000bf9cf968');
  });

  it('is a different, well-formed UUID for another task, so two finders in one crowd never hear each other', () => {
    const one = beaconUuid('3b941026-6044-4287-8e22-79b6b37daba2');
    const two = beaconUuid('7e437606-e671-4466-ba08-30cb2187a78a');
    expect(one).not.toBe(two);
    for (const uuid of [one, two]) expect(uuid).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  });
});

describe('readSignal: how close the other phone is', () => {
  it('is searching before the other phone has been heard', () => {
    expect(readSignal([], NOW)).toEqual({ step: 'searching', trend: null, rssi: null });
  });

  it.each([
    [-48, 'here'], // touching distance
    [-60, 'very_close'],
    [-70, 'closer'],
    [-85, 'nearby'], // heard, but across the crowd
  ] as const)('a steady %i dBm is %s', (rssi, step) => {
    expect(readSignal(steady(rssi), NOW).step).toBe(step);
  });

  it('ignores one stray strong reading: a bounce off a wall is not walking up to them', () => {
    const samples = [...steady(-82, NOW - 250), { rssi: -45, at: NOW }];
    expect(readSignal(samples, NOW).step).toBe('nearby');
  });

  it.each([
    ['closer', -77, 'closer'], // just under the −75 line: stays
    ['nearby', -74, 'nearby'], // just over it: stays
    ['closer', -80, 'nearby'], // clearly under: moves
    ['nearby', -70, 'closer'], // clearly over: moves
  ] as const)('was %s, now a steady %i dBm: %s (no flicker at a boundary)', (previous, rssi, step) => {
    expect(readSignal(steady(rssi), NOW, previous).step).toBe(step);
  });

  it.each([
    [-84, -72, 'warmer'], // walking towards them
    [-66, -78, 'colder'], // walking away
    [-70, -71, 'steady'], // standing still: a dB of noise isn't a trend
  ] as const)('from %i dBm three seconds ago to %i now: %s', (before, after, trend) => {
    expect(readSignal([...steady(before, NOW - 3000), ...steady(after)], NOW).trend).toBe(trend);
  });

  it('has no trend until there are three seconds to compare', () => {
    expect(readSignal(steady(-70), NOW).trend).toBeNull();
  });

  it('goes back to searching when the other phone has been quiet for 5 seconds (walked off, or closed the app)', () => {
    expect(readSignal(steady(-50, NOW - 5000), NOW)).toEqual({ step: 'searching', trend: null, rssi: null });
  });
});

describe('readPeer: the UWB arrow between two iPhones', () => {
  it('has nothing to point at without a distance, so the Bluetooth dots stay', () => {
    expect(readPeer({ distance: null, azimuth: null })).toBeNull();
  });

  it('knows how far but not which way yet: asks you to move the iPhone around, showing the distance', () => {
    expect(readPeer({ distance: 4.06, azimuth: null })).toEqual({ kind: 'sweep', distance: '4.1 m' });
  });

  it('is “here” within half a metre, whichever way the phone points (an arrow that close just spins)', () => {
    expect(readPeer({ distance: 0.3, azimuth: 1.2 })).toEqual({ kind: 'here' });
    expect(readPeer({ distance: 0.4, azimuth: null })).toEqual({ kind: 'here' });
  });

  it('rounds to whole metres from 10 m out', () => {
    expect(readPeer({ distance: 12.4, azimuth: 0.5236 })).toMatchObject({ distance: '12 m' });
    expect(readPeer({ distance: 9.96, azimuth: null })).toEqual({ kind: 'sweep', distance: '10 m' });
  });

  it('points 30° right, 3.2 m, “to your right”, not yet facing them', () => {
    expect(readPeer({ distance: 3.24, azimuth: 0.5236 })).toEqual({ kind: 'arrow', angle: 30, distance: '3.2 m', side: 'right', facing: false });
  });

  it.each([
    [0.0873, 'ahead', true], // 5°: facing them, the screen lights up
    [-0.2443, 'ahead', true], // −14°: still within the 15° cone
    [-0.5236, 'left', false], // −30°
  ] as const)('azimuth %f rad is %s (facing: %s)', (azimuth, side, facing) => {
    expect(readPeer({ distance: 5, azimuth })).toMatchObject({ side, facing });
  });
});

describe('isClose: when both phones get "You’re close"', () => {
  const at = (x: number) => ({ x, y: 0 });

  it('is close within 30 m, not at 40 m', () => {
    expect(isClose(at(0), at(25), false)).toBe(true);
    expect(isClose(at(0), at(40), false)).toBe(false);
  });

  it('stays close until they are 60 m apart, so GPS wobbling at 30 m doesn’t prompt twice', () => {
    expect(isClose(at(0), at(45), true)).toBe(true);
    expect(isClose(at(0), at(65), true)).toBe(false);
  });

  it('holds whatever it was while either position is unknown', () => {
    expect(isClose(null, at(5), false)).toBe(false);
    expect(isClose(at(0), null, true)).toBe(true);
  });
});
