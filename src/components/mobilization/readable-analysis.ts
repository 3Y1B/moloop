import type { PlanningEvidence } from "@/lib/mobilization-contracts";
import { OBSERVATION_CATALOG } from "@/lib/mobilization-observations";

type NamedLookup = { slug?: string; name?: string; label?: string };
type Lookup = Readonly<Record<string, NamedLookup>> | readonly NamedLookup[];
export type ReadableLookups = { zones?: Lookup; teams?: Lookup; skills?: Lookup };
export type ReadableEvidence = {
  title: string;
  source: "Hypothetical observation" | "Recorded observation";
  observedAt: string;
  location: string | null;
  facts: string[];
};

/** Public qualification names from the reference roster, available even when no AI analysis was loaded. */
const SKILL_NAMES: Readonly<Record<string, string>> = {
  "first-aid-cert": "First Aid Certificate",
  wwcc: "Working With Children Check",
  "radio-trained": "Radio trained",
  rsa: "Responsible Service of Alcohol",
  "crowd-control": "Crowd control certificate",
  multilingual: "Speaks a language other than English",
};

const LABELS: Readonly<Record<string, string>> = {
  ...Object.fromEntries(Object.values(OBSERVATION_CATALOG).map((item) => [item.key, item.label])),
  "weather.temperatureC": "Temperature", "weather.trendCPerHour": "Temperature trend",
  "weather.condition": "Weather condition", "weather.warningInMinutes": "Time until the warning",
  upcomingSets: "Upcoming stage performances", crowdByZone: "Crowd observations by location",
  recentIncidents: "Recent incident reports", existingResponses: "Existing response work",
  roster: "Crew availability", venue: "Venue information", inputAvailability: "Available observations",
  assessment: "Situation assessment", findings: "Identified concerns", possibleCause: "Possible cause",
  missingInputs: "Missing observations", unmetRequirements: "Actions not fully covered",
  requiredSkills: "Required skills", completionCriteria: "Completion condition",
  addressesFindingIds: "Related concerns", playbookRefs: "Response rules", evidenceRefs: "Supporting observations",
  playbookAssessments: "Response rule review", appliesWhen: "Activation conditions",
  requiredInputs: "Required observations", decisionPoints: "Decisions for Mo",
  temperatureC: "Temperature", trendCPerHour: "Temperature trend", condition: "Weather condition",
  warning: "Weather warning", warningInMinutes: "Time until the warning",
  stageSlug: "Stage", zoneSlug: "Location", teamSlug: "Team", fromZoneSlug: "From location",
  toZoneSlug: "To location", startsInMinutes: "Time until the performance", durationMinutes: "Performance duration",
  startsAt: "Starts", endsAt: "Ends", expectedPeople: "Expected audience", estimatedPeople: "Estimated crowd",
  minutesAgo: "Reported", openCount: "Reports still open", count: "Reported count", act: "Performance",
  onDuty: "Crew on duty", free: "Available crew", freeBySkill: "Available crew by skill",
  windowMinutes: "Report window", sourceReportCount: "Recorded source reports",
  possiblyTruncated: "The recorded list may be incomplete", isOpenAir: "Open-air location",
  requiredCount: "Crew required", peopleNeeded: "Crew required", shiftEndsAt: "Shift ends",
  approved: "Approval", approvalRequired: "Mo approval required", coverage: "Observation coverage",
  from: "From location", to: "To location", meters: "Walking distance", minutes: "Walking time",
  capacity: "Capacity", status: "Condition", entries: "Locations", title: "Description", name: "Name",
  description: "Report", category: "Incident type", trend: "Crowd trend", value: "Observation",
  scope: "Coverage", note: "Note", key: "Observation", kind: "Observation type", unit: "Unit",
};
const VALUES: Readonly<Record<string, string>> = {
  on_duty: "On duty", on_break: "On a break", off_shift: "Off shift",
  not_applicable: "No activation signal", insufficient_data: "More observations needed",
  no_mobilization: "No mobilization proposed", low_supply: "Low supply", out_of_service: "Out of service",
  suspected_contamination: "Suspected contamination", none_observed: "None observed",
  suspected_fire: "Suspected fire", confirmed_fire: "Confirmed fire", suspected_gas: "Suspected gas",
  confirmed_gas: "Confirmed gas", toward_hazard: "Toward the hazard", away_from_hazard: "Away from the hazard",
  all_venue: "Whole venue", partial: "Only the supplied locations", site: "Whole venue", zone: "One location",
  manual_demo: "Hypothetical observation", database: "Recorded observation",
  first_aid: "First aid", lost_child: "Lost child", medical: "Medical", heat: "Heat",
};
const OMIT_KEYS = /^(?:id|ids|ref|refs|slug|schemaVersion|requestId|taskId|reportId|runId|volunteerId|mobilizationId|analysisRunId|stepKey|actionId|evidenceRefs|addressesFindingIds|playbookRefs)$/i;
const UUID = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;
const RAW_REFERENCE = /\b(?:demo-(?:weather|set-\d+|crowd-\d+|incident-\d+)|observation-\d+|database-incident-window|(?:roster|venue|timetable)-[a-z0-9][a-z0-9_-]*|(?:incident|task|finding|risk|fact|run)_(?:[a-z0-9][a-z0-9_-]*)|(?:incident|task|finding|risk|fact|run)-(?=[a-z0-9_-]*\d)[a-z0-9][a-z0-9_-]*)\b/gi;
const identityField = (key: string) => OMIT_KEYS.test(key) || /(?:Id|Ids|ID|IDs|Ref|Refs|Key|Keys)$/.test(key) || /_(?:id|ids|ref|refs|key|keys)$/i.test(key);

function pairs(lookup?: Lookup): [string, string][] {
  if (!lookup) return [];
  return (Array.isArray(lookup)
    ? lookup.map((entry) => [entry.slug ?? "", entry] as const)
    : Object.entries(lookup)).flatMap(([key, entry]) => {
      const label = entry.name ?? entry.label;
      return key && label ? [[key, label] as [string, string]] : [];
    });
}
function lookupPairs(lookups?: ReadableLookups) {
  const skills = pairs(lookups?.skills);
  const defaults = Object.entries(SKILL_NAMES).filter(([slug]) =>
    !skills.some(([known]) => known.toLowerCase() === slug.toLowerCase()));
  return [...pairs(lookups?.zones), ...pairs(lookups?.teams), ...defaults, ...skills];
}
function words(value: string) {
  return value.replace(/\[\d+\]/g, " ").replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .replace(/([a-z\d])([A-Z])/g, "$1 $2").replace(/[._-]+/g, " ").trim();
}
function labelFor(key: string, lookups?: ReadableLookups): string {
  const known = lookupPairs(lookups).find(([slug]) => slug.toLowerCase() === key.toLowerCase())?.[1] ?? LABELS[key];
  if (known) return known;
  const label = words(key).replace(/\b(?:slug|refs?|ids?)\b/gi, "").replace(/\s+/g, " ").trim();
  return label ? label[0].toUpperCase() + label.slice(1).toLowerCase() : "Observation";
}
const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function named(value: string, lookup?: Lookup): string | null {
  return pairs(lookup).find(([slug]) => slug.toLowerCase() === value.toLowerCase())?.[1] ?? null;
}

/** Field-aware names. An unfamiliar qualification remains a requirement, not "no qualification". */
export function readableName(kind: "zone" | "team" | "skill", slug: string | null, lookups?: ReadableLookups): string {
  const nouns = { zone: "Location", team: "Team", skill: "Qualification" };
  if (!slug?.trim()) return `${nouns[kind]} not specified`;
  const lookup = kind === "zone" ? lookups?.zones : kind === "team" ? lookups?.teams : lookups?.skills;
  const publicName = named(slug, lookup) ?? (kind === "skill" ? SKILL_NAMES[slug.toLowerCase()] : null);
  return publicName ?? `${nouns[kind]} name unavailable`;
}

/** Parse embedded structured values as well as whole payloads, so a prose prefix cannot expose identity fields. */
function replaceStructured(text: string, lookups?: ReadableLookups): string {
  let result = "";
  for (let at = 0; at < text.length;) {
    if (text[at] !== "{" && text[at] !== "[") { result += text[at++]; continue; }
    const start = at;
    const stack: string[] = [];
    let quoted = false;
    let escaped = false;
    let end = start;
    for (; end < text.length; end++) {
      const char = text[end];
      if (quoted) {
        if (escaped) escaped = false;
        else if (char === "\\") escaped = true;
        else if (char === '"') quoted = false;
        continue;
      }
      if (char === '"') quoted = true;
      else if (char === "{" || char === "[") stack.push(char === "{" ? "}" : "]");
      else if (char === "}" || char === "]") {
        if (stack.pop() !== char) break;
        if (!stack.length) { end++; break; }
      }
    }
    if (end > start && !stack.length) {
      try {
        const content = describeValue(JSON.parse(text.slice(start, end)), lookups).join("; ");
        result += content || "No readable observations supplied";
        at = end;
        continue;
      } catch { /* Not a structured value, keep its readable surrounding words. */ }
    }
    result += text[at++];
  }
  return result;
}

/** Display-only conversion. Never alters the saved audit, rule verdicts or operational instructions. */
export function readableText(text: string, lookups?: ReadableLookups): string {
  const trimmed = text.replace(/```(?:json)?/gi, "").trim();
  if (!trimmed) return "";
  if ((trimmed.startsWith("{") && trimmed.endsWith("}")) ||
      (trimmed.startsWith("[") && trimmed.endsWith("]"))) {
    try { return describeValue(JSON.parse(trimmed), lookups).join("; ") || "No readable observations supplied"; }
    catch { /* Treat malformed structured text as words, never as executable content. */ }
  }
  let output = replaceStructured(trimmed, lookups).replace(RAW_REFERENCE, "supporting observation")
    .replace(UUID, "recorded item")
    .replace(/\b(evidence|finding|task|playbook|action|run)\s+(?:IDs?|refs?|keys?)\s*[:=]?\s*["']?[a-zA-Z0-9][a-zA-Z0-9_-]*["']?/gi, "related $1");
  const replacements: [string, string, boolean][] = [
    ...[...Object.entries(LABELS), ...Object.entries(VALUES)].map(([token, label]) => [token, label, false] as [string, string, boolean]),
    ...lookupPairs(lookups).map(([token, label]) => [token, label, true] as [string, string, boolean]),
  ];
  replacements
    .sort(([a, , aNamed], [b, , bNamed]) => b.length - a.length || Number(bNamed) - Number(aNamed));
  for (const [token, label, caseInsensitive] of replacements) {
    // Single ordinary words are labels only when used alone. Do not turn every mention of a crowd into a team name.
    const exactLabel = caseInsensitive ? output.trim().toLowerCase() === token.toLowerCase() : output.trim() === token;
    if (!/[._-]|[a-z][A-Z]/.test(token) && !exactLabel) continue;
    output = output.replace(new RegExp(`(?<![\\w-])${escape(token)}(?![\\w-])`, caseInsensitive ? "gi" : "g"), label);
  }
  output = output
    .replace(/\b[a-zA-Z][a-zA-Z\d_-]*(?:\[\d+\])?\.[a-zA-Z][a-zA-Z\d_.[\]-]*/g, (key) => labelFor(key, lookups))
    .replace(/\b[a-z][a-z\d]*(?:[A-Z][a-zA-Z\d]*)+\b/g, (key) => labelFor(key, lookups))
    .replace(/\b[a-zA-Z][a-zA-Z\d]*(?:_[a-zA-Z\d]+)+\b/g, (key) => labelFor(key, lookups))
    .replace(/\b[a-zA-Z]+(?:-[a-zA-Z]+)*-\d+\b/g, (key) => labelFor(key, lookups))
    .replace(/\b(?:evidence|finding|task|playbook|action|run)\s+(?:IDs?|refs?|keys?)\s*[:=]?/gi, "Related information ")
    .replace(/[{}\[\]`]/g, " ").replace(/"([^"\n]+)"\s*:/g, "$1: ")
    .replace(/\s+([,.;:!?])/g, "$1").replace(/[ \t]{2,}/g, " ").trim();
  return output;
}

function scalar(value: unknown, key: string, lookups?: ReadableLookups): string {
  if (value == null || value === "") return "Unknown";
  if (typeof value === "boolean") return key === "approved" ? (value ? "Approved" : "Not approved") : value ? "Yes" : "No";
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return "Unknown";
    const units: Record<string, string> = {
      temperatureC: "°C", trendCPerHour: "°C per hour", warningInMinutes: "minutes",
      startsInMinutes: "minutes after this analysis", durationMinutes: "minutes", minutesAgo: "minutes ago",
      windowMinutes: "minutes", expectedPeople: "people", estimatedPeople: "people", capacity: "people",
      meters: "metres", minutes: "minutes",
    };
    return `${value}${units[key] ? ` ${units[key]}` : ""}`;
  }
  if (typeof value === "string") {
    if (["zoneSlug", "stageSlug", "fromZoneSlug", "toZoneSlug", "from", "to"].includes(key))
      return named(value, lookups?.zones) ?? "Location not identified";
    if (key === "teamSlug") return named(value, lookups?.teams) ?? "Team not identified";
    return dateText(value) ?? readableText(value, lookups);
  }
  return "Unknown";
}

/** Unknown structures are traversed into labelled facts; identity fields are never rendered. */
function describeValue(value: unknown, lookups?: ReadableLookups, prefix = "", seen = new Set<object>()): string[] {
  if (value == null || typeof value !== "object") return [`${prefix ? `${prefix}: ` : ""}${scalar(value, "", lookups)}`];
  if (seen.has(value)) return [`${prefix ? `${prefix}: ` : ""}Further details unavailable`];
  seen.add(value);
  try {
    if (Array.isArray(value)) {
      if (!value.length) return [`${prefix ? `${prefix}: ` : ""}No entries supplied`];
      return value.flatMap((entry, index) => describeValue(entry, lookups,
        prefix ? `${prefix}${value.length > 1 ? ` ${index + 1}` : ""}` : "", seen));
    }
    return Object.entries(value).flatMap(([key, item]) => {
      if (identityField(key)) return [];
      const label = labelFor(key, lookups);
      const path = prefix ? `${prefix} — ${label}` : label;
      if (item != null && typeof item === "object") return describeValue(item, lookups, path, seen);
      return [`${path}: ${scalar(item, key, lookups)}`];
    });
  } finally { seen.delete(value); }
}

function dateText(value: string): string | null {
  if (!/^\d{4}-\d\d-\d\dT\d\d:\d\d/.test(value)) return null;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  return `${new Intl.DateTimeFormat("en-GB", {
    day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "UTC",
  }).format(date)} UTC`;
}

export function describeEvidence(evidence: PlanningEvidence, lookups?: ReadableLookups): ReadableEvidence {
  const titles: Record<string, string> = { weather: "Weather", venue: "Venue information",
    upcoming_set: "Upcoming performance", crowd: "Crowd observation", incident: "Incident report",
    incident_window: "Recent recorded reports", roster: "Crew availability" };
  const observationKey = evidence.kind === "observation" && typeof evidence.value.key === "string"
    ? evidence.value.key : null;
  const definition = observationKey ? OBSERVATION_CATALOG[observationKey] : null;
  let facts: string[];
  if (observationKey) {
    const observation = evidence.value.value;
    const unit = definition?.unit ?? (typeof evidence.value.unit === "string" ? readableText(evidence.value.unit) : "");
    facts = observation != null && typeof observation === "object"
      ? describeValue(observation, lookups)
      : [`${scalar(observation, "", lookups)}${typeof observation === "number" && unit ? ` ${unit}` : ""}`];
    if (evidence.value.approvalRequired === true) facts.push("Mo approval is required; review each supplied approval.");
  } else facts = describeValue(evidence.value, lookups);
  return {
    title: observationKey ? labelFor(observationKey, lookups) : titles[evidence.kind] ?? labelFor(evidence.kind, lookups),
    source: evidence.source === "manual_demo" ? "Hypothetical observation" : "Recorded observation",
    observedAt: dateText(evidence.observedAt) ?? "Observation time unavailable",
    location: evidence.zoneSlug ? named(evidence.zoneSlug, lookups?.zones) ?? "Location not identified" : null,
    facts: facts.length ? facts : ["No readable observations supplied"],
  };
}

export function humanizeMissingInputs(inputs: readonly string[], lookups?: ReadableLookups): string[] {
  const seen = new Set<string>();
  // Split only bare input identifiers. A location, negation or qualifying clause can govern the whole sentence.
  const builtins = new Set(["upcomingSets", "crowdByZone", "recentIncidents", "roster", "venue", "existingResponses"]);
  const bareInput = (input: string) => !!OBSERVATION_CATALOG[input] || builtins.has(input) ||
    /^[a-z][a-zA-Z\d_]*(?:\.[a-z][a-zA-Z\d_]*)+$/.test(input);
  const individualInputs = inputs.flatMap((input) => {
    const parts = input.split(/[,;]/).map((part) => part.trim());
    return parts.length > 1 && parts.every(bareInput) ? parts : [input];
  });
  return individualInputs.flatMap((input) => {
    const readable = readableText(input, lookups);
    const identity = readable.toLocaleLowerCase().replace(/\s+/g, " ").trim();
    if (!identity || seen.has(identity)) return [];
    seen.add(identity);
    return [readable];
  });
}
