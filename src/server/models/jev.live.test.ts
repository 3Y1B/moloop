import { describe, expect, it } from 'vitest';
import { JevClassifier } from './jev';

// Opt-in: hits the real Spark gateway. Run with SPARK_API_KEY set, e.g.
//   SPARK_API_KEY=... npm test -- jev.live
describe.skipIf(!process.env.SPARK_API_KEY)('JevClassifier against the live Spark', () => {
  const jev = new JevClassifier();

  it('does not treat a collapse as routine', { timeout: 20_000 }, async () => {
    const r = await jev.classify({
      text: 'a guy collapsed by the food stalls and is not responding',
      labels: [
        { id: 'P1', description: 'life threatening unconscious not breathing missing child weapon crush severe bleeding' },
        { id: 'P2', description: 'urgent injury heat illness fight distress needs help within minutes' },
        { id: 'P3', description: 'routine non urgent question inconvenience facilities' },
      ],
    });

    expect(r.label).not.toBe('P3');
    expect(Object.keys(r.scores).sort()).toEqual(['P1', 'P2', 'P3']);
  });

  it('routes an overflowing bin to ops', { timeout: 20_000 }, async () => {
    const r = await jev.classify({
      text: 'the bins next to gate B are overflowing',
      labels: [
        { id: 'first-aid', description: 'medical injury illness collapsed bleeding seizure unconscious breathing heat' },
        { id: 'security', description: 'fight theft weapon trespass drunk aggressive security' },
        { id: 'ops', description: 'technical power lighting sound spill bins toilets water station cables logistics' },
      ],
    });

    expect(r.label).toBe('ops');
  });
});
