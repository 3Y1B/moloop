import { Batch, CommandError } from "@/lib/batch";
import * as C from "@/lib/commands";
import { isBusy } from "@/lib/lifecycle";
import {
  PlaybookContentSchema,
  SimulationInputSchema,
  type ManagedPlaybook,
  type PlanningEvidence,
  type PlanningSnapshot,
  type SimulationContext,
  type SimulationInput,
  type SimulationRunResult,
  type TimetableEntry,
} from "@/lib/mobilization-contracts";
import { routeBetween } from "@/lib/route";
import { observationDefinition, observationIsMeaningful } from "@/lib/mobilization-observations";
import type { IncidentCategory, Task, Volunteer } from "@/lib/schema";
import { mobilizationModelReadiness, generateWithReadTool, type ModelDiagnostic, type ModelIdentity } from "../models";
import { loadWorld, sql, transact } from "../world";
import { createMobilizationPlanningRequest } from "./planning-request";
import { mobilizationStaleRunTimeoutMs, mobilizationTimeouts } from "./timeouts";
import { groundMobilizationPlans, validateScenario } from "./validate";

type Query = Parameters<typeof loadWorld>[0];
type BookRow = {
  id: string; version: number; status: "published"; content: unknown;
  created_at: string; updated_at: string; published_at: string;
};
type RunRow = {
  id: string; request_id: string; requested_by: string; status: SimulationRunResult["status"];
  input_snapshot: PlanningSnapshot | null; result: SimulationRunResult["output"];
  mobilization_ids: string[]; validation_errors: string[]; error: string | null;
  prompt_version: string; model: string | null; created_at: string; updated_at: string;
};
const iso = (value: string) => new Date(value).toISOString();
/** updatedAt is an opaque optimistic-concurrency token; preserve PostgreSQL's microseconds. */
const preciseTimestamp = (value: string) => value.replace(" ", "T")
  .replace(/([+-]\d{2})$/, "$1:00").replace(/\+00:00$/, "Z");
export const MOBILIZATION_OUTPUT_TOKEN_BUDGET = 12_000;

async function contextFrom(query: Query): Promise<SimulationContext> {
  const [zones, teams, skills, timetable, books] = await Promise.all([
    query<SimulationContext["zones"]>`
      select slug, name, kind, capacity, is_open_air as "isOpenAir" from zones order by name`,
    query<SimulationContext["teams"]>`select slug, name, description from teams order by name`,
    query<SimulationContext["skills"]>`select slug, name from skills order by name`,
    query<TimetableEntry[]>`
      select t.id, z.slug as "stageSlug", t.act, t.starts_at as "startsAt", t.ends_at as "endsAt",
        t.expected_people as "expectedPeople"
      from event_timetable t join zones z on z.id = t.stage_id order by t.starts_at limit 300`,
    query<BookRow[]>`select * from playbook_versions where status = 'published' order by slug, version`,
  ]);
  const readiness = mobilizationModelReadiness();
  let timeoutConfigurationMessage: string | null = null;
  try { mobilizationTimeouts(process.env.MOBILIZATION_MODEL_TIMEOUT_MS); }
  catch (error) { timeoutConfigurationMessage = error instanceof Error ? error.message : "Invalid Mobilization timeout configuration"; }
  const playbooks: ManagedPlaybook[] = books.map((book) => ({
    id: book.id,
    version: book.version,
    status: book.status,
    content: PlaybookContentSchema.parse(book.content),
    createdAt: preciseTimestamp(book.created_at),
    updatedAt: preciseTimestamp(book.updated_at),
    publishedAt: preciseTimestamp(book.published_at),
  }));
  return {
    zones, teams, skills, timetable: timetable.map((entry) => ({
      ...entry, startsAt: iso(entry.startsAt), endsAt: iso(entry.endsAt),
    })), playbooks,
    modelReady: readiness.ready && timeoutConfigurationMessage == null,
    modelConfigurationMessage: timeoutConfigurationMessage ??
      (readiness.ready ? null : `Configure ${readiness.missing.join("; ")}`),
  };
}

export async function simulationContext(): Promise<SimulationContext> {
  return contextFrom(sql());
}

type IncidentRow = {
  id: string; report_id: string; title: string; summary: string; category: IncidentCategory;
  status: Task["status"]; zone_slug: string | null; created_at: string;
};

/** A single consistent DB read; changing scenario controls never mutates venue, timetable or roster. */
async function captureSnapshot(input: SimulationInput): Promise<{
  snapshot: PlanningSnapshot; context: SimulationContext; volunteers: Volunteer[]; tasks: Task[];
}> {
  return sql().begin(async (query) => {
    await query`set transaction isolation level repeatable read read only`;
    const evaluatedAt = new Date().toISOString();
    const at = Date.parse(evaluatedAt);
    const context = await contextFrom(query);
    const errors = validateScenario(input, context);
    if (errors.length) throw new CommandError("invalid", errors.join("; "));
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
      const free = onDuty.filter((person) => !isBusy(tasks, person.id));
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
        free: person.role === "volunteer" && person.duty === "on_duty" &&
          (person.shiftEndsAt == null || person.shiftEndsAt > at) && !isBusy(tasks, person.id),
      })),
      existingResponses: tasks.map((task) => ({
        id: task.id, title: task.title, status: task.status, teamSlug: task.teamSlug,
        zoneSlug: task.zoneSlug, mobilizationId: task.mobilizationId, requiredCount: task.requiredCount,
      })),
      evidence, playbooks: context.playbooks,
    };
    // JSON clone fixes the audit input independently of future mutations to world objects.
    return { snapshot: JSON.parse(JSON.stringify(snapshot)) as PlanningSnapshot, context, volunteers, tasks };
  });
}

export function buildEvidence(
  input: SimulationInput,
  context: SimulationContext,
  incidents: IncidentRow[],
  evaluatedAt: string,
): PlanningEvidence[] {
  const at = Date.parse(evaluatedAt);
  const evidence: PlanningEvidence[] = [{
    ref: "demo-weather", kind: "weather", zoneSlug: null, observedAt: evaluatedAt,
    source: "manual_demo", value: { ...input.weather },
  }];
  for (const zone of context.zones)
    evidence.push({ ref: `venue-${zone.slug}`, kind: "venue", zoneSlug: zone.slug,
      observedAt: evaluatedAt, source: "database", value: { ...zone } });
  for (const [index, set] of input.upcomingSets.entries())
    evidence.push({
      ref: `demo-set-${index}`, kind: "upcoming_set", zoneSlug: set.stageSlug,
      observedAt: evaluatedAt, source: "manual_demo", value: {
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
    evidence.push({ ref: `demo-crowd-${index}`, kind: "crowd", zoneSlug: crowd.zoneSlug,
      observedAt: evaluatedAt, source: "manual_demo", value: { ...crowd } });
  for (const [index, incident] of input.recentIncidents.entries())
    evidence.push({ ref: `demo-incident-${index}`, kind: "incident", zoneSlug: incident.zoneSlug,
      observedAt: new Date(at - incident.minutesAgo * 60_000).toISOString(),
      source: "manual_demo", value: { ...incident } });
  for (const [index, row] of (input.observations ?? []).entries()) {
    if (!observationIsMeaningful(row)) continue;
    const definition = observationDefinition(row.key);
    evidence.push({ ref: `observation-${index}`, kind: "observation", zoneSlug: row.zoneSlug,
      observedAt: new Date(at - row.minutesAgo * 60_000).toISOString(), source: "manual_demo",
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

function toResult(row: RunRow): SimulationRunResult {
  return {
    runId: row.id, status: row.status, decision: row.result?.decision ?? null, output: row.result,
    mobilizationIds: row.mobilization_ids, validationErrors: row.validation_errors,
    error: row.error, snapshot: row.input_snapshot, promptVersion: row.prompt_version,
    model: row.model, createdAt: iso(row.created_at),
  };
}

export async function simulationRun(id: string, actorId?: string): Promise<SimulationRunResult | null> {
  // Expiration must outlast the configured model budget, whole-call bound and DB commit buffer.
  const staleRunTimeoutMs = mobilizationStaleRunTimeoutMs(process.env.MOBILIZATION_MODEL_TIMEOUT_MS);
  if (actorId)
    await sql()`update mobilization_runs set status = 'failed',
      error = 'Generation was interrupted; start a new simulation', updated_at = clock_timestamp()
      where id = ${id} and requested_by = ${actorId} and status = 'running'
        and updated_at < clock_timestamp() - (${staleRunTimeoutMs} * interval '1 millisecond')`;
  else
    await sql()`update mobilization_runs set status = 'failed',
      error = 'Generation was interrupted; start a new simulation', updated_at = clock_timestamp()
      where id = ${id} and status = 'running'
        and updated_at < clock_timestamp() - (${staleRunTimeoutMs} * interval '1 millisecond')`;
  const rows = actorId
    ? await sql()<RunRow[]>`select * from mobilization_runs where id = ${id} and requested_by = ${actorId}`
    : await sql()<RunRow[]>`select * from mobilization_runs where id = ${id}`;
  return rows[0] ? toResult(rows[0]) : null;
}

const canonical = (value: unknown): string => {
  if (value == null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(",")}}`;
};

/** One audited run: one read-only SOP retrieval round, then final JSON; Mo approval is separate. */
export async function simulateMobilization(input: SimulationInput, actorId: string): Promise<SimulationRunResult> {
  const parsed = SimulationInputSchema.safeParse(input);
  if (!parsed.success) throw new CommandError("invalid", parsed.error.issues.map((issue) => issue.message).join("; "));
  input = parsed.data;
  const db = sql();
  const existing = await db<RunRow[]>`
    select * from mobilization_runs where requested_by = ${actorId} and request_id = ${input.requestId}`;
  if (existing[0]) return matchingRun(existing[0], input);

  const timeouts = mobilizationTimeouts(process.env.MOBILIZATION_MODEL_TIMEOUT_MS);

  const captured = await captureSnapshot(input);
  const { snapshot } = captured;
  const readiness = mobilizationModelReadiness();
  const planning = createMobilizationPlanningRequest(snapshot);
  const id = crypto.randomUUID();
  const inserted = await db<RunRow[]>`
    insert into mobilization_runs ${db({
      id, request_id: input.requestId, requested_by: actorId, status: "running",
      input_snapshot: db.json(snapshot as Parameters<typeof db.json>[0]), system_prompt: planning.system,
      user_prompt: planning.prompt, prompt_version: planning.promptVersion, model: readiness.model,
    })}
    on conflict (requested_by, request_id) do nothing returning *`;
  if (!inserted.length) {
    const raced = await db<RunRow[]>`
      select * from mobilization_runs where requested_by = ${actorId} and request_id = ${input.requestId}`;
    return matchingRun(raced[0], input);
  }
  if (!readiness.ready) {
    await db`update mobilization_runs set status = 'configuration_required',
      error = ${`Configure ${readiness.missing.join("; ")}`}, updated_at = clock_timestamp() where id = ${id}`;
    return (await simulationRun(id, actorId))!;
  }

  type AuditEntry = ModelIdentity & (
    { event: "attempt" | "reply" | "tool_result"; content?: string } |
    { event: "diagnostic"; occurredAt: string; diagnostic: ModelDiagnostic }
  );
  let actualModel = readiness.model;
  let attemptedIdentity: ModelIdentity | null = null;
  const record = async (entry: AuditEntry) => {
    // Appending cannot erase another provider's reply. A late canceled reply is evidence only:
    // retain it even after completion/failure, without reviving the run or replacing its final model.
    const saved = await db<{ status: string }[]>`update mobilization_runs
      set raw_responses = raw_responses || ${db.json([entry])}::jsonb,
        model = case when status = 'running' then ${actualModel} else model end,
        updated_at = case when status = 'running' then clock_timestamp() else updated_at end
      where id = ${id} returning status`;
    if (!saved.length || (entry.event === "attempt" && saved[0].status !== "running"))
      throw new Error("Simulation run is no longer pending");
  };
  let output: SimulationRunResult["output"] = null;
  let validationErrors: string[] = [];
  try {
    const wire = await generateWithReadTool({
      system: planning.system, prompt: planning.prompt, schema: planning.schema,
      tool: {
        name: "get_playbooks",
        description: "Read captured published SOP versions in one batch for observed or plausible trigger clues. Unmeasured unrelated sensors are not triggers. Include relevant uncertain SOPs; no creation, approval or dispatch. Use [] when no supplied evidence warrants a SOP, never as proof of safety.",
        args: planning.args,
        execute: async (args, callId) => {
          if (!attemptedIdentity) throw new Error("Playbook retrieval requires a recorded model attempt");
          const identity = attemptedIdentity;
          return planning.read(args, async (result) => {
            // Mandatory audit before final-schema resolution; no DB re-read mid-run.
            await record({ event: "tool_result", ...identity,
              content: JSON.stringify({ name: "get_playbooks", callId, arguments: args, output: result }) });
          });
        },
      },
    }, {
      timeoutMs: timeouts.modelTimeoutMs, signal: AbortSignal.timeout(timeouts.wholeCallTimeoutMs),
      reasoningEffort: readiness.reasoningEffort ?? "medium",
      maxTokens: MOBILIZATION_OUTPUT_TOKEN_BUDGET,
      onAttempt: async (identity) => {
        actualModel = identity.model;
        attemptedIdentity = identity;
        await record({ event: "attempt", ...identity });
      },
      onResponse: (content, identity) => record({ event: "reply", ...identity, content }),
      // Transport diagnostics are best-effort; the mandatory attempt/reply audit remains fail-closed.
      // The model facade emits allowlisted metadata only, never headers, URLs or provider error bodies.
      onDiagnostic: (diagnostic, identity) => record({
        event: "diagnostic", ...identity, occurredAt: new Date().toISOString(), diagnostic,
      }),
    });
    output = planning.expand(wire);
    validationErrors = planning.validate(output);
    if (validationErrors.length) throw new Error("Model output failed semantic validation");
    const validOutput = output;
    // Proposals and their completed audit commit together. A failure cannot leave an orphaned plan.
    await transact(
      {},
      (batch) => validOutput.decision === "propose" ? proposeGroundedPlans(batch, validOutput, id) : [],
      {},
      async (tx, mobilizationIds) => {
        const cited = validOutput.mobilizations.flatMap((plan) => [
          ...plan.tasks.flatMap((task) => task.playbookRefs),
          ...plan.unmetRequirements.map((requirement) => requirement.playbookRef),
        ]);
        if (cited.length) {
          const current = await tx<{ slug: string; version: number }[]>`
            select slug, version from playbook_versions where status = 'published'
              and slug = any(${[...new Set(cited.map((ref) => ref.slug))]}::text[]) for share`;
          const published = new Set(current.map((book) => `${book.slug}:${book.version}`));
          if (cited.some((ref) => !published.has(`${ref.slug}:${ref.version}`)))
            throw new CommandError("conflict", "A cited playbook changed during generation; start a new simulation");
        }
        const completed = await tx<{ id: string }[]>`
          update mobilization_runs set status = 'completed', result = ${tx.json(validOutput)},
            model = ${actualModel}, mobilization_ids = ${mobilizationIds}::uuid[],
            updated_at = clock_timestamp() where id = ${id} and status = 'running' returning id`;
        if (!completed.length) throw new CommandError("conflict", "Simulation run is no longer pending");
      },
    );
  } catch (error) {
    await db`update mobilization_runs set status = 'failed',
      result = ${output == null ? null : db.json(output)}, model = ${actualModel},
      validation_errors = ${db.json(validationErrors)}, error = ${safeFailure(error)},
      updated_at = clock_timestamp() where id = ${id}`;
  }
  return (await simulationRun(id, actorId))!;
}

function matchingRun(row: RunRow, input: SimulationInput): SimulationRunResult {
  if (canonical(row.input_snapshot?.scenario) !== canonical(input))
    throw new CommandError("conflict", "This requestId already belongs to a different scenario");
  return toResult(row);
}

function safeFailure(error: unknown): string {
  // Provider error bodies can echo credentials. Store actionable type/status without their body.
  if (error instanceof Error) {
    const status = error.message.match(/^chat (\d{3})/);
    if (status) return `Model provider returned HTTP ${status[1]}`;
    if (error.name === "TimeoutError" || error.name === "AbortError") return "Model request timed out";
    return error.message.slice(0, 1200);
  }
  return "Mobilization generation failed";
}

export function proposeGroundedPlans(batch: Batch, output: NonNullable<SimulationRunResult["output"]>, runId: string): string[] {
  // Recheck availability under the world lock, after the model call, rather than trusting stale capacity.
  const grounded = groundMobilizationPlans(output, Object.values(batch.volunteers), batch.all(), batch.now);
  return output.mobilizations.map((plan, index) => {
    const steps = grounded[index];
    const refs = [...new Set(plan.tasks.flatMap((task) => task.playbookRefs.map((ref) => ref.slug)))];
    return C.proposeMobilization(batch, {
      title: plan.title, rationale: plan.rationale, urgency: plan.priority,
      zoneSlug: steps[0]?.zoneSlug ?? null, relatedPlaybooks: refs, steps, analysisRunId: runId,
    }).id;
  });
}
