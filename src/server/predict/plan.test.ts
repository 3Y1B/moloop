import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Batch, type World } from '@/lib/batch';
import type { MobilizationOutput } from '@/lib/mobilization-contracts';
import type { Volunteer } from '@/lib/schema';
import { planMobilization, playbookSteps } from './plan';

const at = Date.parse('2026-10-08T10:00:00Z');
const person = (id: string, over: Partial<Volunteer> = {}): Volunteer => ({
  id, name: id, role: 'volunteer', teamSlug: 'crowd', skills: [], languages: ['en'], zoneSlug: 'oval-stage',
  duty: 'on_duty', shiftEndsAt: null, phone: null, ...over,
});
const world = (): World => ({
  volunteers: Object.fromEntries([person('mo', { role: 'coordinator', teamSlug: null }), person('crowd-a'),
    person('crowd-b'), person('medic', { teamSlug: 'first-aid' })].map((v) => [v.id, v])),
  tasks: {}, proposals: {}, requests: {}, mobilizations: {}, teams: { crowd: { name: 'Crowd' } },
});

/** Each statement the planner sends, answered by what it asks for. */
const { db, calls, models, request } = vi.hoisted(() => {
  const calls: { sql: string; values: unknown[] }[] = [];
  const answer = (sql: string): unknown[] => {
    if (sql.includes('select * from mobilization_runs')) return [{ id: 'run-1', request_id: 'request-0123456789',
      status: 'running', playbook: 'crowd-crush-main-stage', zone_slug: 'oval-stage', causes: [] }];
    if (sql.includes('select name from zones')) return [{ name: 'Oval Stage' }];
    if (sql.includes('from zones order by name')) return [{ slug: 'oval-stage', name: 'Oval Stage', kind: 'stage',
      capacity: 5000, isOpenAir: true }];
    if (sql.includes('from teams')) return [{ slug: 'crowd', name: 'Crowd', description: 'Crowd' }];
    if (sql.includes('set raw_responses')) return [{ status: 'running' }];
    if (sql.includes('for update')) return [{ causes: [{ kind: 'report', taskId: 'task-1' }, { kind: 'report',
      taskId: 'task-2' }] }];
    return [];
  };
  const db = Object.assign((strings: TemplateStringsArray, ...values: unknown[]) => {
    const sql = strings.join('?');
    calls.push({ sql, values });
    return Promise.resolve(answer(sql));
  }, { json: (value: unknown) => value, begin: (fn: (q: unknown) => unknown) => Promise.resolve(fn(db)) });
  const models = { ready: true, generatePlan: vi.fn() };
  const request = { errors: [] as string[] };
  return { db, calls, models, request };
});
vi.mock('../world', () => ({
  sql: () => db,
  loadWorld: async () => ({ world: world() }),
  transact: async (_spec: unknown, run: (b: Batch) => unknown, _owners: unknown,
    afterSave: (tx: unknown, out: unknown, b: Batch) => Promise<void>) => {
    const b = new Batch(world(), { now: at, id: (kind) => `${kind}-1` });
    const out = run(b);
    await afterSave(db, out, b);
    lastBatch = b;
    return out;
  },
}));
vi.mock('../models', () => ({
  mobilizationModelReadiness: () =>
    ({ ready: models.ready, model: 'test-model', missing: models.ready ? [] : ['key'] }),
  generatePlan: models.generatePlan,
}));
vi.mock('./planning-request', () => ({
  createTriggeredPlanningRequest: async (_s: unknown, _b: unknown, audit: (read: unknown) => Promise<void>) => {
    await audit({});
    return { promptVersion: 'test', system: 'system', prompt: 'prompt', schema: {}, expand: (wire: unknown) => wire,
      validate: () => request.errors };
  },
}));
let lastBatch: Batch;

const output = (): MobilizationOutput => ({
  decision: 'propose', assessment: { summary: 'Crush at the barrier', severity: 'urgent', findings: [],
    missingInputs: [], playbookAssessments: [] },
  mobilizations: [{ title: 'Relieve the barrier', priority: 'P1', rationale: 'Reports of a crush', tasks: [{
    key: 'freeze-inflow', title: 'Stop entry to the front', instructions: 'Hold the lanes', teamSlug: 'crowd',
    zoneSlug: 'oval-stage', peopleNeeded: 6, reason: 'Crush reported', requiredSkills: [],
    completionCriteria: 'Lanes held', addressesFindingIds: [], evidenceRefs: ['incident-task-1'], playbookRefs: [],
  }], unmetRequirements: [] }],
});
/** The run's last write: its status, result, mobilizations and error. */
const finished = () => {
  const call = calls.findLast((c) => c.sql.includes('set status =') && c.sql.includes('result ='))!;
  const [status, result, , mobilizationIds, validationErrors, error] = call.values;
  return { status, result: result as MobilizationOutput | null, mobilizationIds, validationErrors, error };
};
const proposed = () => Object.values(lastBatch.mobilizations)[0];

describe('the planner always gives Mo a plan', () => {
  beforeEach(() => {
    calls.length = 0;
    models.ready = true;
    models.generatePlan.mockReset();
    request.errors = [];
  });

  it('uses the model’s plan when it passes the rules check, capped at the team on duty', async () => {
    models.generatePlan.mockResolvedValue(output());
    expect(await planMobilization('run-1')).toEqual(['mobilization-1']);
    const plan = proposed();
    expect(plan).toMatchObject({ title: 'Crowd surge, Oval Stage', analysisRunId: 'run-1',
      triggerPlaybook: 'crowd-crush-main-stage', zoneSlug: 'oval-stage' });
    expect(plan.steps.map((s) => [s.stepKey, s.peopleNeeded])).toEqual([['freeze-inflow', 2]]);
    // Approval checks the steps against the saved result, so it's capped the same.
    expect(finished()).toMatchObject({ status: 'completed', error: null, mobilizationIds: ['mobilization-1'] });
    expect(finished().result?.mobilizations[0].tasks[0].peopleNeeded).toBe(2);
    const causes = calls.find((c) => c.sql.includes('update mobilizations set causes'))!;
    expect(causes.values[0]).toHaveLength(2);
  });

  it('falls back to the playbook’s plan when the model fails', async () => {
    models.generatePlan.mockRejectedValue(new Error('chat 500 {"error":"secret body"}'));
    expect(await planMobilization('run-1')).toEqual(['mobilization-1']);
    const plan = proposed();
    expect(plan.analysisRunId).toBeNull();
    expect(plan.title).toBe('Crowd surge, Oval Stage');
    expect(plan.steps.map((s) => s.stepKey)).toEqual(
      playbookSteps('crowd-crush-main-stage', 'oval-stage').map((s) => s.stepKey));
    expect(plan.steps.every((s) => s.zoneSlug === 'oval-stage' && s.peopleNeeded >= 1)).toBe(true);
    expect(finished()).toMatchObject({ status: 'failed', error: 'Model provider returned HTTP 500',
      mobilizationIds: ['mobilization-1'] });
  });

  it('falls back when the rules check rejects the model’s plan, and keeps why', async () => {
    models.generatePlan.mockResolvedValue(output());
    request.errors = ['Unknown evidence ref reading-9'];
    await planMobilization('run-1');
    expect(proposed().analysisRunId).toBeNull();
    expect(proposed().steps).toHaveLength(8);
    expect(finished()).toMatchObject({ status: 'failed', error: 'Model output failed the rules check',
      validationErrors: ['Unknown evidence ref reading-9'] });
  });

  it('falls back when the model answers anything but a plan', async () => {
    models.generatePlan.mockResolvedValue({ ...output(), decision: 'insufficient_data', mobilizations: [] });
    await planMobilization('run-1');
    expect(proposed().analysisRunId).toBeNull();
    expect(finished().error).toBe('The model answered insufficient_data');
  });

  it('falls back without calling a model that isn’t configured', async () => {
    models.ready = false;
    await planMobilization('run-1');
    expect(models.generatePlan).not.toHaveBeenCalled();
    expect(proposed().steps).toHaveLength(8);
    expect(finished().status).toBe('failed');
  });
});
