/**
 * Actual HTTP/auth/DB pipeline checks with a LOCAL, explicitly fake OpenAI-compatible test provider.
 * This verifies model-call plumbing and fail-closed behavior, not real model intelligence. It never
 * configures the running demo server or publishes a fabricated SOP. A separate persistence check
 * creates proposal/action rows only inside one deliberately rolled-back world transaction.
 * Temporary auth users and their audited simulation runs are removed after the check.
 *
 *   bun scripts/check-mobilization-api.ts
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { Batch, CommandError } from "../src/lib/batch";
import * as C from "../src/lib/commands";
import { MobilizationOutputSchema } from "../src/lib/mobilization-contracts";
import type {
  MobilizationObservation,
  MobilizationOutput,
  PlanningSnapshot,
  SimulationContext,
  SimulationInput,
  SimulationRunResult,
} from "../src/lib/mobilization-contracts";
import { inputAvailability, missingRequiredInputs } from "../src/lib/mobilization-inputs";
import { app } from "../src/server/http/app";
import { assertMobilizationReview, type ReviewRun } from "../src/server/http/mobilization-review";
import type { ModelDiagnostic } from "../src/server/models";
import { proposeGroundedPlans } from "../src/server/predict/simulation";
import { focusedPlanningInput } from "../src/server/predict/focused-input";
import { createMobilizationPlanningRequest } from "../src/server/predict/planning-request";
import { validateMobilizationOutput } from "../src/server/predict/validate";
import { loadWorld, save, sql } from "../src/server/world";

declare const Bun: {
  serve(options: {
    hostname: string;
    port: number;
    fetch: (request: Request) => Response | Promise<Response>;
  }): { port: number; stop: (closeActiveConnections?: boolean) => void };
};

const modelKeys = [
  "LLM_BASE_URL",
  "LLM_API_KEY",
  "LLM_MODEL",
  "LLM_REASONING_EFFORT",
  "MOBILIZATION_MODEL",
  "MOBILIZATION_SERVICE_TIER",
  "MOBILIZATION_REASONING_EFFORT",
  "TYPESAFE_BASE_URL",
  "TYPESAFE_API_KEY",
  "OPENROUTER_API_KEY",
  "OPENAI_API_KEY",
  "MODEL_PROVIDER",
  "SPARK_BASE_URL",
  "SPARK_API_KEY",
] as const;
const savedModelEnv = Object.fromEntries(modelKeys.map((key) => [key, process.env[key]]));
const q = sql();
const run = `${Date.now().toString(36)}-${crypto.randomUUID().slice(0, 8)}`;
const opts = { auth: { persistSession: false, autoRefreshToken: false } };
const admin = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!, opts);
const crewIds: string[] = [];
const authIds: string[] = [];
type Person = { id: string; token: string; client: SupabaseClient };
type Reply<T> = { status: number; body: T };
type ErrorBody = { error?: string };
type ModelInput = ReturnType<typeof focusedPlanningInput>;
type ModelMode = "invalid_json" | "invalid_semantics" | "http_error" | "valid_no_mobilization";
let mode: ModelMode = "valid_no_mobilization";
let modelCalls = 0;
let releaseModel: (() => void) | undefined;
let modelGate: Promise<void> | null = null;
let modelEntered: (() => void) | undefined;
let lastModelSnapshot: PlanningSnapshot | null = null;
let lastModelInput: ModelInput | null = null;
const LOCAL_MODEL = "LOCAL_FAKE_mobilization_integration_provider";
const inFlight = new Set<Promise<Response>>();

function check(label: string, condition: unknown): asserts condition {
  if (!condition) throw new Error(label);
  console.log(`ok  ${label}`);
}

function sameJson(left: unknown, right: unknown): boolean {
  const ordered = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(ordered);
    if (value != null && typeof value === "object")
      return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b))
        .map(([key, entry]) => [key, ordered(entry)]));
    return value;
  };
  return JSON.stringify(ordered(left)) === JSON.stringify(ordered(right));
}

function expectedModelInput(snapshot: PlanningSnapshot): ModelInput {
  return JSON.parse(createMobilizationPlanningRequest(snapshot).prompt) as ModelInput;
}

function envelopeFinalText(content: string | undefined): string | null {
  if (!content) return null;
  try {
    const value = JSON.parse(content) as { output?: { type?: string; content?: { type?: string; text?: string }[] }[] };
    return value.output?.filter((item) => item.type === "message")
      .flatMap((item) => item.content ?? []).filter((item) => item.type === "output_text")
      .map((item) => item.text ?? "").join("") ?? null;
  } catch { return null; }
}

function clearModelConfig() {
  for (const key of modelKeys) delete process.env[key];
}

function scenario(caseName: string): SimulationInput {
  return {
    requestId: `check-api-${run}-${caseName}`,
    weather: {
      temperatureC: 26,
      trendCPerHour: null,
      condition: "clear",
      warning: "none",
      warningInMinutes: null,
    },
    upcomingSets: [],
    crowdByZone: [],
    recentIncidents: [],
  };
}

async function post<T = ErrorBody>(
  person: Person | null,
  name: string,
  body: unknown = {},
): Promise<Reply<T>> {
  const handled = Promise.resolve(
    app.request(`/api/${name}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(person ? { authorization: `Bearer ${person.token}` } : {}),
      },
      body: JSON.stringify(body),
    }),
  );
  inFlight.add(handled);
  try {
    const response = await handled;
    return { status: response.status, body: (await response.json().catch(() => null)) as T };
  } finally {
    inFlight.delete(handled);
  }
}

async function session(email: string, id: string): Promise<Person> {
  const link = await admin.auth.admin.generateLink({ type: "magiclink", email });
  if (link.error) throw link.error;
  const client = createClient(
    process.env.SUPABASE_URL!,
    process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    opts,
  );
  const verified = await client.auth.verifyOtp({
    email,
    token: link.data.properties.email_otp,
    type: "email",
  });
  if (verified.error || !verified.data.session)
    throw verified.error ?? new Error("No test session");
  return { id, token: verified.data.session.access_token, client };
}

async function crew(
  handle: string,
  role: "coordinator" | "safety_lead" | "team_lead" | "volunteer",
): Promise<Person> {
  const email = `check-mobilization-${run}-${handle}@moloop.test`;
  const created = await admin.auth.admin.createUser({ email, email_confirm: true });
  if (created.error) throw created.error;
  const id = created.data.user.id;
  authIds.push(id);
  crewIds.push(id);
  const [team] = await q<{ id: string }[]>`select id from teams where slug = 'first-aid'`;
  if (!team) throw new Error("Local first-aid team is required");
  // Off shift: these test identities cannot affect the real roster's available staffing.
  await q`insert into profiles (id, full_name, role, team_id, status)
    values (${id}, ${`Integration API ${handle}`}, ${role}, ${team.id}, 'off_shift')`;
  return session(email, id);
}

async function guest(): Promise<Person> {
  const client = createClient(
    process.env.SUPABASE_URL!,
    process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    opts,
  );
  const signed = await client.auth.signInAnonymously();
  if (signed.error || !signed.data.user || !signed.data.session)
    throw signed.error ?? new Error("No anonymous test session");
  authIds.push(signed.data.user.id);
  return { id: signed.data.user.id, token: signed.data.session.access_token, client };
}

function testOutput(snapshot: PlanningSnapshot): MobilizationOutput {
  return {
    decision: "no_mobilization",
    assessment: {
      summary: "LOCAL integration provider fixture; not a real safety assessment.",
      severity: "minor",
      findings: [],
      missingInputs: [],
      playbookAssessments: snapshot.playbooks.map((book) => ({
        slug: book.content.slug,
        version: book.version,
        applicability: "not_applicable",
        reason: "The local integration fixture tests a no-response branch only.",
        evidenceRefs: ["demo-weather"],
        missingInputs: missingRequiredInputs(book.content.requiredInputs, snapshot),
      })),
    },
    mobilizations: [],
  };
}

const fakeModel = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  fetch: async (request) => {
    if (new URL(request.url).pathname !== "/v1/responses")
      return new Response("LOCAL test provider: unknown endpoint", { status: 404 });
    const payload = await request.json() as {
      model: string; reasoning?: { effort: string }; service_tier?: string;
      input: { role?: string; content?: unknown; type?: string; call_id?: string; output?: string }[];
      tools?: { name: string }[]; tool_choice?: { type: string; name: string } | string;
      text?: { format?: { strict?: boolean; schema?: { properties?: Record<string, unknown> } } };
    };
    if (payload.model !== LOCAL_MODEL ||
        request.headers.get("authorization") !== "Bearer local-integration-test-key-not-a-real-secret" ||
        payload.reasoning?.effort !== "medium" || payload.service_tier !== "default") {
      console.error(JSON.stringify({ event: "LOCAL fixture configuration mismatch",
        modelIsFixture: payload.model === LOCAL_MODEL, reasoning: payload.reasoning?.effort,
        tier: payload.service_tier,
        authIsFixture: request.headers.get("authorization") === "Bearer local-integration-test-key-not-a-real-secret" }));
      return new Response("LOCAL test provider configuration was not isolated", { status: 400 });
    }
    modelCalls++;
    modelEntered?.();
    if (modelGate) await modelGate;
    if (mode === "http_error")
      return new Response("LOCAL_TEST_PROVIDER_BODY_MUST_NOT_APPEAR_IN_AUDIT", { status: 401 });
    const prompt = payload.input.find((message) => message.role === "user")?.content;
    const system = payload.input.find((message) => message.role === "system")?.content;
    if (typeof prompt !== "string" || typeof system !== "string")
      return new Response("LOCAL test provider requires the exact saved prompt", { status: 400 });
    const [saved] = await q<{ input_snapshot: PlanningSnapshot; system_prompt: string; id: string }[]>`
      select id, input_snapshot, system_prompt from mobilization_runs
      where requested_by = any(${crewIds}::uuid[]) and status = 'running' and user_prompt = ${prompt}
      order by created_at desc limit 1`;
    if (!saved || saved.system_prompt !== system)
      return new Response("LOCAL test provider could not match the audited input", { status: 400 });
    // The fake provider is explicitly not intelligent. Read the captured local fixture only to
    // construct its deterministic wire reply; separately assert exactly which projection arrived.
    const snapshot = saved.input_snapshot;
    const planning = createMobilizationPlanningRequest(snapshot);
    // JSONB storage may reorder object keys. The saved user_prompt is byte-exact above;
    // regenerating the projection from its JSONB snapshot must compare semantic JSON, not key order.
    if (planning.system !== system || !sameJson(JSON.parse(planning.prompt), JSON.parse(prompt)))
      return new Response("LOCAL test provider did not receive the active production planning request", { status: 400 });
    lastModelSnapshot = snapshot;
    lastModelInput = JSON.parse(prompt) as ModelInput;
    const callId = `call_local_${saved.id}`;
    if (typeof payload.tool_choice === "object") {
      if (payload.tool_choice.name !== "get_playbooks" || payload.tools?.[0]?.name !== "get_playbooks")
        return new Response("LOCAL test provider only supports the read-only SOP tool", { status: 400 });
      return Response.json({ status: "completed", service_tier: "default", output: [{
        type: "function_call", name: "get_playbooks", status: "completed", call_id: callId,
        arguments: JSON.stringify({ playbookKeys: [] }),
      }] });
    }
    const toolResult = payload.input.find((item) => item.type === "function_call_output");
    if (payload.tool_choice !== "none" || payload.text?.format?.strict !== true ||
        toolResult?.call_id !== callId || typeof toolResult.output !== "string")
      return new Response("LOCAL final request omitted its audited read-tool result or strict schema", { status: 400 });
    const read = JSON.parse(toolResult.output) as { playbooks: unknown[]; requiredInputChecks: unknown[] };
    if (read.playbooks.length || read.requiredInputChecks.length)
      return new Response("LOCAL no-trigger fixture expected an empty captured SOP read", { status: 400 });
    await planning.read({ playbookKeys: [] }, async (captured) => {
      if (!sameJson(captured, read)) throw new Error("LOCAL read-tool output changed from captured snapshot");
    });
    const canonical = testOutput(snapshot);
    if (mode === "invalid_semantics") {
      canonical.decision = "propose";
      canonical.assessment.findings = [{ id: "fake-provider-finding", risk: "LOCAL validation fixture only.",
        possibleCause: "Unknown.", evidenceRefs: ["demo-weather"], uncertainty: "Not a real assessment." }];
      canonical.mobilizations = [{ title: "LOCAL invalid-zone fixture", priority: "P2", rationale: "Validation only",
        tasks: [0, 1].map((index) => ({ key: `invalid-zone-${index}`, title: "LOCAL invalid zone",
          instructions: "Validation fixture, not operational work", teamSlug: "first-aid", zoneSlug: "nonexistent-test-zone",
          peopleNeeded: 1, reason: "LOCAL fixture", requiredSkills: [], completionCriteria: "LOCAL fixture",
          addressesFindingIds: ["fake-provider-finding"], evidenceRefs: ["demo-weather"], playbookRefs: [] })),
        unmetRequirements: [] }];
    }
    const wire = { ...canonical, assessment: { ...canonical.assessment,
      playbookAssessments: snapshot.playbooks.map((book) => ({ playbookKey: `${book.content.slug}:${book.version}`,
        applicability: "not_applicable", reason: "LOCAL no-trigger plumbing fixture, not an intelligent assessment.",
        evidenceRefs: ["demo-weather"], contextualMissingInputs: [] })) } };
    if (!Object.hasOwn(payload.text.format.schema?.properties ?? {}, "actionCoverage"))
      return new Response("LOCAL test provider expected the active required-action wire contract", { status: 400 });
    const answerValue = { ...wire, actionCoverage: {}, mobilizations: wire.mobilizations.map((plan) => {
      const { unmetRequirements: _, ...rest } = plan;
      return { ...rest, tasks: plan.tasks.map((task) => {
        const { playbookRefs: _, addressesFindingIds, ...rest } = task;
        return { ...rest, addressesFindingId: addressesFindingIds[0] };
      }) };
    }) };
    // Even the negative semantic fixture is schema-valid under the exact production factory.
    planning.schema().parse(answerValue);
    const answer =
      mode === "invalid_json"
        ? "{not-valid-json"
        : JSON.stringify(answerValue);
    return Response.json({ status: "completed", service_tier: "default", output: [{
      type: "message", role: "assistant", status: "completed", content: [{ type: "output_text", text: answer }],
    }] });
  },
});

function configureTestModel(nextMode: ModelMode) {
  clearModelConfig();
  process.env.LLM_BASE_URL = `http://127.0.0.1:${fakeModel.port}/v1`;
  process.env.LLM_API_KEY = "local-integration-test-key-not-a-real-secret";
  process.env.LLM_MODEL = LOCAL_MODEL;
  process.env.LLM_REASONING_EFFORT = "medium";
  process.env.MOBILIZATION_MODEL = LOCAL_MODEL;
  process.env.MOBILIZATION_SERVICE_TIER = "default";
  process.env.MOBILIZATION_REASONING_EFFORT = "medium";
  mode = nextMode;
}

async function simulate(person: Person, input: SimulationInput): Promise<SimulationRunResult> {
  const response = await post<SimulationRunResult & ErrorBody>(
    person,
    "simulateMobilization",
    input,
  );
  if (response.status !== 200 || !response.body?.runId)
    throw new Error(`Expected an audited simulation response, got HTTP ${response.status}`);
  return response.body;
}

async function audit(id: string) {
  const [row] = await q<
    {
      status: string;
      input_snapshot: PlanningSnapshot;
      system_prompt: string;
      user_prompt: string;
      prompt_version: string;
      model: string | null;
      raw_responses: (string |
        { event: "attempt" | "reply" | "tool_result"; provider: string; model: string; content?: string } |
        { event: "diagnostic"; provider: string; model: string; occurredAt: string; diagnostic: ModelDiagnostic })[];
      result: unknown;
      validation_errors: string[];
      error: string | null;
    }[]
  >`select status, input_snapshot, system_prompt, user_prompt, prompt_version, model,
      raw_responses, result, validation_errors, error from mobilization_runs where id = ${id}`;
  if (!row) throw new Error("Simulation audit row was not persisted");
  return row;
}

async function noResponseWork(id: string): Promise<boolean> {
  const [row] = await q<{ mobilizations: number; tasks: number }[]>`
    select (select count(*)::int from mobilizations where analysis_run_id = ${id}) as mobilizations,
      (select count(*)::int from tasks t join mobilizations m on m.id = t.mobilization_id
       where m.analysis_run_id = ${id}) as tasks`;
  return row.mobilizations === 0 && row.tasks === 0;
}

async function checkRolledBackMapping(
  mo: Person,
  reviewer: Person,
  snapshot: PlanningSnapshot,
) {
  const runId = crypto.randomUUID();
  const rollback = new Error("LOCAL mapping check: intentionally roll back all fixture rows");
  let proposalId: string | undefined;
  let taskIds: string[] = [];
  let reportIds: string[] = [];
  const messageIds: string[] = [];
  const response = MobilizationOutputSchema.parse({
    ...testOutput(snapshot),
    decision: "propose",
    assessment: {
      ...testOutput(snapshot).assessment,
      severity: "concerning",
      findings: [{
        id: "local-mapping-finding", risk: "LOCAL persistence regression fixture only.",
        possibleCause: "Not a real assessment.", evidenceRefs: ["demo-weather"],
        uncertainty: "This plan is manually constructed in a rolled-back test transaction.",
      }],
    },
    mobilizations: [{
      title: "LOCAL rolled-back mapping fixture", priority: "P2",
      rationale: "Verify action identities and concrete locations survive the real database mapping.",
      unmetRequirements: [],
      tasks: ["water-2", "lawn-stage"].map((zoneSlug, index) => ({
        key: `local-map-action-${index}`, title: `LOCAL action ${index}`,
        instructions: `LOCAL regression instruction at ${zoneSlug}.`,
        teamSlug: "first-aid", zoneSlug, peopleNeeded: index + 1,
        reason: "LOCAL mapping regression, not an operational instruction.",
        requiredSkills: ["first-aid-cert"], completionCriteria: `LOCAL criterion ${index}`,
        addressesFindingIds: ["local-mapping-finding"], evidenceRefs: ["demo-weather"],
        playbookRefs: [],
      })),
    }],
  });
  check("rollback fixture JSON is schema-valid and grounded in real snapshot IDs",
    validateMobilizationOutput(response, snapshot, snapshot.skills.map((skill) => skill.slug)).length === 0);
  try {
    await q.begin(async (tx) => {
      await tx`set local lock_timeout = '10s'`;
      await tx`set local statement_timeout = '10s'`;
      await tx`select pg_advisory_xact_lock(hashtext('moloop:world'))`;
      await tx`insert into mobilization_runs ${tx({
        id: runId, request_id: `check-api-${run}-rollback-mapping`, requested_by: mo.id,
        status: "completed", input_snapshot: tx.json(snapshot as Parameters<typeof tx.json>[0]),
        result: tx.json(response), prompt_version: "LOCAL_ROLLBACK_MAPPING_ONLY",
        model: "LOCAL_MANUAL_FIXTURE_NOT_A_MODEL_CALL",
      })}`;
      const loaded = await loadWorld(tx);
      const proposed = new Batch(loaded.world, { now: Date.now(), id: () => crypto.randomUUID() });
      [proposalId] = proposeGroundedPlans(proposed, response, runId);
      await save(tx, loaded, proposed, {});
      await tx`update mobilization_runs set mobilization_ids = ${[proposalId]}::uuid[] where id = ${runId}`;
      messageIds.push(...proposed.messages.map((message) => message.id));
      const [pending] = await tx<{ status: string; tasks: number }[]>`
        select m.status, (select count(*)::int from tasks where mobilization_id = m.id) as tasks
        from mobilizations m where id = ${proposalId!}`;
      check("real DB save persists a pending proposal without materializing any tasks",
        pending.status === "proposed" && pending.tasks === 0);
      const reloaded = await loadWorld(tx, { mobilizationIds: [proposalId!] });
      const stored = reloaded.world.mobilizations[proposalId!];
      check("proposal mapper preserves analysis link and same-team distinct action fields",
        stored.analysisRunId === runId && stored.steps.length === 2 &&
        stored.steps.every((step, index) => step.stepKey === `local-map-action-${index}` &&
          step.teamSlug === "first-aid" && step.zoneSlug === response.mobilizations[0].tasks[index].zoneSlug &&
          step.requiredSkills?.includes("first-aid-cert") && step.evidenceRefs?.includes("demo-weather")));
      const [reviewRow] = await tx<ReviewRun[]>`
        select id, status, result, input_snapshot, validation_errors, mobilization_ids
        from mobilization_runs where id = ${runId}`;
      let unreviewedRejected = false;
      try { assertMobilizationReview(stored, reviewRow, {}, []); }
      catch (error) { if (!(error instanceof CommandError)) throw error; unreviewedRejected = true; }
      check("real persisted linked proposal cannot pass the approval guard without its reviewed run ID", unreviewedRejected);
      const approved = new Batch(reloaded.world, { now: Date.now(), id: () => crypto.randomUUID() });
      taskIds = C.approveMobilization(approved, reviewer.id, proposalId!).taskIds;
      const allocatedTasks = taskIds.map((id) => approved.tasks[id]);
      const actualStaffGap = allocatedTasks.some((task) =>
        new Set([...(task.assigneeId ? [task.assigneeId] : []), ...task.helpers.map((helper) => helper.volunteerId)]).size < task.requiredCount);
      let missingAckRejected = false;
      try { assertMobilizationReview(stored, reviewRow, { reviewedRunId: runId }, allocatedTasks); }
      catch (error) { if (!(error instanceof CommandError)) throw error; missingAckRejected = true; }
      check("the approval guard requires acknowledgement exactly when fresh persisted-plan staffing has gaps",
        missingAckRejected === actualStaffGap);
      assertMobilizationReview(stored, reviewRow, { reviewedRunId: runId, acknowledgeGaps: true }, allocatedTasks);
      await save(tx, reloaded, approved, { reporterId: reviewer.id });
      messageIds.push(...approved.messages.map((message) => message.id));
      const rows = await tx<{
        id: string; mobilization_step_key: string; required_skills: string[]; required_count: number;
        title: string; summary: string; zone_slug: string; team_slug: string; report_id: string;
      }[]>`select t.id, t.mobilization_step_key, t.required_skills, t.required_count, t.title,
          t.summary, z.slug as zone_slug, tm.slug as team_slug, r.id as report_id
        from tasks t join reports r on r.id = t.report_id join zones z on z.id = t.zone_id
        join teams tm on tm.id = t.team_id where t.mobilization_id = ${proposalId!}
        order by t.mobilization_step_key`;
      reportIds = rows.map((row) => row.report_id);
      check("approval saves two same-team tasks with separate zones, keys, skills and report FKs",
        rows.length === 2 && rows.every((row, index) => {
          const action = response.mobilizations[0].tasks[index];
          return taskIds.includes(row.id) && !!row.report_id &&
            row.mobilization_step_key === action.key && row.zone_slug === action.zoneSlug &&
            row.team_slug === action.teamSlug && row.required_count === action.peopleNeeded &&
            row.required_skills.includes("first-aid-cert") && row.title === action.title &&
            row.summary.includes(action.instructions) && row.summary.includes(action.completionCriteria);
        }));
      const readBack = await loadWorld(tx, { mobilizationIds: [proposalId!], taskIds });
      check("task mapper retains action keys and required skills after approval",
        taskIds.every((id) => readBack.world.tasks[id].mobilizationId === proposalId &&
          readBack.world.tasks[id].mobilizationStepKey?.startsWith("local-map-action-") &&
          readBack.world.tasks[id].requiredSkills?.includes("first-aid-cert")));
      check("second Mo approval persists its actual reviewer and activates the proposal",
        readBack.world.mobilizations[proposalId!].status === "active" &&
        readBack.world.mobilizations[proposalId!].decidedById === reviewer.id);
      const assignments = await tx<{ volunteer_id: string }[]>`
        select volunteer_id from task_assignments where task_id = any(${taskIds}::uuid[])
          and status not in ('rejected', 'declined', 'reassigned')`;
      check("persisted action staffing does not double-book one crew member",
        new Set(assignments.map((assignment) => assignment.volunteer_id)).size === assignments.length);
      throw rollback;
    });
  } catch (error) {
    if (error !== rollback) throw error;
  }
  const [remaining] = await q<{ runs: number; proposals: number; tasks: number; reports: number; events: number; messages: number }[]>`
    select (select count(*)::int from mobilization_runs where id = ${runId}) as runs,
      (select count(*)::int from mobilizations where id = ${proposalId!}) as proposals,
      (select count(*)::int from tasks where id = any(${taskIds}::uuid[])) as tasks,
      (select count(*)::int from reports where id = any(${reportIds}::uuid[])) as reports,
      (select count(*)::int from task_events where task_id = any(${taskIds}::uuid[])) as events,
      (select count(*)::int from messages where id = any(${messageIds}::uuid[])) as messages`;
  check("mapping transaction leaves no committed fixture audit, proposal, task, report, event or message",
    Object.values(remaining).every((count) => count === 0));
}

try {
  const localHosts = new Set(["localhost", "127.0.0.1", "[::1]"]);
  if (
    !localHosts.has(new URL(process.env.SUPABASE_URL!).hostname) ||
    !localHosts.has(new URL(process.env.DATABASE_URL!).hostname)
  )
    throw new Error("This fixture-producing integration check requires the local Supabase stack");
  clearModelConfig();
  const mo = await crew("mo", "coordinator");
  const otherMo = await crew("other-mo", "safety_lead");
  const lead = await crew("lead", "team_lead");
  const volunteer = await crew("volunteer", "volunteer");
  const anonymous = await guest();

  check(
    "a missing JWT is rejected by the actual app middleware",
    (await post(null, "mobilizationContext")).status === 401,
  );
  const invalidToken = { ...mo, token: "not-a-supabase-session" };
  check(
    "an invalid JWT is rejected by the actual app middleware",
    (await post(invalidToken, "mobilizationContext")).status === 401,
  );
  for (const [name, person] of [
    ["team lead", lead],
    ["volunteer", volunteer],
    ["guest", anonymous],
  ] as const) {
    for (const endpoint of ["mobilizationContext", "simulateMobilization", "getMobilizationRun", "approveMobilization"])
      check(`${name} cannot call ${endpoint}`, (await post(person, endpoint)).status === 403);
  }
  const context = await post<SimulationContext>(mo, "mobilizationContext");
  check(
    "Mo receives venue context and an honest missing-model state",
    context.status === 200 && context.body.modelReady === false && context.body.zones.length > 0,
  );
  check(
    "the canned incident-generating demo endpoint is removed",
    (await post(mo, "devSimulateDetection")).status === 404,
  );
  check(
    "unknown runs return 404",
    (await post(mo, "getMobilizationRun", { runId: crypto.randomUUID() })).status === 404,
  );
  check(
    "missing simulation keys return 400",
    (await post(mo, "simulateMobilization", {})).status === 400,
  );
  check(
    "malformed run IDs return 400",
    (await post(mo, "getMobilizationRun", { runId: "not-a-uuid" })).status === 400,
  );

  const invalidZone = scenario("invalid-zone");
  invalidZone.crowdByZone = [
    { zoneSlug: "unknown-test-zone", estimatedPeople: 1, trend: "stable" },
  ];
  check(
    "hypothetical crowd reports still require a real venue zone",
    (await post(mo, "simulateMobilization", invalidZone)).status === 400,
  );
  const inconsistentCounts = scenario("invalid-counts");
  inconsistentCounts.recentIncidents = [
    {
      category: "heat",
      zoneSlug: "water-2",
      minutesAgo: 1,
      description: "Integration count validation only.",
      count: 1,
      openCount: 2,
    },
  ];
  check(
    "open incidents cannot exceed total incidents",
    (await post(mo, "simulateMobilization", inconsistentCounts)).status === 400,
  );
  const wrongStage = scenario("invalid-stage");
  wrongStage.upcomingSets = [
    {
      stageSlug: "water-2",
      act: "Integration set",
      startsInMinutes: 1,
      durationMinutes: 10,
      expectedPeople: null,
    },
  ];
  check(
    "a water station cannot be supplied as an upcoming stage",
    (await post(mo, "simulateMobilization", wrongStage)).status === 400,
  );
  const observation = { key: "weather.windSpeed", kind: "number", zoneSlug: null, minutesAgo: 0, value: 0 };
  const location = { zoneSlug: "water-2", status: "open", capacity: 0, approved: false };
  const route = { fromZoneSlug: "water-2", toZoneSlug: "lawn-stage", status: "open" as const, approved: false };
  const reverseRoute = { fromZoneSlug: route.toZoneSlug, toZoneSlug: route.fromZoneSlug,
    status: "restricted" as const, approved: true };
  const invalidObservations: [string, unknown[]][] = [
    ["unknown observation keys are rejected", [{ ...observation, key: "unconnected.sensor" }]],
    ["wrong typed observation kinds are rejected", [{ ...observation, kind: "text", value: "0" }]],
    ["negative physical numeric observations are rejected", [{ ...observation, value: -1 }]],
    ["numeric observations above their catalog range are rejected", [{ ...observation, value: 301 }]],
    ["integer population inputs reject fractional counts", [{ ...observation, key: "casualtyEstimate", value: 1.5 }]],
    ["status observations require catalog options", [{ ...observation, key: "power.primaryStatus", kind: "status", value: "made_up_status" }]],
    ["future observation timestamps are rejected", [{ ...observation, minutesAgo: -1 }]],
    ["observations beyond the declared 24-hour window are rejected", [{ ...observation, minutesAgo: 1441 }]],
    ["zone-scoped observations require a zone", [{ ...observation, key: "water.tankLevels", value: 0 }]],
    ["site-wide observations reject a per-zone override", [{ ...observation, key: "siteCapacity", zoneSlug: "water-2" }]],
    ["observation scopes require real venue IDs", [{ ...observation, zoneSlug: "unknown-test-zone" }]],
    ["location observations require a real venue ID", [{ ...observation, key: "incidentLocation", kind: "location", value: "unknown-test-zone" }]],
    ["area collections require real venue IDs", [{ ...observation, key: "approvedShelterZones", kind: "locations", value: [{ ...location, zoneSlug: "unknown-test-zone" }] }]],
    ["area collections require a typed status option", [{ ...observation, key: "approvedShelterZones", kind: "locations", value: [{ ...location, status: "made_up_status" }] }]],
    ["area collections require explicit approval booleans", [{ ...observation, key: "approvedShelterZones", kind: "locations", value: [{ zoneSlug: "water-2", status: "open", capacity: 0 }] }]],
    ["area collections reject duplicate location IDs", [{ ...observation, key: "approvedShelterZones", kind: "locations", value: [location, { ...location, approved: true }] }]],
    ["route endpoints require real venue IDs", [{ ...observation, key: "approvedRoutes", kind: "routes", value: [{ ...route, toZoneSlug: "unknown-test-zone" }] }]],
    ["route endpoints must differ", [{ ...observation, key: "approvedRoutes", kind: "routes", value: [{ ...route, toZoneSlug: "water-2" }] }]],
    ["contradictory duplicate routes in the same direction are rejected", [{ ...observation, key: "approvedRoutes", kind: "routes", value: [route, { ...route, approved: true }] }]],
    ["route collections require explicit approval booleans", [{ ...observation, key: "approvedRoutes", kind: "routes", value: [{ fromZoneSlug: "water-2", toZoneSlug: "lawn-stage", status: "open" }] }]],
    ["one key and scope cannot contain contradictory duplicate facts", [observation, { ...observation, value: 20 }]],
    ["count collections reject duplicate zones", [{ ...observation, key: "audienceByZone", kind: "zone_counts", value: { coverage: "partial", entries: [{ zoneSlug: "water-2", count: 0 }, { zoneSlug: "water-2", count: 1 }] } }]],
    ["count collections reject nonexistent zone IDs", [{ ...observation, key: "audienceByZone", kind: "zone_counts", value: { coverage: "partial", entries: [{ zoneSlug: "unknown-test-zone", count: 0 }] } }]],
    ["all-venue census claims require every real venue zone", [{ ...observation, key: "audienceByZone", kind: "zone_counts", value: { coverage: "all_venue", entries: [{ zoneSlug: "water-2", count: 0 }] } }]],
    ["manual observations cannot contradict built-in weather", [{ ...observation, key: "weather.temperature", value: 5 }]],
    ["manual observations cannot override database roster", [{ ...observation, key: "currentRoster", kind: "text", value: "Fabricated roster" }]],
  ];
  for (const [index, [label, observations]] of invalidObservations.entries())
    check(label, (await post(mo, "simulateMobilization", { ...scenario(`invalid-observation-${index}`), observations })).status === 400);
  check("current crowd controls reject contradictory duplicate counts for one zone",
    (await post(mo, "simulateMobilization", { ...scenario("duplicate-crowd"), crowdByZone: [
      { zoneSlug: "water-2", estimatedPeople: 0, trend: "stable" },
      { zoneSlug: "water-2", estimatedPeople: 100, trend: "growing" },
    ] })).status === 400);
  const [invalidRuns] = await q<
    { count: number }[]
  >`select count(*)::int as count from mobilization_runs where requested_by = ${mo.id}`;
  check("rejected input creates no simulation audit or response work", invalidRuns.count === 0);

  const configInput = scenario("missing-model");
  const noModel = await simulate(mo, configInput);
  const configAudit = await audit(noModel.runId);
  check(
    "missing configuration is audited without a fallback plan",
    noModel.status === "configuration_required" &&
      noModel.output === null &&
      noModel.mobilizationIds.length === 0 &&
      configAudit.raw_responses.length === 0 &&
      (await noResponseWork(noModel.runId)),
  );
  check(
    "the exact scenario and prompt version are retained",
    configAudit.input_snapshot.scenario.requestId === configInput.requestId &&
      configAudit.system_prompt.length > 0 &&
      configAudit.user_prompt.length > 0 &&
      configAudit.prompt_version.length > 0,
  );
  const suppliedFacts: MobilizationObservation[] = [
    { key: "weather.windSpeed", kind: "number", zoneSlug: null, minutesAgo: 12, value: 0 },
    { key: "stageSafety.windLimitExceeded", kind: "boolean", zoneSlug: "lawn-stage", minutesAgo: 2, value: false },
    { key: "water.tankLevels", kind: "number", zoneSlug: "water-2", minutesAgo: 3, value: 0 },
    { key: "engineerAssessment", kind: "text", zoneSlug: null, minutesAgo: 0, value: "" },
    { key: "casualtyEstimate", kind: "number", zoneSlug: null, minutesAgo: 0, value: null },
    { key: "power.backupStatus", kind: "status", zoneSlug: null, minutesAgo: 0, value: "" },
    { key: "gateCounts", kind: "zone_counts", zoneSlug: null, minutesAgo: 0, value: { coverage: "partial", entries: [] } },
    { key: "approvedExclusionZones", kind: "locations", zoneSlug: null, minutesAgo: 4, value: [location] },
    { key: "approvedRoutes", kind: "routes", zoneSlug: null, minutesAgo: 5, value: [route, reverseRoute] },
    { key: "audienceByZone", kind: "zone_counts", zoneSlug: null, minutesAgo: 6,
      value: { coverage: "partial", entries: [{ zoneSlug: "water-2", count: 0 }] } },
    { key: "power.primaryStatus", kind: "status", zoneSlug: "water-2", minutesAgo: 1, value: "failed" },
    { key: "incidentLocation", kind: "location", zoneSlug: null, minutesAgo: 7, value: "water-2" },
    { key: "medicalReports", kind: "text", zoneSlug: "water-2", minutesAgo: 8,
      value: "LOCAL integration observation; no reported cases in this hypothetical sample." },
    { key: "approvedShelterZones", kind: "locations", zoneSlug: null, minutesAgo: 0, value: [] },
  ];
  const observationRun = await simulate(mo, { ...scenario("typed-observations"), observations: suppliedFacts });
  const observationAudit = await audit(observationRun.runId);
  const observedSnapshot = observationAudit.input_snapshot;
  check("typed observations are audited without generating fallback work when no model is configured",
    observationRun.status === "configuration_required" && (await noResponseWork(observationRun.runId)));
  check("typed supplied observations are stored exactly in the immutable input snapshot",
    sameJson(observedSnapshot.scenario.observations, suppliedFacts));
  const projectedInput = JSON.parse(observationAudit.user_prompt) as ModelInput;
  check("the model prompt equals the explicit compact/focused projection while the complete snapshot stays stored",
    sameJson(projectedInput, expectedModelInput(observedSnapshot)) &&
    observedSnapshot.routes.length > 0 && observedSnapshot.playbooks.every((book) => book.content.actions.length > 0));
  const meaningfulIndices = [0, 1, 2, 7, 8, 9, 10, 11, 12];
  check("only meaningful supplied facts become typed, sourced, timestamped evidence",
    observedSnapshot.evidence.filter((entry) => entry.kind === "observation").length === meaningfulIndices.length &&
    meaningfulIndices.every((index) => {
      const fact = suppliedFacts[index];
      const evidence = observedSnapshot.evidence.find((entry) => entry.ref === `observation-${index}`);
      return evidence?.source === "manual_demo" && evidence.kind === "observation" &&
        evidence.zoneSlug === fact.zoneSlug && evidence.value.key === fact.key &&
        evidence.value.kind === fact.kind && sameJson(evidence.value.value, fact.value) &&
        Date.parse(observedSnapshot.evaluatedAt) - Date.parse(evidence.observedAt) === fact.minutesAgo * 60_000;
    }));
  check("canonical units and explicit unapproved area/route values survive evidence mapping",
    observedSnapshot.evidence.find((entry) => entry.ref === "observation-0")?.value.unit === "km/h" &&
    observedSnapshot.evidence.find((entry) => entry.ref === "observation-2")?.value.unit === "%" &&
    observedSnapshot.evidence.find((entry) => entry.ref === "observation-9")?.value.unit === "people" &&
    observedSnapshot.evidence.find((entry) => entry.ref === "observation-7")?.value.approvalRequired === true &&
    observedSnapshot.evidence.find((entry) => entry.ref === "observation-8")?.value.approvalRequired === true &&
    (observedSnapshot.evidence.find((entry) => entry.ref === "observation-7")?.value.value as typeof location[])[0].approved === false &&
    (observedSnapshot.evidence.find((entry) => entry.ref === "observation-8")?.value.value as typeof route[])[0].approved === false);
  check("opposite route directions keep independent status and approval facts",
    sameJson((observedSnapshot.evidence.find((entry) => entry.ref === "observation-8")?.value.value as unknown[])[1], reverseRoute));
  const availability = inputAvailability(observedSnapshot);
  check("numeric zero and boolean false provide known facts without becoming unknown",
    availability["weather.windSpeed"].available && availability["stageSafety.windLimitExceeded"].available &&
    availability["water.tankLevels"].available);
  check("null, blank and empty collections remain missing inputs",
    ["engineerAssessment", "casualtyEstimate", "power.backupStatus", "gateCounts", "approvedShelterZones"]
      .every((key) => availability[key].available === false));
  check("explicit typed partial audience counts provide a fact without pretending full-site coverage",
    availability.audienceByZone.available && availability.audienceByZone.completeness === "partial");
  check("known catalog facts close input gaps, while unconnected inputs stay unsupported",
    !missingRequiredInputs(["weather.windSpeed", "stageSafety.windLimitExceeded"], observedSnapshot).length &&
    missingRequiredInputs(["engineerAssessment", "unconnected.sensor"], observedSnapshot).length === 2);
  const fullCensus: MobilizationObservation = { key: "audienceByZone", kind: "zone_counts", zoneSlug: null,
    minutesAgo: 0, value: { coverage: "all_venue", entries: context.body.zones.map((zone) => ({ zoneSlug: zone.slug, count: 0 })) } };
  const censusRun = await simulate(mo, { ...scenario("full-census"), observations: [fullCensus] });
  const censusSnapshot = (await audit(censusRun.runId)).input_snapshot;
  check("an explicit full-venue zero census is known and carries complete coverage",
    inputAvailability(censusSnapshot).audienceByZone.available && inputAvailability(censusSnapshot).audienceByZone.completeness === "complete" &&
    censusSnapshot.evidence.find((entry) => entry.ref === "observation-0")?.value.unit === "people" &&
    (await noResponseWork(censusRun.runId)));
  check("ordinary crowd controls are not silently aliased into a typed audience-by-zone fact",
    !inputAvailability({ ...configAudit.input_snapshot, scenario: { ...configAudit.input_snapshot.scenario,
      crowdByZone: [{ zoneSlug: "water-2", estimatedPeople: 0, trend: "stable" }] } }).audienceByZone.available);
  await checkRolledBackMapping(mo, otherMo, observedSnapshot);
  const sharedRun = await post<SimulationRunResult>(otherMo, "getMobilizationRun", { runId: noModel.runId });
  check("another Mo can review the shared proposal audit", sharedRun.status === 200 && sharedRun.body.runId === noModel.runId);
  const otherActorRun = await simulate(otherMo, {
    ...configInput, weather: { ...configInput.weather, temperatureC: 27 },
  });
  check("the same request key is independent between Mo accounts", otherActorRun.runId !== noModel.runId && otherActorRun.status === "configuration_required");
  check(
    "the requesting Mo can fetch the saved run",
    (await post<SimulationRunResult>(mo, "getMobilizationRun", { runId: noModel.runId })).body
      .runId === noModel.runId,
  );
  for (const [name, person] of [
    ["team lead", lead],
    ["volunteer", volunteer],
    ["guest", anonymous],
  ] as const) {
    const direct = await person.client
      .from("mobilization_runs")
      .select("id")
      .eq("id", noModel.runId);
    check(
      `${name} cannot read the private analysis through Supabase RLS`,
      !direct.error && direct.data?.length === 0,
    );
  }
  const directWrite = await mo.client
    .from("mobilization_runs")
    .update({ status: "completed" })
    .eq("id", noModel.runId)
    .select("id");
  check(
    "Mo cannot bypass the audit pipeline with direct Supabase writes",
    !!directWrite.error || directWrite.data?.length === 0,
  );

  clearModelConfig();
  process.env.LLM_BASE_URL = "https://local-integration-test.invalid/v1";
  const missingKey = await simulate(mo, scenario("missing-remote-key"));
  check(
    "a remote provider without a key does not make a request",
    missingKey.status === "configuration_required" &&
      modelCalls === 0 &&
      (await noResponseWork(missingKey.runId)),
  );

  configureTestModel("invalid_json");
  const schemaFailure = await simulate(mo, scenario("schema-failure"));
  const schemaAudit = await audit(schemaFailure.runId);
  if (schemaFailure.status !== "failed" ||
      schemaAudit.raw_responses.filter((entry) => typeof entry === "string" || entry.event === "reply").length !== 2 ||
      schemaAudit.result !== null || !(await noResponseWork(schemaFailure.runId)))
    throw new Error(`LOCAL invalid-JSON fixture did not reach the expected boundary: ${JSON.stringify({
      status: schemaFailure.status, error: schemaAudit.error, validationErrors: schemaFailure.validationErrors,
      modelEvents: schemaAudit.raw_responses.filter((entry) => typeof entry !== "string" && entry.event !== "diagnostic")
        .map((entry) => typeof entry === "string" ? "legacy" : entry.event),
    })}`);
  check(
    "invalid final JSON fails closed after exactly one read round and one final round, without repair",
    schemaFailure.status === "failed" &&
      schemaAudit.raw_responses.filter((entry) => typeof entry === "string" || entry.event === "reply").length === 2 &&
      schemaAudit.result === null &&
      (await noResponseWork(schemaFailure.runId)),
  );
  check(
    "audit identifies the explicitly fake local provider",
    schemaAudit.model === LOCAL_MODEL,
  );
  // Optional safe transport telemetry is not another provider attempt or an actual model reply.
  const schemaModelEvents = schemaAudit.raw_responses.filter((entry) => typeof entry === "string" || entry.event !== "diagnostic");
  check(
    "append-only audit keeps attempt, retrieval envelope, exact tool result and invalid final envelope in order",
    sameJson(schemaModelEvents.map((entry) => typeof entry === "string" ? "legacy-string" : entry.event),
      ["attempt", "reply", "tool_result", "reply"]) && schemaAudit.raw_responses.every((entry) =>
      typeof entry !== "string" && entry.provider === "configured" && entry.model === schemaAudit.model) &&
      schemaAudit.raw_responses.filter((entry) => typeof entry !== "string" && entry.event === "attempt").length === 1 &&
      schemaAudit.raw_responses.filter((entry) => typeof entry !== "string" && entry.event === "reply" &&
        envelopeFinalText(entry.content) === "{not-valid-json").length === 1,
  );
  const schemaTool = schemaAudit.raw_responses.find((entry) => typeof entry !== "string" && entry.event === "tool_result");
  const auditedTool = typeof schemaTool !== "string" && schemaTool?.event === "tool_result" && schemaTool.content
    ? JSON.parse(schemaTool.content) as { name: string; callId: string; arguments: unknown; output: unknown }
    : null;
  check("mandatory tool audit stores the exact empty immutable SOP read before the final request",
    auditedTool?.name === "get_playbooks" && !!auditedTool.callId &&
    sameJson(auditedTool.arguments, { playbookKeys: [] }) &&
    sameJson(auditedTool.output, { playbooks: [], requiredInputChecks: [] }));

  configureTestModel("invalid_semantics");
  const semanticFailure = await simulate(mo, scenario("semantic-failure"));
  const semanticAudit = await audit(semanticFailure.runId);
  check(
    "wire-schema-valid independent work with an invented zone is audited and rejected by canonical semantics",
    semanticFailure.status === "failed" &&
      semanticAudit.raw_responses.filter((entry) => typeof entry === "string" || entry.event === "reply").length === 2 &&
      semanticAudit.result != null &&
      semanticFailure.validationErrors.some((error) =>
        error.includes("nonexistent-test-zone"),
      ) &&
      (await noResponseWork(semanticFailure.runId)),
  );

  configureTestModel("http_error");
  const providerFailure = await simulate(mo, scenario("provider-failure"));
  const providerAudit = await audit(providerFailure.runId);
  check(
    "provider failure records the HTTP status without echoing its body",
    providerFailure.status === "failed" &&
      providerAudit.error === "Model provider returned HTTP 401" &&
      !providerAudit.error.includes("LOCAL_TEST_PROVIDER_BODY") &&
      (await noResponseWork(providerFailure.runId)),
  );

  configureTestModel("valid_no_mobilization");
  modelGate = new Promise<void>((resolve) => {
    releaseModel = resolve;
  });
  const entered = new Promise<void>((resolve) => {
    modelEntered = resolve;
  });
  const callsBefore = modelCalls;
  const concurrentInput = { ...scenario("concurrent-press"), observations: suppliedFacts };
  const presses = Array.from({ length: 3 }, () => simulate(mo, concurrentInput));
  let providerTimeout: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      entered,
      new Promise<never>((_resolve, reject) => {
        providerTimeout = setTimeout(
          () => reject(new Error("The local test provider was not called")),
          10_000,
        );
      }),
    ]);
  } finally {
    if (providerTimeout !== undefined) clearTimeout(providerTimeout);
  }
  releaseModel?.();
  modelGate = null;
  modelEntered = undefined;
  const pressed = await Promise.all(presses);
  const finalRun = await post<SimulationRunResult>(mo, "getMobilizationRun", {
    runId: pressed[0].runId,
  });
  check(
    "concurrent presses share one run and exactly two actual provider requests, without duplicate generation",
    new Set(pressed.map((result) => result.runId)).size === 1 && modelCalls === callsBefore + 2,
  );
  if (finalRun.status !== 200 || finalRun.body.status !== "completed")
    throw new Error(
      `Local no-response fixture failed: ${JSON.stringify({ status: finalRun.body.status, error: finalRun.body.error, validationErrors: finalRun.body.validationErrors })}`,
    );
  check(
    "valid JSON can finish with no mobilization and no tasks",
    finalRun.status === 200 &&
      finalRun.body.status === "completed" &&
      finalRun.body.decision === "no_mobilization" &&
      (await noResponseWork(finalRun.body.runId)),
  );
  const deliveredSnapshot = lastModelSnapshot as PlanningSnapshot | null;
  const deliveredInput = lastModelInput as ModelInput | null;
  check("the actual Responses adapter receives the exact audited projection without altering typed facts or full SOP snapshot",
    deliveredSnapshot != null && deliveredInput != null &&
    sameJson(deliveredSnapshot.scenario.observations, suppliedFacts) &&
    sameJson(deliveredSnapshot, finalRun.body.snapshot) &&
    sameJson(deliveredInput, expectedModelInput(finalRun.body.snapshot!)));
  const repeated = await simulate(mo, concurrentInput);
  check(
    "repeating a completed request returns its saved audit",
    repeated.runId === finalRun.body.runId && modelCalls === callsBefore + 2,
  );
  const different = {
    ...concurrentInput,
    weather: { ...concurrentInput.weather, temperatureC: 27 },
  };
  check(
    "a reused request ID cannot silently change the scenario",
    (await post(mo, "simulateMobilization", different)).status === 409,
  );
  const [runCount] = await q<
    { count: number }[]
  >`select count(*)::int as count from mobilization_runs where requested_by = ${mo.id} and request_id = ${concurrentInput.requestId}`;
  check("the idempotency key has exactly one database record", runCount.count === 1);
  console.log(
    "\nAll Mobilization API integration checks passed (LOCAL fake-provider plumbing only).",
  );
} finally {
  releaseModel?.();
  await Promise.allSettled([...inFlight]);
  fakeModel.stop(true);
  for (const key of modelKeys) {
    const before = savedModelEnv[key];
    if (before === undefined) delete process.env[key];
    else process.env[key] = before;
  }
  try {
    if (crewIds.length) {
      const [unexpected] = await q<
        { count: number }[]
      >`select count(*)::int as count from mobilizations m
        join mobilization_runs r on r.id = m.analysis_run_id where r.requested_by = any(${crewIds}::uuid[])`;
      if (unexpected.count)
        throw new Error(
          "Unexpected test response work exists; preserve it for inspection instead of deleting it",
        );
      await q`delete from mobilization_runs where requested_by = any(${crewIds}::uuid[])`;
      await q`delete from profiles where id = any(${crewIds}::uuid[])`;
    }
    for (const id of authIds) {
      const removed = await admin.auth.admin.deleteUser(id);
      if (removed.error) throw removed.error;
    }
  } finally {
    await q.end();
  }
}
