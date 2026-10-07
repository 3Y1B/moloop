import { choice } from '@typesafe-ai/sdk';
import { describe, expect, it } from 'vitest';
import { Jev } from './jev';

// Opt-in: hits the real Spark gateway. Run with SPARK_API_KEY set, e.g.
//   SPARK_API_KEY=... npm test -- jev.live
describe.skipIf(!process.env.SPARK_API_KEY)('Jev against the live Spark', () => {
  const jev = new Jev();

  it('does not treat a collapse as routine', { timeout: 20_000 }, async () => {
    const { priority } = await jev.decide('a guy collapsed by the food stalls and is not responding', {
      priority: choice('How urgent is this message?', {
        P1: 'life threatening unconscious not breathing missing child weapon crush severe bleeding',
        P2: 'urgent injury heat illness fight distress needs help within minutes',
        P3: 'routine non urgent question inconvenience facilities',
      }),
    });

    expect(priority.choice).not.toBe('P3');
    expect(Object.keys(priority.probabilities).sort()).toEqual(['P1', 'P2', 'P3']);
  });

  it('routes an overflowing bin to ops', { timeout: 20_000 }, async () => {
    const { team } = await jev.decide('the bins next to gate B are overflowing', {
      team: choice('Which team should handle this message?', {
        'first-aid': 'medical injury illness collapsed bleeding seizure unconscious breathing heat',
        security: 'fight theft weapon trespass drunk aggressive security',
        ops: 'technical power lighting sound spill bins toilets water station cables logistics',
      }),
    });

    expect(team.choice).toBe('ops');
  });
});
