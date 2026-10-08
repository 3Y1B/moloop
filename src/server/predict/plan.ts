import { CommandError, type Batch } from "@/lib/batch";
import * as C from "@/lib/commands";
import { freeForSteps, isFree } from "@/lib/lifecycle";
import type {
  ManagedPlaybook,
  MobilizationOutput,
  PlanningEvidence,
  PlanningSnapshot,
  PlaybookSlug,
  SimulationContext,
  SimulationInput,
  SimulationRunResult,
  TimetableEntry,
} from "@/lib/mobilization-contracts";
import {
  ObservationSchema,
  observationDefinition,
  observationIsMeaningful,
  observationReferenceErrors,
  type MobilizationObservation,
} from "@/lib/mobilization-observations";
import { routeBetween } from "@/lib/route";
import type { IncidentCategory, MobilizationCause, MobilizationStep, ReadingValue, Task } from "@/lib/schema";
import { generatePlan, mobilizationModelReadiness, type ModelDiagnostic, type ModelIdentity } from "../models";
import { playbooks } from "../playbooks";
import { PLAYBOOK_NAMES } from "../playbooks/festival";
import { loadWorld, sql, transact } from "../world";
import { createTriggeredPlanningRequest, type TriggerBrief } from "./planning-request";
import { plainPlan } from "./plain-text";
import { playbookKey } from "./playbook-retrieval";
import { mobilizationTimeouts } from "./timeouts";
import { groundMobilizationPlans } from "./validate";

/**
 * The mobilization planner. A trigger (src/server/triggers.ts) has chosen one playbook for one zone and saved a
 * `mobilization_runs` row; this reads the live data (readings from the last 30 minutes, reports from the last 20, who's
 * on duty and free) against that playbook and drafts one plan for Mo. The model's plan goes through the rules check
 * (validate.ts) first. If the model fails or its plan doesn't pass, Mo still gets a plan, straight from the playbook's
 * required actions: whatever triggers it, the result is a plan to approve.
 */

type Query = Parameters<typeof loadWorld>[0];
type RunRow = {
  id: string; request_id: string; requested_by: string | null; status: SimulationRunResult["status"];
  input_snapshot: PlanningSnapshot | null; result: SimulationRunResult["output"];
  mobilization_ids: string[]; validation_errors: string[]; error: string | null;
  prompt_version: string; model: string | null; created_at: string; updated_at: string;
  playbook: string | null; zone_slug: string | null; causes: MobilizationCause[];
};
const iso = (value: string) => new Date(value).toISOString();
export const MOBILIZATION_OUTPUT_TOKEN_BUDGET = 12_000;
/** Readings older than this aren't evidence (the plan's "latest readings from the last 30 minutes"). */
export const READING_WINDOW_MS = 30 * 60_000;
/**
 * A plan is on Mo's phone in about 20 seconds (the plan's target): past this the playbook's own plan goes instead.
 * One playbook, OpenAI: about 14 s.
 */
const TRIGGERED_MODEL_MS = 20_000;
/** Most people one step asks for (audit S4). Also never more than the team has free (capSteps). */
const MOST_PER_STEP = 10;

async function contextFrom(query: Query): Promise<SimulationContext> {
  const [zones, teams, skills, timetable] = await Promise.all([
    query<SimulationContext["zones"]>`
      select slug, name, kind, capacity, is_open_air as "isOpenAir" from zones order by name`,
    query<SimulationContext["teams"]>`select slug, name, description from teams order by name`,
    query<SimulationContext["skills"]>`select slug, name from skills order by name`,
    query<TimetableEntry[]>`
      select t.id, z.slug as "stageSlug", t.act, t.starts_at as "startsAt", t.ends_at as "endsAt",
        t.expected_people as "expectedPeople"
      from event_timetable t join zones z on z.id = t.stage_id order by t.starts_at limit 300`,
  ]);
  const readiness = mobilizationModelReadiness();
  return {
    zones, teams, skills, timetable: timetable.map((entry) => ({
      ...entry, startsAt: iso(entry.startsAt), endsAt: iso(entry.endsAt),
    })), playbooks: playbooks(),
    modelReady: readiness.ready,
    modelConfigurationMessage: readiness.ready ? null : `Configure ${readiness.missing.join("; ")}`,
  };
}

type IncidentRow = {
  id: string; report_id: string; title: string; summary: string; category: IncidentCategory;
  status: Task["status"]; zone_slug: string | null; created_at: string;
};
export type ReadingRow = {
  id: string; key: string; zone_slug: string | null; value: ReadingValue; observed_at: string;
  source: "sensor" | "simulated";
};

/** The latest reading of each key in each zone, from the last 30 minutes. */
export async function latestReadings(query: Query, at = Date.now()): Promise<ReadingRow[]> {
  return query<ReadingRow[]>`
    select distinct on (r.key, r.zone_id) r.id, r.key, z.slug as zone_slug, r.value, r.observed_at, r.source
    from readings r left join zones z on z.id = r.zone_id
    where r.observed_at > ${new Date(at - READING_WINDOW_MS).toISOString()}::timestamptz
      and r.observed_at <= ${new Date(at).toISOString()}::timestamptz
    order by r.key, r.zone_id, r.observed_at desc`;
}

const WEATHER = { temperature: "weather.temperature", warning: "weather.warning", condition: "weatherStatus" };

/**
 * What the readings say, in the planner's input shape: the built-in weather fields, and every other reading as an
 * observation. A reading that doesn't fit its catalog entry (wrong kind, unknown zone) is left out, never guessed at.
 */
export function scenarioFrom(readings: ReadingRow[], zoneSlugs: string[], requestId: string, at: number): SimulationInput {
  const site = (key: string) => readings.find((r) => r.key === key && r.zone_slug == null) ?? readings.find((r) => r.key === key);
  const temperature = site(WEATHER.temperature)?.value;
  const warning = site(WEATHER.warning)?.value;
  const condition = site(WEATHER.condition)?.value;
  const observations: MobilizationObservation[] = [];
  for (const r of readings) {
    if (Object.values(WEATHER).includes(r.key)) continue;
    const definition = observationDefinition(r.key);
    if (!definition) continue;
    const parsed = ObservationSchema.safeParse({
      key: r.key, zoneSlug: r.zone_slug, kind: definition.kind, value: r.value,
      minutesAgo: Math.max(0, Math.round((at - Date.parse(r.observed_at)) / 60_000)),
    });
    if (!parsed.success || observationReferenceErrors([...observations, parsed.data], zoneSlugs).length) continue;
    observations.push(parsed.data);
  }
  return {
    requestId,
    weather: {
      temperatureC: typeof temperature === "number" ? temperature : null,
      trendCPerHour: null,
      condition: condition === "clear" || condition === "rain" || condition === "storm" ? condition : null,
      warning: warning === "none" || warning === "heat" || warning === "storm" ? warning : null,
      warningInMinutes: null,
    },
    upcomingSets: [], crowdByZone: [], recentIncidents: [], observations,
  };
}

/** One consistent read of the venue, readings, recent reports and roster, with only the triggered playbook. */
async function captureSnapshot(playbook: PlaybookSlug, requestId: string) {
  return sql().begin(async (query) => {
    await query`set transaction isolation level repeatable read read only`;
    const evaluatedAt = new Date().toISOString();
    const at = Date.parse(evaluatedAt);
    const context = await contextFrom(query);
    context.playbooks = context.playbooks.filter((book) => book.content.slug === playbook);
    const readings = await latestReadings(query, at);
    const input = scenarioFrom(readings, context.zones.map((zone) => zone.slug), requestId, at);
    const { world } = await loadWorld(query);
    const volunteers = Object.values(world.volunteers);
    const tasks = Object.values(world.tasks);
    // Response work is never fed back as incident evidence. Include resolved source incidents too.
    const incidents = await query<IncidentRow[]>`
      select t.id, t.report_id, t.title, t.summary, t.category, t.status, z.slug as zone_slug, t.created_at
      from tasks t join reports r on r.id = t.report_id left join zones z on z.id = t.zone_id
      where t.mobilization_id is null
        and t.created_at <= ${evaluatedAt}::timestamptz
        and t.created_at >= ${new Date(at - 20 * 60_000).toISOString()}::timestamptz
      order by t.created_at, t.id limit 100`;
    const evidence = buildEvidence(input, context, incidents, evaluatedAt);
    evidence.push({ ref: "database-incident-window", kind: "incident_window", zoneSlug: null,
      observedAt: evaluatedAt, source: "database", value: {
        windowMinutes: 20, sourceReportCount: incidents.length, possiblyTruncated: incidents.length === 100,
        note: "Recorded source reports only, not proof that no unreported incident exists",
      } });
    for (const team of context.teams) {
      const roster = volunteers.filter((person) => person.role === "volunteer" && person.teamSlug === team.slug);
      const onDuty = roster.filter((person) => person.duty === "on_duty" &&
        (person.shiftEndsAt == null || person.shiftEndsAt > at));
      const free = roster.filter((person) => isFree(person, [], tasks, at));
      evidence.push({
        ref: `roster-${team.slug}`, kind: "roster", zoneSlug: null,
        observedAt: evaluatedAt, source: "database", value: {
          teamSlug: team.slug, onDuty: onDuty.length, free: free.length,
          freeBySkill: Object.fromEntries(context.skills.map((skill) => [skill.slug,
            free.filter((person) => person.skills.includes(skill.slug)).length])),
        },
      });
    }
    const routes: PlanningSnapshot["routes"] = [];
    for (const from of context.zones)
      for (const to of context.zones) {
        if (from.slug >= to.slug) continue;
        const route = routeBetween(from.slug, to.slug);
        if (route) routes.push({ from: from.slug, to: to.slug, minutes: route.minutes, meters: Math.round(route.meters) });
      }
    const snapshot: PlanningSnapshot = {
      schemaVersion: 1, evaluatedAt, scenario: input,
      zones: context.zones, teams: context.teams, skills: context.skills, routes,
      roster: volunteers.map((person) => ({
        id: person.id, name: person.name, teamSlug: person.teamSlug, zoneSlug: person.zoneSlug,
        duty: person.duty, skills: [...person.skills], shiftEndsAt: person.shiftEndsAt,
        free: isFree(person, [], tasks, at),
      })),
      existingResponses: tasks.map((task) => ({
        id: task.id, title: task.title, status: task.status, teamSlug: task.teamSlug,
        zoneSlug: task.zoneSlug, mobilizationId: task.mobilizationId, requiredCount: task.requiredCount,
      })),
      evidence, playbooks: context.playbooks,
    };
    // JSON clone fixes the audit input independently of future mutations to world objects.
    return { snapshot: JSON.parse(JSON.stringify(snapshot)) as PlanningSnapshot, context, readings };
  });
}

/** Evidence the planner may cite, each with a ref the rules check holds it to. */
export function buildEvidence(
  input: SimulationInput,
  context: SimulationContext,
  incidents: IncidentRow[],
  evaluatedAt: string,
): PlanningEvidence[] {
  const at = Date.parse(evaluatedAt);
  const evidence: PlanningEvidence[] = [];
  const weather = Object.fromEntries(Object.entries(input.weather).filter(([, value]) => value != null));
  if (Object.keys(weather).length)
    evidence.push({ ref: "weather-latest", kind: "weather", zoneSlug: null, observedAt: evaluatedAt,
      source: "database", value: weather });
  for (const zone of context.zones)
    evidence.push({ ref: `venue-${zone.slug}`, kind: "venue", zoneSlug: zone.slug,
      observedAt: evaluatedAt, source: "database", value: { ...zone } });
  for (const [index, set] of input.upcomingSets.entries())
    evidence.push({
      ref: `set-${index}`, kind: "upcoming_set", zoneSlug: set.stageSlug,
      observedAt: evaluatedAt, source: "database", value: {
        ...set, startsAt: new Date(at + set.startsInMinutes * 60_000).toISOString(),
        endsAt: new Date(at + (set.startsInMinutes + set.durationMinutes) * 60_000).toISOString(),
      },
    });
  const overridden = new Set(input.upcomingSets.map((set) => set.stageSlug));
  for (const set of context.timetable) {
    if (overridden.has(set.stageSlug) || Date.parse(set.startsAt) < at) continue;
    evidence.push({
      ref: `timetable-${set.id}`, kind: "upcoming_set", zoneSlug: set.stageSlug,
      observedAt: evaluatedAt, source: "database", value: { ...set, startsInMinutes: Math.round((Date.parse(set.startsAt) - at) / 60_000) },
    });
  }
  for (const [index, crowd] of input.crowdByZone.entries())
    evidence.push({ ref: `crowd-${index}`, kind: "crowd", zoneSlug: crowd.zoneSlug,
      observedAt: evaluatedAt, source: "database", value: { ...crowd } });
  for (const [index, incident] of input.recentIncidents.entries())
    evidence.push({ ref: `reported-${index}`, kind: "incident", zoneSlug: incident.zoneSlug,
      observedAt: new Date(at - incident.minutesAgo * 60_000).toISOString(),
      source: "database", value: { ...incident } });
  for (const [index, row] of (input.observations ?? []).entries()) {
    if (!observationIsMeaningful(row)) continue;
    const definition = observationDefinition(row.key);
    evidence.push({ ref: `observation-${index}`, kind: "observation", zoneSlug: row.zoneSlug,
      observedAt: new Date(at - row.minutesAgo * 60_000).toISOString(), source: "database",
      value: { key: row.key, kind: row.kind, value: row.value, unit: definition?.unit ?? null,
        scope: row.zoneSlug == null ? "site" : "zone", approvalRequired: definition?.approvalRequired ?? false },
    });
  }
  for (const incident of incidents) {
    const incidentAt = Date.parse(incident.created_at);
    if (!Number.isFinite(incidentAt) || incidentAt > at || incidentAt < at - 20 * 60_000) continue;
    evidence.push({ ref: `incident-${incident.id}`, kind: "incident", zoneSlug: incident.zone_slug,
      observedAt: iso(incident.created_at), source: "database", value: {
        taskId: incident.id, reportId: incident.report_id, title: incident.title, description: incident.summary,
        category: incident.category, count: 1, openCount: ["resolved", "cancelled"].includes(incident.status) ? 0 : 1,
      } });
  }
  return evidence;
}

/** The trigger's causes as the model reads them: plain words, and the evidence refs behind them. */
export function briefFor(playbook: PlaybookSlug, zoneSlug: string | null, causes: MobilizationCause[],
  snapshot: PlanningSnapshot): TriggerBrief {
  const refs = new Set(snapshot.evidence.map((entry) => entry.ref));
  const observationRef = (key: string, zone: string | null) => snapshot.evidence.find((entry) =>
    entry.kind === "observation" && entry.value.key === key && entry.zoneSlug === zone)?.ref;
  const why: string[] = [];
  const evidenceRefs: string[] = [];
  for (const cause of causes) {
    if (cause.kind === "report") {
      why.push(`${cause.priority} report: ${cause.title}`);
      if (refs.has(`incident-${cause.taskId}`)) evidenceRefs.push(`incident-${cause.taskId}`);
    } else {
      const definition = observationDefinition(cause.key);
      const value = typeof cause.value === "number" && definition?.unit ? `${cause.value} ${definition.unit}` : String(cause.value);
      why.push(`${definition?.label ?? cause.key}: ${value}${cause.line ? ` (${cause.line})` : ""}`);
      const ref = observationRef(cause.key, cause.zoneSlug) ??
        (Object.values(WEATHER).includes(cause.key) && refs.has("weather-latest") ? "weather-latest" : undefined);
      if (ref) evidenceRefs.push(ref);
    }
  }
  return { playbookKey: playbookKey(playbook, 1), zoneSlug, why, evidenceRefs: [...new Set(evidenceRefs)] };
}

type PlaybookAction = ManagedPlaybook["content"]["actions"][number];
const bookFor = (playbook: PlaybookSlug) => {
  const book = playbooks().find((entry) => entry.content.slug === playbook);
  if (!book) throw new Error(`No playbook ${playbook}`);
  return book;
};
/** One playbook action as it reads on a step: its own words, the people it names (else 2). */
const actionFields = (book: ManagedPlaybook, action: PlaybookAction) => ({
  teamSlug: action.teamSlug,
  peopleNeeded: action.peopleNeeded ?? 2,
  title: action.title,
  instructions: action.instructions,
  reason: action.title,
  requiredSkills: action.requiredSkills,
  playbookRefs: [{ slug: book.content.slug, version: book.version, actionId: action.id }],
});

/**
 * A plan straight from the playbook: its required actions, at the trigger's zone. What Mo gets when the model can't
 * give a plan that passes the rules check.
 */
export function playbookSteps(playbook: PlaybookSlug, zoneSlug: string | null): MobilizationStep[] {
  const book = bookFor(playbook);
  return book.content.actions.filter((action) => action.requirement === "must").map((action) => ({
    ...actionFields(book, action),
    stepKey: action.id,
    candidates: [],
    zoneSlug,
    ...(action.completionCriteria ? { completionCriteria: action.completionCriteria } : {}),
  }));
}

/**
 * Every required action of the triggered playbook reaches Mo as a step. The model's tasks stay as written; a required
 * action it left as a gap (a blocker, or nothing) is added straight from the playbook, onto the first plan, so one gap
 * never costs Mo the rest of a good plan (audit S5). Returns the actions it added.
 */
export function completeRequiredActions(output: MobilizationOutput, playbook: PlaybookSlug,
  zoneSlug: string | null): { output: MobilizationOutput; added: string[] } {
  const book = bookFor(playbook);
  const first = output.mobilizations[0];
  if (output.decision !== "propose" || !first) return { output, added: [] };
  const mine = (ref: { slug: string; version: number }) => ref.slug === book.content.slug && ref.version === book.version;
  const covered = new Set(output.mobilizations.flatMap((plan) =>
    plan.tasks.flatMap((task) => task.playbookRefs.filter(mine).map((ref) => ref.actionId))));
  const missing = book.content.actions.filter((action) => action.requirement === "must" && !covered.has(action.id));
  if (!missing.length) return { output, added: [] };
  // Every proposal has a finding (validate.ts); an added task answers the first, on its evidence.
  const finding = output.assessment.findings[0];
  if (!finding) throw new Error("No finding to add the missing required actions to");
  const keys = new Set(output.mobilizations.flatMap((plan) => plan.tasks.map((task) => task.key)));
  const keyFor = (id: string) => {
    let key = id;
    for (let n = 2; keys.has(key); n++) key = `${id}-${n}`;
    keys.add(key);
    return key;
  };
  const added = new Set(missing.map((action) => action.id));
  const zone = zoneSlug ?? first.tasks[0].zoneSlug;
  const tasks = missing.map((action) => ({
    ...actionFields(book, action),
    key: keyFor(action.id),
    zoneSlug: zone,
    completionCriteria: action.completionCriteria || action.title,
    addressesFindingIds: [finding.id],
    evidenceRefs: [...finding.evidenceRefs],
  }));
  return {
    added: [...added],
    output: {
      ...output,
      mobilizations: output.mobilizations.map((plan, index) => ({
        ...plan,
        tasks: index === 0 ? [...plan.tasks, ...tasks] : plan.tasks,
        unmetRequirements: plan.unmetRequirements.filter((gap) =>
          !(mine(gap.playbookRef) && added.has(gap.playbookRef.actionId))),
      })),
    },
  };
}

/**
 * No step asks for more people than its team has free right now (on shift, with the step's skills, not on another
 * task; each person counted once across the plan's steps, as Mo's review counts the shortfall), nor more than ten
 * (audit S4). A step with nobody free still asks for one: the review shows it as short and approval keeps trying.
 */
export function capSteps(steps: MobilizationStep[], b: Pick<Batch, "volunteers" | "now" | "all">): MobilizationStep[] {
  const asked = steps.map((step) => ({ ...step, peopleNeeded: Math.min(step.peopleNeeded, MOST_PER_STEP) }));
  const free = freeForSteps(asked, Object.values(b.volunteers), b.all(), b.now);
  return asked.map((step, i) => ({ ...step, peopleNeeded: Math.max(1, free[i]) }));
}

/** "Severe storm, Lawn Stage". */
const titleFor = (playbook: PlaybookSlug, zoneName: string | undefined) =>
  zoneName ? `${PLAYBOOK_NAMES[playbook]}, ${zoneName}` : PLAYBOOK_NAMES[playbook];

/**
 * Run the planner for a run a trigger saved. Never throws: a failure is recorded on the run, and Mo gets the
 * playbook's own plan instead.
 */
export async function planMobilization(runId: string): Promise<string[]> {
  const db = sql();
  const [run] = await db<RunRow[]>`select * from mobilization_runs where id = ${runId}`;
  if (!run || run.status !== "running" || !run.playbook) return [];
  const playbook = run.playbook as PlaybookSlug;
  const zoneSlug = run.zone_slug;
  const t0 = Date.now();
  type AuditEntry = ModelIdentity & (
    { event: "attempt" | "reply" | "tool_result"; content?: string } |
    { event: "diagnostic"; occurredAt: string; diagnostic: ModelDiagnostic }
  );
  const readiness = mobilizationModelReadiness();
  let actualModel = readiness.model;
  const record = async (entry: AuditEntry | { event: "server_read"; content: string }) => {
    // Appending cannot erase another provider's reply. A late reply is evidence only.
    const saved = await db<{ status: string }[]>`update mobilization_runs
      set raw_responses = raw_responses || ${db.json([entry] as Parameters<typeof db.json>[0])}::jsonb,
        model = case when status = 'running' then ${actualModel} else model end,
        updated_at = case when status = 'running' then clock_timestamp() else updated_at end
      where id = ${runId} returning status`;
    if (!saved.length || (entry.event === "attempt" && saved[0].status !== "running"))
      throw new Error("Plan run is no longer pending");
  };

  let output: SimulationRunResult["output"] = null;
  let validationErrors: string[] = [];
  let failure: string | null = null;
  let filled: string[] = [];
  const [zone] = zoneSlug ? await db<{ name: string }[]>`select name from zones where slug = ${zoneSlug}` : [];
  const title = titleFor(playbook, zone?.name);
  try {
    const { snapshot } = await captureSnapshot(playbook, run.request_id);
    const brief = briefFor(playbook, zoneSlug, run.causes, snapshot);
    const planning = await createTriggeredPlanningRequest(snapshot, brief,
      (read) => record({ event: "server_read", content: JSON.stringify(read) }));
    await db`update mobilization_runs set input_snapshot = ${db.json(snapshot as Parameters<typeof db.json>[0])},
      system_prompt = ${planning.system}, user_prompt = ${planning.prompt}, prompt_version = ${planning.promptVersion},
      updated_at = clock_timestamp() where id = ${runId}`;
    if (!readiness.ready) throw new Error(`Configure ${readiness.missing.join("; ")}`);
    const budget =
      Math.min(mobilizationTimeouts(process.env.MOBILIZATION_MODEL_TIMEOUT_MS).modelTimeoutMs, TRIGGERED_MODEL_MS);
    const wire = await generatePlan({ system: planning.system, prompt: planning.prompt, schema: planning.schema }, {
      timeoutMs: budget, signal: AbortSignal.timeout(budget + 5_000),
      reasoningEffort: process.env.MOBILIZATION_REASONING_EFFORT ?? "low",
      maxTokens: MOBILIZATION_OUTPUT_TOKEN_BUDGET,
      onAttempt: async (identity) => {
        actualModel = identity.model;
        await record({ event: "attempt", ...identity });
      },
      onResponse: (content, identity) => record({ event: "reply", ...identity, content }),
      onDiagnostic: (diagnostic, identity) => record({
        event: "diagnostic", ...identity, occurredAt: new Date().toISOString(), diagnostic,
      }),
    });
    output = planning.expand(wire);
    validationErrors = planning.validate(output);
    if (validationErrors.length) throw new Error("Model output failed the rules check");
    if (output.decision !== "propose") throw new Error(`The model answered ${output.decision}`);
    // Required actions the model left as gaps come from the playbook; then the text people read is made plain. The
    // saved result is what approval checks the steps against, so it's this version, checked again.
    const completed = completeRequiredActions(output, playbook, zoneSlug);
    filled = completed.added;
    output = plainPlan(completed.output, snapshot);
    validationErrors = planning.validate(output);
    if (validationErrors.length) throw new Error("The completed plan failed the rules check");
  } catch (error) {
    failure = safeFailure(error);
  }

  const modelPlan = failure == null && output?.decision === "propose" ? output : null;
  try {
    const ids = await transact(
      {},
      (b) => {
        if (modelPlan) {
          const grounded = groundMobilizationPlans(modelPlan, Object.values(b.volunteers), b.all(), b.now);
          return modelPlan.mobilizations.map((plan, index) => {
            const refs = [...new Set(plan.tasks.flatMap((task) => task.playbookRefs.map((ref) => ref.slug)))];
            const steps = capSteps(grounded[index], b);
            // The saved result is what approval checks the steps against (mobilization-review.ts): capped alike.
            plan.tasks.forEach((task, i) => (task.peopleNeeded = steps[i].peopleNeeded));
            return C.proposeMobilization(b, {
              title: modelPlan.mobilizations.length > 1 ? `${title}: ${plan.title}` : title,
              rationale: plan.rationale, urgency: plan.priority, zoneSlug,
              relatedPlaybooks: refs.length ? refs : [playbook], steps,
              analysisRunId: runId, triggerPlaybook: playbook,
            }).id;
          });
        }
        const book = playbooks().find((entry) => entry.content.slug === playbook)!;
        return [C.proposeMobilization(b, {
          title, rationale: book.content.appliesWhen, urgency: "P1", zoneSlug, relatedPlaybooks: [playbook],
          steps: capSteps(playbookSteps(playbook, zoneSlug), b), triggerPlaybook: playbook,
        }).id];
      },
      {},
      async (tx, mobilizationIds) => {
        // Causes a later trigger added while the planner worked come along. Locked so none lands in between.
        const [current] = await tx<{ causes: MobilizationCause[] }[]>`
          select causes from mobilization_runs where id = ${runId} for update`;
        const causes = tx.json((current?.causes ?? []) as Parameters<typeof tx.json>[0]);
        await tx`update mobilizations set causes = causes || ${causes}::jsonb
          where id = any(${mobilizationIds}::uuid[])`;
        await tx`update mobilization_runs set status = ${failure ? "failed" : "completed"},
          result = ${output == null ? null : tx.json(output as Parameters<typeof tx.json>[0])}, model = ${actualModel},
          mobilization_ids = ${mobilizationIds}::uuid[], validation_errors = ${tx.json(validationErrors)},
          error = ${failure}, updated_at = clock_timestamp() where id = ${runId}`;
      },
    );
    const from = modelPlan ? `model${filled.length ? ` + ${filled.length} from the playbook` : ""}` : `playbook (${failure})`;
    console.log(`plan ${playbook} ${zoneSlug ?? "site"}: ${from} in ${Date.now() - t0} ms`);
    return ids;
  } catch (error) {
    await db`update mobilization_runs set status = 'failed', error = ${safeFailure(error)},
      updated_at = clock_timestamp() where id = ${runId}`;
    console.error(`plan ${runId} failed`, error);
    return [];
  }
}

function safeFailure(error: unknown): string {
  // Provider error bodies can echo credentials. Store actionable type/status without their body.
  if (error instanceof CommandError) return error.message;
  if (error instanceof Error) {
    const status = error.message.match(/^chat (\d{3})/);
    if (status) return `Model provider returned HTTP ${status[1]}`;
    if (error.name === "TimeoutError" || error.name === "AbortError") return "Model request timed out";
    return error.message.slice(0, 1200);
  }
  return "Mobilization generation failed";
}
