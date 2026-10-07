import type {
  ManagedPlaybook,
  PlanningEvidence,
  PlanningSnapshot,
  PlaybookContent,
  SimulationInput,
  VenueZone,
} from '@/lib/mobilization-contracts';
import { inputAvailability } from '@/lib/mobilization-inputs';

type Action = PlaybookContent['actions'][number];
type DefaultActionField = 'staffingGuidance' | 'requiredSkills' | 'locationGuidance' | 'completionCriteria';
export type CompactPlaybook = {
  playbookKey: string;
  version: number;
  content: Omit<PlaybookContent, 'actions'> & {
    actions: (Omit<Action, DefaultActionField> & Partial<Pick<Action, DefaultActionField>>)[];
  };
};
export type PlaybookIndexEntry = Pick<PlaybookContent,
  'slug' | 'title' | 'appliesWhen'> & {
    playbookKey: string;
    version: number;
  };
export type ProjectionOptions = { playbookMode?: 'all_full' | 'index_only' };

/** A model-facing copy, never an edit to the full snapshot saved in the audit database. */
const copy = <T>(value: T): T => structuredClone(value);
const playbookKey = (book: ManagedPlaybook) => `${book.content.slug}:${book.version}`;
function published(book: ManagedPlaybook) {
  if (book.status !== 'published') throw new Error('Only published playbooks may enter the AI input.');
}

/** Full rules and source text remain intact. Only schema-defined empty action defaults are omitted. */
export function compactPlaybook(book: ManagedPlaybook): CompactPlaybook {
  published(book);
  const content = copy(book.content);
  const actions: CompactPlaybook['content']['actions'] = content.actions.map((action) => {
    const compact: CompactPlaybook['content']['actions'][number] = { ...action };
    for (const key of ['staffingGuidance', 'locationGuidance', 'completionCriteria'] as const)
      if (compact[key] === '') delete compact[key];
    if (compact.requiredSkills?.length === 0) delete compact.requiredSkills;
    // Null headcount is an explicit unknown, not a default staffing quantity.
    return compact;
  });
  return { playbookKey: playbookKey(book), version: book.version, content: { ...content, actions } };
}

/** Routing index only: selecting a SOP is not a full review of its rules or actions. */
export function playbookIndex(book: ManagedPlaybook): PlaybookIndexEntry {
  published(book);
  const { slug, title, appliesWhen } = book.content;
  return { playbookKey: playbookKey(book), slug, version: book.version, title, appliesWhen };
}

/** Lossless named-zone table. These distances do not grant emergency movement authorization. */
export function compactRoutes(routes: PlanningSnapshot['routes']) {
  return {
    kind: 'ordinary_walking_distances_not_emergency_authorizations' as const,
    columns: ['from', 'to', 'minutes', 'meters'] as const,
    values: routes.map(({ from, to, minutes, meters }): [string, string, number, number] =>
      [from, to, minutes, meters]),
  };
}

function sameValue(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (Array.isArray(a) || Array.isArray(b))
    return Array.isArray(a) && Array.isArray(b) && a.length === b.length &&
      a.every((item, index) => sameValue(item, b[index]));
  if (a == null || b == null || typeof a !== 'object' || typeof b !== 'object') return false;
  const left = a as Record<string, unknown>, right = b as Record<string, unknown>;
  return Object.keys(left).length === Object.keys(right).length &&
    Object.keys(left).every((key) => Object.hasOwn(right, key) && sameValue(left[key], right[key]));
}

const contains = (value: Record<string, unknown>, expected: object) =>
  Object.entries(expected).every(([key, item]) => Object.hasOwn(value, key) && sameValue(value[key], item));

function compactZones(snapshot: PlanningSnapshot): (VenueZone | { slug: string; evidenceRef: string })[] {
  return snapshot.zones.map((zone) => {
    const fact = snapshot.evidence.find((entry) => entry.kind === 'venue' && entry.source === 'database' &&
      entry.zoneSlug === zone.slug && contains(entry.value, zone));
    // The venue fact keeps name, role/kind, capacity, open-air flag, source and timestamp exactly once.
    return fact ? { slug: zone.slug, evidenceRef: fact.ref } : copy(zone);
  });
}

type RemainingScenario = Partial<Omit<SimulationInput, 'requestId'>>;
function compactScenario(snapshot: PlanningSnapshot): RemainingScenario | undefined {
  const remaining: RemainingScenario = {};
  const used = new Set<number>();
  const matched = (kind: string, zoneSlug: string | null, expected: object, observedAt: string) => {
    const index = snapshot.evidence.findIndex((entry, i) => !used.has(i) && entry.kind === kind &&
      entry.source === 'manual_demo' && entry.zoneSlug === zoneSlug && entry.observedAt === observedAt &&
      contains(entry.value, expected));
    if (index < 0) return false;
    used.add(index); // A single evidence row cannot erase two independent equal observations.
    return true;
  };
  const at = Date.parse(snapshot.evaluatedAt);
  const before = (minutes: number) => Number.isFinite(at)
    ? new Date(at - minutes * 60_000).toISOString() : '';
  const input = snapshot.scenario;
  if (!matched('weather', null, input.weather, snapshot.evaluatedAt)) remaining.weather = copy(input.weather);
  const sets = input.upcomingSets.filter((row) =>
    !matched('upcoming_set', row.stageSlug, row, snapshot.evaluatedAt));
  const crowds = input.crowdByZone.filter((row) =>
    !matched('crowd', row.zoneSlug, row, snapshot.evaluatedAt));
  const incidents = input.recentIncidents.filter((row) =>
    !matched('incident', row.zoneSlug, row, before(row.minutesAgo)));
  const observations = (input.observations ?? []).filter((row) =>
    !matched('observation', row.zoneSlug, { key: row.key, kind: row.kind, value: row.value }, before(row.minutesAgo)));
  if (sets.length) remaining.upcomingSets = copy(sets);
  if (crowds.length) remaining.crowdByZone = copy(crowds);
  if (incidents.length) remaining.recentIncidents = copy(incidents);
  // Unknown/empty observations normally have no evidence row. Retain them rather than infer a value.
  if (observations.length) remaining.observations = copy(observations);
  return Object.keys(remaining).length ? remaining : undefined;
}

type RosterProjection = {
  projection: 'volunteer_capacity_by_team';
  source: 'database';
  evidenceRefs: string[];
  allocation: 'server_only';
  note: string;
};
function compactRoster(snapshot: PlanningSnapshot): RosterProjection | PlanningSnapshot['roster'] {
  const aggregates: PlanningEvidence[] = [];
  const count = (value: unknown): value is number =>
    typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
  for (const team of snapshot.teams) {
    const facts = snapshot.evidence.filter((entry) => entry.kind === 'roster' && entry.source === 'database' &&
      entry.zoneSlug === null && entry.value.teamSlug === team.slug);
    if (facts.length !== 1) return copy(snapshot.roster);
    const fact = facts[0], { free, onDuty, freeBySkill } = fact.value;
    if (!count(free) || !count(onDuty) || free > onDuty || freeBySkill == null ||
      typeof freeBySkill !== 'object' || Array.isArray(freeBySkill)) return copy(snapshot.roster);
    const skills = freeBySkill as Record<string, unknown>;
    const people = snapshot.roster.filter((person) => person.teamSlug === team.slug && person.free);
    if (people.length !== free || snapshot.skills.some((skill) => !Object.hasOwn(skills, skill.slug)) ||
      Object.entries(skills).some(([skill, available]) => !count(available) || available > free ||
        available !== people.filter((person) => person.skills.includes(skill)).length)) return copy(snapshot.roster);
    aggregates.push(fact);
  }
  const teams = new Set<string>(snapshot.teams.map((team) => team.slug));
  if (!snapshot.teams.length || snapshot.roster.some((person) => person.free &&
    (person.teamSlug == null || !teams.has(person.teamSlug)))) return copy(snapshot.roster);
  return {
    projection: 'volunteer_capacity_by_team', source: 'database',
    evidenceRefs: aggregates.map((fact) => fact.ref), allocation: 'server_only',
    note: 'Database aggregates count volunteer-role crew, not leads or Mo. Per-skill free counts are marginal, '
      + 'not proof that the same people hold multiple skills. The server uses the full roster, locations, '
      + 'shift validity and current workload for individual eligibility and allocation.',
  };
}

/**
 * Endpoint-independent AI input only. Full audit snapshots are untouched. Default mode supplies every
 * published SOP in full; index_only requires a separate full-playbook retrieval tool before planning.
 */
export function compactPlanningInput(snapshot: PlanningSnapshot, options: ProjectionOptions = {}) {
  const mode = options.playbookMode ?? 'all_full';
  const scenario = compactScenario(snapshot);
  const availability = inputAvailability(snapshot);
  return {
    schemaVersion: snapshot.schemaVersion, playbookMode: mode,
    playbooks: mode === 'index_only' ? snapshot.playbooks.map(playbookIndex) : snapshot.playbooks.map(compactPlaybook),
    teams: copy(snapshot.teams), skills: copy(snapshot.skills), zones: compactZones(snapshot),
    routes: compactRoutes(snapshot.routes), evaluatedAt: snapshot.evaluatedAt,
    ...(scenario ? { scenario } : {}),
    roster: compactRoster(snapshot),
    existingResponses: copy(snapshot.existingResponses), evidence: copy(snapshot.evidence),
    inputAvailability: Object.fromEntries(Object.entries(availability).map(([key, item]) => [key, {
      source: item.source, available: item.available, completeness: item.completeness,
      ...(item.canonicalKey !== key ? { canonicalKey: item.canonicalKey } : {}),
    }])),
  };
}
