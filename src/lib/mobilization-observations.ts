import { z } from "zod";

export type ObservationKind = "number" | "boolean" | "status" | "text" | "location" | "zone_counts" | "locations" | "routes";
export type ObservationDefinition = {
  key: string; label: string; group: "weather" | "crowd" | "infrastructure" | "medical" | "approvals";
  kind: ObservationKind; unit?: string; min?: number; max?: number; integer?: boolean;
  options?: readonly string[]; builtin?: boolean; approvalRequired?: boolean;
  scope?: "zone" | "site" | "optional";
};
const OBSERVATION_LABELS: Readonly<Record<string, string>> = {
  "weather.temperature": "Temperature", "weather.warning": "Weather warning",
  "weather.windSpeed": "Wind speed", "weather.lightningDistance": "Lightning distance",
  "weather.heatIndex": "Heat index", "stageSafety.windLimitExceeded": "Stage wind limit exceeded",
  windAndSmokeDirection: "Wind and smoke direction", weatherStatus: "Weather condition",
  timeToDarkness: "Time until darkness", "crowd.densityByZone": "Crowd density",
  "crowd.flowDirection": "Crowd flow direction", barrierStatus: "Barrier condition",
  stageStatus: "Stage operation", alternateGateStatus: "Alternate gate access",
  siteCapacity: "Site capacity", audienceByZone: "Audience counts by zone", gateCounts: "Gate counts",
  incidentLocation: "Incident location", threatLocation: "Threat location",
  structureLocation: "Structure location", threatCredibilityStatus: "Threat credibility",
  "power.primaryStatus": "Primary power", "power.backupStatus": "Backup power",
  lightingStatus: "Lighting", radioNetworkStatus: "Radio network",
  paStatus: "Public address system", cctvStatus: "CCTV",
  gateSystemStatus: "Gate systems", ticketScanStatus: "Ticket scanning",
  hazardSensorStatus: "Hazard sensors", "water.refillStationStatus": "Water refill stations",
  waterSourceStatus: "Water source safety", fireOrGasStatus: "Fire or gas condition",
  structureStatus: "Structure condition", "water.tankLevels": "Water tank level",
  shadeCapacity: "Shade capacity", queueLengthByWaterPoint: "Water point queue length",
  gasIsolationMap: "Gas isolation points", electricalIsolationMap: "Electrical isolation points",
  electricalFeeds: "Electrical supply points", vendorTransactionOrBatchRecords: "Vendor transaction or batch records",
  casualtyEstimate: "Estimated casualties", medicalHeatCases: "Heat-related medical cases",
  illnessCasesByLocation: "Illness cases by location", airQualityStatus: "Air quality",
  medicalReports: "Medical reports", casualtyReports: "Casualty reports",
  symptomsByLocation: "Symptoms by location", symptoms: "Reported symptoms",
  illnessCasesByTime: "Illness case timeline", waterAndFoodReports: "Water and food reports",
  testResults: "Test results", engineerAssessment: "Engineer assessment",
  lawEnforcementGuidance: "Law enforcement guidance", currentRoster: "Current crew roster",
  shelters: "Shelters", approvedExclusionZones: "Approved exclusion zones",
  approvedHoldingAreas: "Approved holding areas", approvedShelterZones: "Approved shelter zones",
  approvedAlternativeWaterSources: "Approved alternative water sources", approvedRoutes: "Approved routes",
  approvedReliefRoutes: "Approved relief routes", approvedEvacuationRoutes: "Approved evacuation routes",
  emergencyAccessRoutes: "Emergency access routes",
};
const definitions: ObservationDefinition[] = [];
const add = (key: string, group: ObservationDefinition["group"], kind: ObservationKind,
  extra: Partial<ObservationDefinition> = {}) => definitions.push({ key, label: OBSERVATION_LABELS[key] ?? key, group, kind, ...extra });
const number = (key: string, group: ObservationDefinition["group"], unit: string, min: number, max: number,
  extra: Partial<ObservationDefinition> = {}) => add(key, group, "number", { unit, min, max, ...extra });
const status = (keys: string[], group: ObservationDefinition["group"], options: readonly string[]) =>
  keys.forEach((key) => add(key, group, "status", { options }));
const text = (keys: string[], group: ObservationDefinition["group"]) => keys.forEach((key) => add(key, group, "text"));

number("weather.temperature", "weather", "°C", -20, 60, { builtin: true });
add("weather.warning", "weather", "status", { builtin: true, options: ["none", "heat", "storm"] });
number("weather.windSpeed", "weather", "km/h", 0, 300);
number("weather.lightningDistance", "weather", "km", 0, 500);
number("weather.heatIndex", "weather", "°C", -20, 80);
add("stageSafety.windLimitExceeded", "weather", "boolean", { scope: "zone" });
status(["windAndSmokeDirection"], "weather", ["N", "NE", "E", "SE", "S", "SW", "W", "NW", "variable"]);
add("weatherStatus", "weather", "status", { builtin: true, options: ["clear", "rain", "storm"] });
number("timeToDarkness", "weather", "minutes", 0, 1440, { integer: true });

number("crowd.densityByZone", "crowd", "people/m²", 0, 12, { scope: "zone" });
status(["crowd.flowDirection"], "crowd", ["inbound", "outbound", "bidirectional", "stationary", "toward_hazard", "away_from_hazard"]);
status(["barrierStatus"], "crowd", ["intact", "damaged", "breached", "collapsed"]);
status(["stageStatus"], "crowd", ["running", "held", "stopped", "closed"]);
status(["alternateGateStatus"], "crowd", ["open", "restricted", "closed", "unsafe"]);
number("siteCapacity", "crowd", "people", 0, 100000, { integer: true, scope: "site" });
add("audienceByZone", "crowd", "zone_counts", { scope: "site", unit: "people" });
add("gateCounts", "crowd", "zone_counts", { unit: "people" });
for (const key of ["incidentLocation", "threatLocation", "structureLocation"]) add(key, "crowd", "location");
status(["threatCredibilityStatus"], "crowd", ["unverified", "credible", "confirmed", "dismissed"]);

status(["power.primaryStatus", "power.backupStatus", "lightingStatus", "radioNetworkStatus", "paStatus", "cctvStatus", "gateSystemStatus", "ticketScanStatus", "hazardSensorStatus"],
  "infrastructure", ["operational", "degraded", "failed", "offline"]);
status(["water.refillStationStatus"], "infrastructure", ["operational", "low_supply", "closed", "unsafe"]);
status(["waterSourceStatus"], "infrastructure", ["potable", "suspected_contamination", "unsafe", "out_of_service"]);
status(["fireOrGasStatus"], "infrastructure", ["none_observed", "suspected_fire", "confirmed_fire", "suspected_gas", "confirmed_gas", "contained"]);
status(["structureStatus"], "infrastructure", ["stable", "damaged", "unstable", "collapsed", "closed"]);
number("water.tankLevels", "infrastructure", "%", 0, 100, { scope: "zone" });
number("shadeCapacity", "infrastructure", "people", 0, 100000, { integer: true, scope: "zone" });
number("queueLengthByWaterPoint", "infrastructure", "people", 0, 100000, { integer: true, scope: "zone" });
for (const key of ["gasIsolationMap", "electricalIsolationMap", "electricalFeeds"])
  add(key, "infrastructure", "locations", { options: ["energized", "isolated", "deenergized", "fault", "unsafe"] });
text(["vendorTransactionOrBatchRecords"], "infrastructure");

number("casualtyEstimate", "medical", "people", 0, 100000, { integer: true });
number("medicalHeatCases", "medical", "cases", 0, 100000, { integer: true, scope: "zone" });
add("illnessCasesByLocation", "medical", "zone_counts", { unit: "cases" });
status(["airQualityStatus"], "medical", ["acceptable", "unhealthy", "hazardous", "alarm"]);
text(["medicalReports", "casualtyReports", "symptomsByLocation", "symptoms", "illnessCasesByTime", "waterAndFoodReports", "testResults"], "medical");

text(["engineerAssessment", "lawEnforcementGuidance"], "approvals");
add("currentRoster", "approvals", "text", { builtin: true });
for (const key of ["shelters", "approvedExclusionZones", "approvedHoldingAreas", "approvedShelterZones", "approvedAlternativeWaterSources"])
  add(key, "approvals", "locations", { approvalRequired: true, options: ["open", "restricted", "closed", "unsafe"] });
for (const key of ["approvedRoutes", "approvedReliefRoutes", "approvedEvacuationRoutes", "emergencyAccessRoutes"])
  add(key, "approvals", "routes", { approvalRequired: true });

export const OBSERVATION_CATALOG: Readonly<Record<string, ObservationDefinition>> = Object.fromEntries(definitions.map((entry) => [entry.key, entry]));
export const OBSERVATION_DEFINITIONS: readonly ObservationDefinition[] = definitions;
export const observationDefinition = (key: string): ObservationDefinition | undefined => OBSERVATION_CATALOG[key];

const ZoneSlug = z.string().trim().min(1).max(80);
const base = z.object({ key: z.string().trim().min(1).max(120), zoneSlug: ZoneSlug.nullable(), minutesAgo: z.number().int().min(0).max(1440) });
const location = z.object({ zoneSlug: ZoneSlug, status: z.string().min(1).max(40),
  capacity: z.number().int().min(0).max(100000).nullable(), approved: z.boolean() });
export const ObservationSchema = z.discriminatedUnion("kind", [
  base.extend({ kind: z.literal("number"), value: z.number().finite().nullable() }),
  base.extend({ kind: z.literal("boolean"), value: z.boolean().nullable() }),
  base.extend({ kind: z.literal("status"), value: z.string().trim().max(80).nullable() }),
  base.extend({ kind: z.literal("text"), value: z.string().trim().max(4000).nullable() }),
  base.extend({ kind: z.literal("location"), value: ZoneSlug.nullable() }),
  base.extend({ kind: z.literal("zone_counts"), value: z.object({ coverage: z.enum(["partial", "all_venue"]),
    entries: z.array(z.object({ zoneSlug: ZoneSlug, count: z.number().int().min(0).max(100000) })).max(100) }).nullable() }),
  base.extend({ kind: z.literal("locations"), value: z.array(location).max(100).nullable() }),
  base.extend({ kind: z.literal("routes"), value: z.array(z.object({ fromZoneSlug: ZoneSlug, toZoneSlug: ZoneSlug,
    status: z.enum(["open", "restricted", "closed"]), approved: z.boolean() })).max(100).nullable() }),
]).superRefine((row, context) => {
  const definition = observationDefinition(row.key);
  const invalid = (message: string) => context.addIssue({ code: "custom", message });
  if (!definition) { invalid(`Unknown observation key ${row.key}`); return; }
  if (definition.builtin) invalid(`${row.key} is supplied by built-in controls or database, not an observation override`);
  if (definition.kind !== row.kind) invalid(`${row.key} requires kind ${definition.kind}`);
  if (definition.scope === "zone" && row.value != null && row.zoneSlug == null) invalid(`${row.key} requires a zone scope`);
  if (definition.scope === "site" && row.zoneSlug != null) invalid(`${row.key} is a site-wide fact`);
  if (row.kind === "number" && row.value != null) {
    if (definition.min != null && row.value < definition.min) invalid(`${row.key} is below ${definition.min} ${definition.unit}`);
    if (definition.max != null && row.value > definition.max) invalid(`${row.key} exceeds ${definition.max} ${definition.unit}`);
    if (definition.integer && !Number.isInteger(row.value)) invalid(`${row.key} requires an integer`);
  }
  if (row.kind === "status" && row.value != null && row.value !== "" && !definition.options?.includes(row.value))
    invalid(`${row.key} has an invalid status`);
  if (row.kind === "locations" && row.value != null)
    for (const entry of row.value)
      if (!definition.options?.includes(entry.status)) invalid(`${row.key} has an invalid location status`);
});
export type MobilizationObservation = z.infer<typeof ObservationSchema>;

/** False/zero are meaningful explicit facts; empty text/collections and null are unknown. */
export function observationIsMeaningful(row: MobilizationObservation): boolean {
  if (row.value == null) return false;
  if (typeof row.value === "string") return row.value.trim().length > 0;
  if (Array.isArray(row.value)) return row.value.length > 0;
  if (row.kind === "zone_counts") return row.value.entries.length > 0;
  return true;
}

export function observationReferenceErrors(rows: readonly MobilizationObservation[], zoneSlugs: readonly string[]): string[] {
  const errors: string[] = [];
  const zones = new Set(zoneSlugs);
  const scopes = new Set<string>();
  const checkZone = (slug: string) => { if (!zones.has(slug)) errors.push(`Unknown observation zone ${slug}`); };
  for (const row of rows) {
    const key = `${row.key}|${row.zoneSlug ?? "site"}`;
    if (scopes.has(key)) errors.push(`Duplicate observation key and scope ${key}`);
    scopes.add(key);
    if (row.zoneSlug != null) checkZone(row.zoneSlug);
    if (row.kind === "location" && row.value != null) checkZone(row.value);
    if (row.kind === "zone_counts" && row.value != null) {
      const seen = new Set<string>();
      for (const entry of row.value.entries) {
        checkZone(entry.zoneSlug);
        if (seen.has(entry.zoneSlug)) errors.push(`Duplicate zone count ${row.key}:${entry.zoneSlug}`);
        seen.add(entry.zoneSlug);
      }
      if (row.value.coverage === "all_venue" && zoneSlugs.some((slug) => !seen.has(slug)))
        errors.push(`${row.key} claims all-venue coverage but omits real venue zones`);
    }
    if (row.kind === "locations" && row.value != null) {
      const seen = new Set<string>();
      for (const entry of row.value) {
        checkZone(entry.zoneSlug);
        if (seen.has(entry.zoneSlug)) errors.push(`Duplicate location ${row.key}:${entry.zoneSlug}`);
        seen.add(entry.zoneSlug);
      }
    }
    if (row.kind === "routes" && row.value != null) {
      const seen = new Set<string>();
      for (const entry of row.value) {
        checkZone(entry.fromZoneSlug); checkZone(entry.toZoneSlug);
        if (entry.fromZoneSlug === entry.toZoneSlug) errors.push(`${row.key} route endpoints must differ`);
        // A directional approval never automatically authorizes travel in the opposite direction.
        const pair = `${entry.fromZoneSlug}|${entry.toZoneSlug}`;
        if (seen.has(pair)) errors.push(`Duplicate approved route ${row.key}:${pair}`);
        seen.add(pair);
      }
    }
  }
  return errors;
}
