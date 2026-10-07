/** Paid, explicit local experiments only. Reads one saved snapshot; never creates or approves tasks. */
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import postgres from 'postgres';
import type { z } from 'zod';

import type { MobilizationOutput, PlanningSnapshot } from '../src/lib/mobilization-contracts';
import { buildScenario, MOBILIZATION_SCENARIOS, type MobilizationScenarioId } from '../src/lib/mobilization-scenarios';
import { ReadToolResponses } from '../src/server/models/responses';
import type { ModelDiagnostic } from '../src/server/models/http';
import { createCompactMobilizationOutput } from '../src/server/predict/compact-output';
import { compactPlanningInput } from '../src/server/predict/input-projection';
import { compactExperimentInput } from '../src/server/predict/experiment-input';
import { createPlaybookRetrieval } from '../src/server/predict/playbook-retrieval';
import { MOBILIZATION_TOOL_PROMPT_VERSION, MOBILIZATION_TOOL_SYSTEM_PROMPT } from '../src/server/predict/prompts/mobilization-tools';
import { validateMobilizationOutput } from '../src/server/predict/validate';
import { buildEvidence } from '../src/server/predict/simulation';

const options = new Map(process.argv.slice(2).map((arg) => {
  const match = /^--([a-z-]+)=(.+)$/.exec(arg);
  if (!match) throw new Error('Use named --key=value benchmark options');
  return [match[1], match[2]];
}));
const read = (key: string, fallback: string) => options.get(key) ?? fallback;
const positiveInt = (key: string, fallback: number, max: number) => {
  const n = Number(read(key, String(fallback)));
  if (!Number.isSafeInteger(n) || n < 1 || n > max) throw new Error(`Invalid benchmark ${key}`);
  return n;
};
const models = read('models', 'gpt-6-luna').split(',');
if (!models.every((model) => /^gpt-[a-z0-9.-]+$/.test(model))) throw new Error('Invalid benchmark model');
const tiers = read('tiers', 'fast').split(',');
if (!tiers.every((tier) => tier === 'default' || tier === 'fast')) throw new Error('Invalid benchmark service tier');
const reasoningEffort = read('reasoning', 'medium');
if (reasoningEffort !== 'medium' && reasoningEffort !== 'low')
  throw new Error('Benchmark reasoning must be medium or low');
const outputMode = read('output', 'canonical');
if (!['canonical', 'short', 'keyed', 'action'].includes(outputMode)) throw new Error('Invalid output mode');
const inputMode = read('input', 'standard');
if (!['standard', 'lossless-tables', 'server-routes', 'focused'].includes(inputMode)) throw new Error('Invalid input mode');
const flow = read('flow', 'tool');
if (!['tool', 'all-full'].includes(flow)) throw new Error('Invalid benchmark flow');
const scenarioId = read('scenario', 'saved');
if (scenarioId !== 'saved' && !MOBILIZATION_SCENARIOS.some((scenario) => scenario.id === scenarioId))
  throw new Error('Invalid benchmark scenario');
const repeats = positiveInt('repeats', 1, 5);
const concurrency = positiveInt('parallel', 4, 8);
const timeoutMs = positiveInt('timeout-ms', 150_000, 240_000);
const maxOutputTokens = positiveInt('max-output-tokens', 12_000, 16_000);
if (maxOutputTokens < 32) throw new Error('Invalid benchmark output budget');
const sourceRunId = read('run', '5523f239-ff07-4ee8-81d3-deb2deb02c79');
if (!/^[0-9a-f-]{36}$/.test(sourceRunId)) throw new Error('Invalid source run ID');
if (!process.env.LLM_API_KEY || !process.env.LLM_BASE_URL || !process.env.DATABASE_URL)
  throw new Error('Benchmark needs existing server-only LLM and database configuration');

const directory = resolve('.local/mobilization-experiments', `${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID().slice(0, 8)}`);
await mkdir(directory, { recursive: true, mode: 0o700 });
const save = async (path: string, content: unknown) => writeFile(resolve(directory, path),
  typeof content === 'string' ? content : JSON.stringify(content, null, 2), { mode: 0o600, flag: 'wx' });
const db = postgres(process.env.DATABASE_URL, { max: 1 });
let snapshot: PlanningSnapshot;
try {
  const [row] = await db`select input_snapshot from mobilization_runs where id = ${sourceRunId}`;
  if (!row?.input_snapshot) throw new Error('Saved planning snapshot not found');
  snapshot = structuredClone(row.input_snapshot) as PlanningSnapshot;
} finally { await db.end(); }
if (scenarioId !== 'saved') {
  const context = { zones: snapshot.zones, teams: snapshot.teams, skills: snapshot.skills,
    timetable: [], playbooks: snapshot.playbooks, modelReady: true, modelConfigurationMessage: null };
  const scenario = { ...buildScenario(scenarioId as MobilizationScenarioId, context).input, requestId: `experiment-${randomUUID()}` };
  // Replace hypothetical observations only. The captured venue/DB incident/roster/workload state stays
  // fixed; do not invent approvals or free crew to make the model look faster or more capable.
  const databaseFacts = snapshot.evidence.filter((entry) => entry.source === 'database' && entry.kind !== 'venue');
  snapshot = { ...snapshot, scenario, evidence: [...buildEvidence(scenario, context, [], snapshot.evaluatedAt), ...databaseFacts] };
}
await save('snapshot.json', snapshot);
const jobs = models.flatMap((model) => tiers.flatMap((tier) => Array.from({ length: repeats }, (_, repeat) => ({
  model, tier: tier as 'default' | 'fast', repeat: repeat + 1,
}))));
const manifest = { sourceRunId, promptVersion: MOBILIZATION_TOOL_PROMPT_VERSION,
  reasoningEffort, inputMode, outputMode, flow, scenarioId, jobs, timeoutMs, maxOutputTokens, concurrency,
  note: 'Independent local planning experiments, no application database writes or dispatch. Human SOP-fidelity review is additional to deterministic validation.' };
await save('manifest.json', manifest);
console.log(JSON.stringify({ event: 'experiment_batch', directory, ...manifest }));

type Contract = { schema: z.ZodType | (() => z.ZodType); expand: (wire: unknown) => MobilizationOutput;
  promptSupplement?: string; supplementalInput?: unknown };
const results: unknown[] = [];
let next = 0;
async function experiment(job: typeof jobs[number], index: number) {
  const tag = `${String(index + 1).padStart(2, '0')}-${job.model}-${job.tier}-${reasoningEffort}-${job.repeat}`;
  const started = performance.now();
  const diagnostics: ModelDiagnostic[] = [];
  let responseIndex = 0, requestIndex = 0;
  const retrieval = createPlaybookRetrieval(snapshot);
  let selectedKeys: string[] = [];
  const contract: Contract = outputMode === 'short'
    ? (await import('../src/server/predict/experiment-compact-output')).createExperimentCompactMobilizationOutput(snapshot)
    : outputMode === 'keyed'
      ? (await import('../src/server/predict/experiment-keyed-output')).createExperimentKeyedMobilizationOutput(snapshot)
    : outputMode === 'action'
      ? (await import('../src/server/predict/action-output')).createActionMobilizationOutput(snapshot, () => selectedKeys)
    : createCompactMobilizationOutput(snapshot);
  const playbookMode = flow === 'tool' ? 'index_only' : 'all_full';
  if (inputMode === 'focused' && flow !== 'tool') throw new Error('Focused input requires the readonly SOP tool');
  const projected = inputMode === 'focused' ? (await import('../src/server/predict/focused-input')).focusedPlanningInput(snapshot)
    : inputMode === 'lossless-tables' ? compactExperimentInput(snapshot, playbookMode)
    : compactPlanningInput(snapshot, { playbookMode });
  const input = inputMode === 'server-routes' ? { ...projected, routes: {
    kind: 'ordinary_walking_distances_kept_server_side', allocation: 'server_only',
    note: 'Individual assignment and walking-distance ranking remain server-side. No distances are supplied here; do not invent travel times. This never grants emergency movement authorization.',
  } } : projected;
  const prompt = JSON.stringify(contract.supplementalInput ? { input, supplementalInput: contract.supplementalInput } : input);
  let system = MOBILIZATION_TOOL_SYSTEM_PROMPT;
  if (flow === 'all-full') {
    system = system.replace(/First call the read-only get_playbooks[\s\S]*?No tool creates, approves, dispatches or changes data\./,
      'All published SOPs are supplied in full in the immutable input. Do not call tools. Review the complete rules before returning only the schema JSON. Nothing here creates, approves, dispatches or changes data.');
    system += '\nFor this single-round experimental full-input variant, every published SOP was already read in full; the separate retrieval requirement is satisfied by the supplied full content.\n';
    selectedKeys = snapshot.playbooks.filter((book) => book.status === 'published').map((book) => `${book.content.slug}:${book.version}`);
    retrieval.read({ playbookKeys: selectedKeys });
  }
  if (contract.promptSupplement) system += `\n${contract.promptSupplement}`;
  await save(`${tag}-input.json`, { system, prompt: JSON.parse(prompt), schema: typeof contract.schema === 'function'
    ? 'Resolved after the audited immutable SOP read; exact schema is in request 2' : contract.schema.toJSONSchema() });
  const audit = async (raw: string) => save(`${tag}-response-${++responseIndex}.json`, raw);
  const fetchAudited: typeof fetch = async (url, init) => {
    if (typeof init?.body === 'string') await save(`${tag}-request-${++requestIndex}.json`, JSON.parse(init.body));
    return fetch(url, init);
  };
  const client = new ReadToolResponses({ baseUrl: process.env.LLM_BASE_URL!, apiKey: process.env.LLM_API_KEY,
    model: job.model, fetch: fetchAudited });
  console.log(JSON.stringify({ event: 'experiment_start', tag, inputBytes: Buffer.byteLength(prompt) }));
  let output: MobilizationOutput | null = null;
  let validationErrors: string[] = [], failure: string | null = null;
  const callOptions = { signal: AbortSignal.timeout(timeoutMs), reasoningEffort,
    maxTokens: maxOutputTokens, toolMaxTokens: 2_000, serviceTier: job.tier, onResponse: audit,
    onDiagnostic: (value: ModelDiagnostic) => { diagnostics.push(value); } };
  try {
    const wire = flow === 'tool' ? await client.generate({ system, prompt, schema: contract.schema, tool: {
      name: 'get_playbooks', description: 'Read full immutable published SOPs by exact version keys; no mutations.',
      args: retrieval.args, execute: async (args, callId) => {
        const result = retrieval.read(args);
        selectedKeys = [...args.playbookKeys];
        await save(`${tag}-tool-result.json`, { callId, args, result });
        return JSON.stringify(result);
      },
    } }, callOptions) : await client.generateStrict({ system, prompt,
      schema: typeof contract.schema === 'function' ? contract.schema() : contract.schema }, callOptions);
    output = contract.expand(wire);
    validationErrors = [...new Set([...retrieval.validate(output),
      ...validateMobilizationOutput(output, snapshot, snapshot.skills.map((skill) => skill.slug))])];
  } catch (error) {
    // Locally saved raw responses retain the audit; console never dumps provider content or secrets.
    failure = error instanceof Error ? `${error.name}: ${error.message.slice(0, 300)}` : 'Unknown experiment failure';
  }
  const elapsedMs = Math.round(performance.now() - started);
  const summary = { tag, ...job, sourceRunId, reasoningEffort, flow, scenarioId, inputMode, outputMode, maxOutputTokens, elapsedMs,
    deterministicPass: output != null && validationErrors.length === 0 && failure == null,
    under30Seconds: elapsedMs < 30_000, decision: output?.decision ?? null,
    findingCount: output?.assessment.findings.length ?? null,
    planCount: output?.mobilizations.length ?? null,
    taskCount: output?.mobilizations.reduce((n, plan) => n + plan.tasks.length, 0) ?? null,
    unmetCount: output?.mobilizations.reduce((n, plan) => n + plan.unmetRequirements.length, 0) ?? null,
    validationErrors, failure,
    rounds: diagnostics.filter((event) => event.stage === 'response_body').map((event) => ({
      request: event.request, elapsedMs: event.elapsedMs, status: event.status,
      requestedServiceTier: event.requestedServiceTier, actualServiceTier: event.actualServiceTier, usage: event.usage,
    })), humanQualityReview: 'pending', note: 'Planning+local audit+validation timing, not full application DB commit latency.' };
  await save(`${tag}-result.json`, { summary, output, diagnostics });
  results.push(summary);
  console.log(JSON.stringify({ event: 'experiment_result', ...summary }));
}
await Promise.all(Array.from({ length: Math.min(concurrency, jobs.length) }, async () => {
  while (next < jobs.length) { const index = next++; await experiment(jobs[index], index); }
}));
await save('results.json', results);
console.log(JSON.stringify({ event: 'experiment_batch_complete', directory, count: results.length }));
