import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { MobilizationCause, Task } from '@/lib/schema';
import { onReport, QUIET_MS, type Trigger, type WithPlans } from './triggers';

const { planMobilization } = vi.hoisted(() => ({ planMobilization: vi.fn(async () => [] as string[]) }));
vi.mock('./predict/plan', () => ({ planMobilization }));
vi.mock('./world', () => ({ sql: () => { throw new Error('No database in unit tests'); } }));

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
      open?.causes.push(t.cause);
      return !!open;
    },
    async dismissedAt() {
      return Math.max(...dismissed.filter(same(t)).map((d) => d.at)) || null;
    },
    async start() {
      plans.push({ id: `run-${++runs}`, playbook: t.playbook, zoneSlug: t.zoneSlug, causes: [t.cause] });
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
