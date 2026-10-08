import type { PlanningSnapshot } from "./mobilization-contracts";
import { OBSERVATION_CATALOG, observationIsMeaningful } from "./mobilization-observations";

export type MobilizationInputSource = {
  source: "manual_demo" | "database" | "scenario_or_database" | "unsupported";
  label: string;
  canonicalKey: string;
};

/** Explicit aliases only. A stage's expected draw is not a current full-site audience census. */
const BUILTIN_INPUT_SOURCES: Readonly<Record<string, MobilizationInputSource>> = {
  "weather.temperatureC": { source: "manual_demo", label: "Scenario temperature, Celsius", canonicalKey: "weather.temperatureC" },
  "weather.temperature": { source: "manual_demo", label: "Scenario temperature, Celsius", canonicalKey: "weather.temperatureC" },
  "weather.trendCPerHour": { source: "manual_demo", label: "Scenario temperature trend", canonicalKey: "weather.trendCPerHour" },
  "weather.condition": { source: "manual_demo", label: "Scenario weather", canonicalKey: "weather.condition" },
  "weather.warning": { source: "manual_demo", label: "Scenario warning", canonicalKey: "weather.warning" },
  upcomingSets: { source: "scenario_or_database", label: "Scenario stage timing or published timetable", canonicalKey: "upcomingSets" },
  crowdByZone: { source: "manual_demo", label: "Provided zone crowd samples", canonicalKey: "crowdByZone" },
  recentIncidents: { source: "scenario_or_database", label: "Provided or recorded source incidents", canonicalKey: "recentIncidents" },
  roster: { source: "database", label: "Current database roster and workload", canonicalKey: "roster" },
  currentRoster: { source: "database", label: "Current database roster and workload", canonicalKey: "roster" },
  venue: { source: "database", label: "Database venue zones and capacities", canonicalKey: "venue" },
  existingResponses: { source: "database", label: "Current response tasks", canonicalKey: "existingResponses" },
  weatherStatus: { source: "manual_demo", label: "Scenario weather", canonicalKey: "weather.condition" },
};
export const MOBILIZATION_INPUT_SOURCES: Readonly<Record<string, MobilizationInputSource>> = {
  ...Object.fromEntries(Object.values(OBSERVATION_CATALOG).map((definition) => [definition.key, {
    source: "manual_demo" as const, label: definition.label, canonicalKey: definition.key,
  }])),
  ...BUILTIN_INPUT_SOURCES,
};

export function supportedInputKeys(): string[] {
  return Object.keys(MOBILIZATION_INPUT_SOURCES);
}

export type MobilizationInputAvailability = MobilizationInputSource & {
  available: boolean;
  completeness: "partial" | "complete" | "unknown";
};

/** Empty/null observations are unknown. Empty DB roster/response lists are verified query results. */
export function inputAvailability(snapshot: PlanningSnapshot): Record<string, MobilizationInputAvailability> {
  const known: Record<string, boolean> = {
    "weather.temperatureC": Number.isFinite(snapshot.scenario.weather.temperatureC),
    "weather.trendCPerHour": snapshot.scenario.weather.trendCPerHour != null,
    "weather.condition": snapshot.scenario.weather.condition != null,
    "weather.warning": snapshot.scenario.weather.warning != null,
    upcomingSets: snapshot.evidence.some((entry) => entry.kind === "upcoming_set"),
    crowdByZone: snapshot.scenario.crowdByZone.length > 0 &&
      snapshot.scenario.crowdByZone.every((crowd) => crowd.estimatedPeople != null),
    recentIncidents: snapshot.evidence.some((entry) => entry.kind === "incident" &&
      typeof entry.value.count === "number" && entry.value.count > 0),
    roster: true,
    venue: snapshot.zones.length > 0,
    existingResponses: true,
  };
  const completeness: Record<string, "partial" | "complete"> = {
    crowdByZone: "partial", recentIncidents: "partial", upcomingSets: "partial",
  };
  for (const row of snapshot.scenario.observations ?? []) {
    if (OBSERVATION_CATALOG[row.key]?.builtin || !observationIsMeaningful(row)) continue;
    const partial = row.zoneSlug != null || row.kind === "locations" || row.kind === "routes" ||
      (row.kind === "zone_counts" && row.value?.coverage === "partial");
    completeness[row.key] = partial ? (completeness[row.key] ?? "partial") : "complete";
    known[row.key] = true;
  }
  const keys = new Set([...supportedInputKeys(), ...snapshot.playbooks.flatMap((book) => book.content.requiredInputs)]);
  return Object.fromEntries([...keys].map((key) => {
    const source = MOBILIZATION_INPUT_SOURCES[key] ?? {
      source: "unsupported" as const, label: "Not provided by this scenario or database", canonicalKey: key,
    };
    const available = known[source.canonicalKey] === true;
    return [key, { ...source, available,
      completeness: available ? (completeness[source.canonicalKey] ?? "complete") : "unknown" }];
  }));
}

export function missingRequiredInputs(requiredInputs: readonly string[], snapshot: PlanningSnapshot): string[] {
  const availability = inputAvailability(snapshot);
  return [...new Set(requiredInputs.filter((input) => !availability[input]?.available))];
}
