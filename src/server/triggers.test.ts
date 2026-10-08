import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { MobilizationCause, Task } from '@/lib/schema';
import {
  onPileUp, onReading, onReport, QUIET_MS, STALE_MS, type Ask, type Checks, type Place, type Reading, type Recent,
  type Trigger, type WithPlans,
} from './triggers';

const { planMobilization } = vi.hoisted(() => ({ planMobilization: vi.fn(async () => [] as string[]) }));
vi.mock('./predict/plan', () => ({ planMobilization }));
vi.mock('./world', () => ({ sql: () => { throw new Error('No database in unit tests'); } }));
vi.mock('./models', () => ({ generate: () => Promise.reject(new Error('No live model in unit tests')) }));

const at = Date.parse('2026-10-08T10:00:00Z');

/** Plans and dismissals in memory, with the same rules the SQL keeps: open plans by playbook and zone. */
function store() {
  const plans: { id: string; playbook: string; zoneSlug: string | null; causes: MobilizationCause[] }[] = [];
  const dismissed: { playbook: string; zoneSlug: string | null; at: number }[] = [];
  let runs = 0;
  const same = (t: Trigger) => (p: { playbook: string; zoneSlug: string | null }) =>
    p.playbook === t.playbook && p.zoneSlug === t.zoneSlug;
  const withPlans: WithPlans = (t, fn) => fn({
    async join() {
      const open = plans.find(same(t));
      open?.causes.push(...t.causes);
      return !!open;
    },
    async dismissedAt() {
      return Math.max(...dismissed.filter(same(t)).map((d) => d.at)) || null;
    },
    async start() {
      plans.push({ id: `run-${++runs}`, playbook: t.playbook, zoneSlug: t.zoneSlug, causes: [...t.causes] });
      return plans[plans.length - 1].id;
    },
  });
  /** Mo dismissed the plan: it's no longer open, and the cool-down starts. */
  const dismiss = (id: string, when: number) => {
    const [plan] = plans.splice(plans.findIndex((p) => p.id === id), 1);
    dismissed.push({ playbook: plan.playbook, zoneSlug: plan.zoneSlug, at: when });
  };
  return { plans, withPlans, dismiss };
}

let n = 0;
const report = (over: Partial<Task> = {}, reporter: Partial<Task['reporter']> = {}): Task => ({
  id: `task-${++n}`, title: 'Kids crushed at the barrier', summary: 'Crush at the front barrier', category: 'crowding',
  priority: 'P1', teamSlug: 'crowd', zoneSlug: 'oval-stage', locationHint: null, status: 'open', assigneeId: null,
  reporter: { kind: 'volunteer', quote: 'kids getting crushed at the barrier', language: 'en',
    playbook: 'crowd-crush-main-stage', playbookSure: true, ...reporter },
  handledBy: 'human', createdAt: at, assignedAt: null, etaAt: null, lastActivityAt: at, nudgeCount: 0,
  lastNudgeAt: null, leadAlertedAt: null, resolvedAt: null, escalation: null, requiredCount: 1, helpers: [],
  resolution: null, requestId: null, mobilizationId: null, ...over,
});
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('T1 and T4: a report that names a playbook plans once per playbook and zone', () => {
  beforeEach(() => planMobilization.mockClear());

  it('a report read as a crowd surge creates one pending plan, and the planner starts', async () => {
    const s = store();
    expect(await onReport(report(), false, s.withPlans)).toBe('run-1');
    expect(s.plans).toHaveLength(1);
    expect(s.plans[0]).toMatchObject({ playbook: 'crowd-crush-main-stage', zoneSlug: 'oval-stage' });
    expect(s.plans[0].causes).toEqual([expect.objectContaining({ kind: 'report', priority: 'P1', at })]);
    await settle();
    expect(planMobilization).toHaveBeenCalledExactlyOnceWith('run-1');
  });

  it('a second report adds evidence, not a second plan, even one too weak to start a plan', async () => {
    const s = store();
    await onReport(report(), false, s.withPlans);
    expect(await onReport(report({ priority: 'P2' }), false, s.withPlans)).toBeNull();
    expect(await onReport(report({ priority: 'P3' }, { playbookSure: false }), false, s.withPlans)).toBeNull();
    expect(s.plans).toHaveLength(1);
    expect(s.plans[0].causes.map((c) => c.kind === 'report' && c.priority)).toEqual(['P1', 'P2', 'P3']);
    await settle();
    expect(planMobilization).toHaveBeenCalledTimes(1);
  });

  it('another zone or another playbook is its own plan', async () => {
    const s = store();
    await onReport(report(), false, s.withPlans);
    await onReport(report({ zoneSlug: 'lawn-stage' }), false, s.withPlans);
    await onReport(report({}, { playbook: 'severe-weather-main-stage' }), false, s.withPlans);
    expect(s.plans.map((p) => `${p.playbook} ${p.zoneSlug}`)).toEqual([
      'crowd-crush-main-stage oval-stage', 'crowd-crush-main-stage lawn-stage', 'severe-weather-main-stage oval-stage',
    ]);
  });

  it('only a P1 report, one intake is sure of, or Mo starts a plan', async () => {
    const s = store();
    expect(await onReport(report({ priority: 'P2' }, { playbookSure: false }), false, s.withPlans)).toBeNull();
    expect(s.plans).toHaveLength(0);
    expect(await onReport(report({ priority: 'P2' }), false, s.withPlans)).toBe('run-1');
    expect(await onReport(report({ priority: 'P2', zoneSlug: 'lawn-stage' }, { playbookSure: false }), true,
      s.withPlans)).toBe('run-2');
    expect(await onReport(report({ zoneSlug: 'gate-a' }, { playbookSure: false }), false, s.withPlans)).toBe('run-3');
  });

  it('T4: Mo saying "storm coming at the main stage" plans, though it isn’t P1', async () => {
    const s = store();
    const storm = report({ priority: 'P2', title: 'Storm coming at the main stage' },
      { playbook: 'severe-weather-main-stage', playbookSure: false });
    expect(await onReport(storm, true, s.withPlans)).toBe('run-1');
    expect(s.plans[0].playbook).toBe('severe-weather-main-stage');
  });

  it('dismissed: the same playbook and zone is quiet for 15 minutes, but a P1 report comes through', async () => {
    const s = store();
    await onReport(report(), false, s.withPlans);
    s.dismiss('run-1', at);
    const later = (minutes: number, priority: Task['priority']) =>
      report({ priority, createdAt: at + minutes * 60_000 });
    expect(await onReport(later(5, 'P2'), false, s.withPlans)).toBeNull();
    expect(await onReport(later(14, 'P2'), false, s.withPlans)).toBeNull();
    expect(s.plans).toHaveLength(0);
    expect(await onReport(later(6, 'P1'), false, s.withPlans)).toBe('run-2');
  });

  it('after the 15 minutes, a report starts a plan again', async () => {
    const s = store();
    await onReport(report(), false, s.withPlans);
    s.dismiss('run-1', at);
    expect(await onReport(report({ priority: 'P2', createdAt: at + QUIET_MS }), false, s.withPlans)).toBe('run-2');
  });

  it('a report naming no playbook, or a mobilization’s own task, starts nothing', async () => {
    const s = store();
    expect(await onReport(report({}, { playbook: null }), false, s.withPlans)).toBeNull();
    expect(await onReport(report({}, { playbook: 'lost-child' }), false, s.withPlans)).toBeNull();
    expect(await onReport(report({ mobilizationId: 'mob' }), false, s.withPlans)).toBeNull();
    expect(s.plans).toHaveLength(0);
  });
});

const places: Record<string, Place> = {
  'lawn-stage': { kind: 'stage', capacity: 8000 }, 'gate-a': { kind: 'gate', capacity: 3000 },
  'food-alley': { kind: 'food', capacity: 1500 }, 'water-1': { kind: 'water', capacity: null },
};
let r = 0;
const reading = (key: string, value: unknown, over: Partial<Reading> = {}): Reading => ({
  id: `reading-${++r}`, key, zoneSlug: 'lawn-stage', value, observedAt: at, source: 'simulated', ...over,
});

describe('T3: a reading over a playbook’s line plans; the number is the number', () => {
  // Earlier tests' planners are still on their way.
  beforeEach(async () => {
    await settle();
    planMobilization.mockClear();
  });

  it('wind over the stage’s limit creates a storm plan, citing the reading and the line', async () => {
    const s = store();
    expect(await onReading(reading('weather.windSpeed', 72), places, s.withPlans, at)).toEqual(['run-1']);
    expect(s.plans[0]).toMatchObject({ playbook: 'severe-weather-main-stage', zoneSlug: 'lawn-stage' });
    expect(s.plans[0].causes).toEqual([{ kind: 'reading', readingId: 'reading-1', key: 'weather.windSpeed',
      zoneSlug: 'lawn-stage', value: 72, line: 'limit 60 km/h', source: 'simulated', at }]);
    await settle();
    expect(planMobilization).toHaveBeenCalledExactlyOnceWith('run-1');
  });

  it('wind under the limit, or away from a stage, doesn’t', async () => {
    const s = store();
    expect(await onReading(reading('weather.windSpeed', 55), places, s.withPlans, at)).toEqual([]);
    expect(await onReading(reading('weather.windSpeed', 60), places, s.withPlans, at)).toEqual([]);
    expect(await onReading(reading('weather.windSpeed', 80, { zoneSlug: 'food-alley' }), places, s.withPlans, at))
      .toEqual([]);
    expect(s.plans).toHaveLength(0);
  });

  it('a stale reading (over 30 minutes old) never fires', async () => {
    const s = store();
    const old = reading('weather.windSpeed', 90, { observedAt: at - STALE_MS - 1 });
    expect(await onReading(old, places, s.withPlans, at)).toEqual([]);
    expect(await onReading(reading('weather.windSpeed', 90, { observedAt: at - STALE_MS }), places, s.withPlans, at))
      .toEqual(['run-1']);
  });

  it('a second reading adds a cause to the plan, not a second plan', async () => {
    const s = store();
    await onReading(reading('weather.windSpeed', 72), places, s.withPlans, at);
    expect(await onReading(reading('stageSafety.windLimitExceeded', true, { observedAt: at + 60_000 }), places,
      s.withPlans, at + 60_000)).toEqual([]);
    expect(s.plans).toHaveLength(1);
    expect(s.plans[0].causes.map((c) => c.kind === 'reading' && [c.key, c.value, c.line])).toEqual([
      ['weather.windSpeed', 72, 'limit 60 km/h'], ['stageSafety.windLimitExceeded', true, ''],
    ]);
  });

  it('each playbook’s lines', async () => {
    const fires = async (x: Reading) => {
      const s = store();
      await onReading(x, places, s.withPlans, at);
      return s.plans.map((p) => `${p.playbook} ${p.zoneSlug} ${p.causes.map((c) => c.kind === 'reading' && c.line)}`);
    };
    expect(await fires(reading('weather.warning', 'storm', { zoneSlug: null }))).toEqual(['severe-weather-main-stage null ']);
    expect(await fires(reading('weather.warning', 'heat', { zoneSlug: null }))).toEqual([]);
    expect(await fires(reading('weather.lightningDistance', 8, { zoneSlug: null })))
      .toEqual(['severe-weather-main-stage null under 10 km']);
    expect(await fires(reading('weather.lightningDistance', 10, { zoneSlug: null }))).toEqual([]);
    expect(await fires(reading('crowd.densityByZone', 4))).toEqual(['crowd-crush-main-stage lawn-stage limit 4 people/m²']);
    expect(await fires(reading('crowd.densityByZone', 3.9))).toEqual([]);
    expect(await fires(reading('crowd.densityByZone', 5, { zoneSlug: 'food-alley' }))).toEqual([]);
    expect(await fires(reading('barrierStatus', 'breached'))).toEqual(['crowd-crush-main-stage lawn-stage ']);
    expect(await fires(reading('barrierStatus', 'damaged'))).toEqual([]);
    expect(await fires(reading('weather.heatIndex', 41, { zoneSlug: null })))
      .toEqual(['extreme-heat-water-shortage null limit 40°C']);
    expect(await fires(reading('weather.heatIndex', 39, { zoneSlug: null }))).toEqual([]);
    expect(await fires(reading('water.tankLevels', 15, { zoneSlug: 'water-1' })))
      .toEqual(['extreme-heat-water-shortage water-1 under 20%']);
    expect(await fires(reading('water.tankLevels', 20, { zoneSlug: 'water-1' }))).toEqual([]);
    expect(await fires(reading('gateSystemStatus', 'failed', { zoneSlug: 'gate-a' })))
      .toEqual(['gate-breach-uncontrolled-ingress gate-a ']);
    expect(await fires(reading('ticketScanStatus', 'degraded', { zoneSlug: 'gate-a' }))).toEqual([]);
  });

  it('a gate count over that gate’s capacity fires at that gate, with the count', async () => {
    const s = store();
    const counts = reading('gateCounts', { coverage: 'partial', entries: [
      { zoneSlug: 'gate-a', count: 3200 }, { zoneSlug: 'lawn-stage', count: 9000 },
    ] }, { zoneSlug: null });
    expect(await onReading(counts, places, s.withPlans, at)).toEqual(['run-1']);
    expect(s.plans[0]).toMatchObject({ playbook: 'gate-breach-uncontrolled-ingress', zoneSlug: 'gate-a' });
    expect(s.plans[0].causes).toEqual([expect.objectContaining({ value: 3200, line: 'capacity 3000 people' })]);
  });
});

describe('T2: reports adding up in one zone ask the model once', () => {
  /** Reports and checks in memory, with the same rules the SQL keeps. */
  function checks(planned = false) {
    const tasks: Task[] = [];
    const asked: { zoneSlug: string; at: number; taskIds: string[]; playbook?: string | null }[] = [];
    const c: Checks = {
      async reports(zone, since, until) {
        return tasks.filter((t) => t.zoneSlug === zone && t.createdAt >= since && t.createdAt <= until)
          .map((t): Recent => ({ kind: 'report', taskId: t.id, title: t.title, zoneSlug: t.zoneSlug,
            priority: t.priority, at: t.createdAt, summary: t.summary }));
      },
      planned: async () => planned,
      async claim(zone, since, when, taskIds) {
        if (asked.some((a) => a.zoneSlug === zone && a.at >= since)) return null;
        asked.push({ zoneSlug: zone, at: when, taskIds });
        return String(asked.length - 1);
      },
      async answered(id, playbook) {
        asked[Number(id)].playbook = playbook;
      },
    };
    /** A report filed `minutes` after `at`; T2 runs on it. */
    const file = (minutes: number, ask: Ask, s: ReturnType<typeof store>, zoneSlug = 'lawn-stage') => {
      const t = report({ zoneSlug, priority: 'P2', createdAt: at + minutes * 60_000 }, { playbook: null });
      tasks.push(t);
      return onPileUp(t, c, ask, s.withPlans);
    };
    return { asked, file };
  }
  const crowdSurge = () => vi.fn<Ask>(async () => 'crowd-crush-main-stage');

  it('3 reports in one zone in 10 minutes ask once, and the plan cites all three', async () => {
    const s = store(); const c = checks(); const ask = crowdSurge();
    expect(await c.file(0, ask, s)).toBeNull();
    expect(await c.file(4, ask, s)).toBeNull();
    expect(ask).not.toHaveBeenCalled();
    expect(await c.file(9, ask, s)).toBe('run-1');
    expect(ask).toHaveBeenCalledOnce();
    expect(ask.mock.calls[0][1]).toHaveLength(3);
    expect(s.plans[0]).toMatchObject({ playbook: 'crowd-crush-main-stage', zoneSlug: 'lawn-stage' });
    expect(s.plans[0].causes).toHaveLength(3);
    expect(s.plans[0].causes.every((cause) => cause.kind === 'report' && !('summary' in cause))).toBe(true);
    expect(c.asked).toEqual([expect.objectContaining({ playbook: 'crowd-crush-main-stage' })]);
  });

  it('2 don’t, and 3 spread over 30 minutes don’t', async () => {
    const s = store(); const c = checks(); const ask = crowdSurge();
    await c.file(0, ask, s);
    await c.file(15, ask, s);
    await c.file(30, ask, s);
    expect(ask).not.toHaveBeenCalled();
    expect(s.plans).toHaveLength(0);
  });

  it('another report in the same window doesn’t ask again', async () => {
    const s = store(); const c = checks(); const ask = vi.fn<Ask>(async () => null);
    await c.file(0, ask, s);
    await c.file(1, ask, s);
    await c.file(2, ask, s);
    expect(await c.file(5, ask, s)).toBeNull();
    expect(await c.file(9, ask, s)).toBeNull();
    expect(ask).toHaveBeenCalledOnce();
    expect(s.plans).toHaveLength(0);
  });

  it('reports elsewhere don’t add up here', async () => {
    const s = store(); const c = checks(); const ask = crowdSurge();
    await c.file(0, ask, s);
    await c.file(1, ask, s, 'gate-a');
    await c.file(2, ask, s);
    expect(ask).not.toHaveBeenCalled();
  });

  it('a model failure is no plan, not an error', async () => {
    const s = store(); const c = checks(); const ask = vi.fn<Ask>(async () => { throw new Error('timed out'); });
    await c.file(0, ask, s);
    await c.file(1, ask, s);
    expect(await c.file(2, ask, s)).toBeNull();
    expect(ask).toHaveBeenCalledOnce();
    expect(s.plans).toHaveLength(0);
    expect(c.asked).toEqual([expect.objectContaining({ playbook: null })]);
  });

  it('a plan already in the zone means no asking', async () => {
    const s = store(); const c = checks(true); const ask = crowdSurge();
    for (const minutes of [0, 1, 2]) await c.file(minutes, ask, s);
    expect(ask).not.toHaveBeenCalled();
    expect(c.asked).toHaveLength(0);
  });
});

