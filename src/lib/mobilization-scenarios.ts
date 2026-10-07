import type { SimulationContext, SimulationInput, VenueZone } from "./mobilization-contracts";
import type { MobilizationObservation } from "./mobilization-observations";

/** Hypothetical observations, not SOP thresholds, response plans, or approval records. */
export const MOBILIZATION_SCENARIOS = [
  { id: "normal", title: "Normal operations", summary: "A calm local sample with working services. Check that the analysis does not invent an emergency.", playbookSlugs: [] },
  { id: "heat-water", title: "Heat + water shortage", summary: "Extreme heat, low water supply, long refill queues, and rising heat illness.", playbookSlugs: ["extreme-heat-water-shortage"] },
  { id: "storm", title: "Severe thunderstorm", summary: "A storm warning, nearby lightning, and a reported stage wind-limit exceedance.", playbookSlugs: ["severe-weather-main-stage"] },
  { id: "crowd-surge", title: "Crowd surge", summary: "High local density, damaged barriers, and repeated falls at a running stage.", playbookSlugs: ["crowd-crush-main-stage"] },
  { id: "vendor-fire", title: "Vendor fire", summary: "Visible fire and spreading smoke near a food service area; utility isolation is unconfirmed.", playbookSlugs: ["vendor-fire-gas-hazard"] },
  { id: "gate-breach", title: "Gate breach", summary: "A breached entry barrier and failed ticket scanning allow uncontrolled inflow.", playbookSlugs: ["gate-breach-uncontrolled-ingress"] },
  { id: "structure-failure", title: "Structure failure", summary: "Falling components and an unstable temporary structure, with injuries reported.", playbookSlugs: ["temporary-structure-failure"] },
  { id: "power-comms", title: "Power + communications", summary: "Primary power and radio failures, degraded backup, and little daylight remaining.", playbookSlugs: ["site-wide-power-comms-failure"] },
  { id: "contamination", title: "Suspected contamination", summary: "Similar illness reports cluster around a water point; the source and test results are unknown.", playbookSlugs: ["suspected-food-water-contamination"] },
  { id: "security-threat", title: "Credible security threat", summary: "Security flags a credible threat near an entrance; police guidance and movement approvals are unknown.", playbookSlugs: ["credible-security-threat"] },
] as const;

export type MobilizationScenarioId = (typeof MOBILIZATION_SCENARIOS)[number]["id"];
export type ScenarioFacts = Omit<SimulationInput, "requestId" | "observations"> & {
  observations: MobilizationObservation[];
};
export type BuiltMobilizationScenario = {
  input: ScenarioFacts;
  summary: string;
  missingContext: string[];
};

/** Prefer a known venue location only when it has the required kind; never invent a zone or capacity. */
function findZone(context: SimulationContext, kind: string, preferred: string): VenueZone | undefined {
  const matches = context.zones.filter((zone) => zone.kind === kind);
  return matches.find((zone) => zone.slug === preferred) ??
    [...matches].sort((a, b) => a.slug.localeCompare(b.slug))[0];
}

/** These fractions select illustrative crowd samples; they are not event operating limits. */
function sampledCount(zone: VenueZone | undefined, fraction: number): number | null {
  if (zone?.capacity == null || !Number.isFinite(zone.capacity) || zone.capacity < 0) return null;
  return Math.min(100000, Math.round(zone.capacity * fraction));
}

/** Replaces all scenario controls with fresh facts; database roster and existing responses stay database-owned. */
export function buildScenario(id: MobilizationScenarioId, context: SimulationContext): BuiltMobilizationScenario {
  const definition = MOBILIZATION_SCENARIOS.find((scenario) => scenario.id === id);
  if (!definition) throw new Error(`Unknown situation preset: ${id}`);
  const input: ScenarioFacts = {
    weather: { temperatureC: 28, trendCPerHour: null, condition: "clear", warning: "none", warningInMinutes: null },
    upcomingSets: [], crowdByZone: [], recentIncidents: [], observations: [],
  };
  const missingContext: string[] = [];
  const zone = (kind: string, preferred: string) => {
    const found = findZone(context, kind, preferred);
    if (!found) missingContext.push(`No ${kind} zone is configured; its location and scoped readings remain unknown.`);
    return found;
  };
  const observe = (row: MobilizationObservation) => input.observations.push(row);
  const number = (key: string, value: number | null, at?: VenueZone, needsZone = false) =>
    observe({ key, kind: "number", value: needsZone && !at ? null : value, zoneSlug: at?.slug ?? null, minutesAgo: 2 });
  const status = (key: string, value: string | null, at?: VenueZone) =>
    observe({ key, kind: "status", value, zoneSlug: at?.slug ?? null, minutesAgo: 2 });
  const text = (key: string, value: string | null, at?: VenueZone) =>
    observe({ key, kind: "text", value, zoneSlug: at?.slug ?? null, minutesAgo: 2 });
  const location = (key: string, at?: VenueZone) =>
    observe({ key, kind: "location", value: at?.slug ?? null, zoneSlug: null, minutesAgo: 2 });
  const unknownLocations = (...keys: string[]) => {
    for (const key of keys) observe({ key, kind: "locations", value: null, zoneSlug: null, minutesAgo: 0 });
  };
  const unknownRoutes = (...keys: string[]) => {
    for (const key of keys) observe({ key, kind: "routes", value: null, zoneSlug: null, minutesAgo: 0 });
  };
  const crowd = (at: VenueZone | undefined, fraction: number, trend: "stable" | "growing" = "stable", measuredPeople?: number) => {
    // An explicit hypothetical count is a local sample; it does not assert a zone's unknown capacity.
    const count = measuredPeople ?? sampledCount(at, fraction);
    if (!at) return;
    input.crowdByZone.push({ zoneSlug: at.slug, estimatedPeople: count, trend });
    observe({ key: "audienceByZone", kind: "zone_counts", zoneSlug: null, minutesAgo: 2,
      value: count == null ? null : { coverage: "partial", entries: [{ zoneSlug: at.slug, count }] } });
    if (count == null) missingContext.push(`${at.name} capacity is unknown; no audience estimate has been manufactured.`);
  };
  const incident = (category: SimulationInput["recentIncidents"][number]["category"], at: VenueZone | undefined,
    count: number, description: string) => input.recentIncidents.push({ category, zoneSlug: at?.slug ?? null,
    minutesAgo: 5, count, openCount: count, description });
  const set = (at: VenueZone | undefined, fraction: number, startsInMinutes = 10) => {
    const knownAct = [...context.timetable].filter((entry) => entry.stageSlug === at?.slug)
      .sort((a, b) => a.id.localeCompare(b.id))[0]?.act;
    if (at) input.upcomingSets.push({ stageSlug: at.slug, act: knownAct ?? "Simulated next performance", startsInMinutes,
      durationMinutes: 45, expectedPeople: sampledCount(at, fraction) });
  };
  const nextSets = (first: VenueZone | undefined, startsInMinutes: number) => {
    const stages = context.zones.filter((entry) => entry.kind === "stage" && entry.slug !== first?.slug)
      .sort((a, b) => a.slug.localeCompare(b.slug));
    const selected = first ? [first, ...stages].slice(0, 2) : stages.slice(0, 2);
    selected.forEach((stage, index) => set(stage, index === 0 ? 0.85 : 0.65, startsInMinutes + index * 5));
  };

  switch (id) {
    case "normal": {
      const stage = zone("stage", "lawn-stage");
      crowd(stage, 0.25);
      status("stageStatus", "running", stage);
      status("barrierStatus", "intact", stage);
      status("fireOrGasStatus", "none_observed", stage);
      for (const key of ["power.primaryStatus", "power.backupStatus", "lightingStatus", "radioNetworkStatus", "paStatus"])
        status(key, "operational");
      status("waterSourceStatus", "potable");
      status("water.refillStationStatus", "operational");
      number("casualtyEstimate", 0, stage);
      break;
    }
    case "heat-water": {
      const water = zone("water", "water-2");
      input.weather = { temperatureC: 41, trendCPerHour: 2, condition: "clear", warning: "heat", warningInMinutes: 0 };
      number("weather.heatIndex", 47);
      number("water.tankLevels", 8, water, true);
      number("shadeCapacity", 70, water, true);
      number("queueLengthByWaterPoint", 160, water, true);
      number("medicalHeatCases", 18, water, true);
      status("water.refillStationStatus", "low_supply", water);
      text("medicalReports", "18 visitors show heat-illness symptoms in the past 15 minutes; two have collapsed.", water);
      crowd(water, 0.85, "growing", 220);
      nextSets(findZone(context, "stage", "lawn-stage"), 20);
      incident("heat", water, 18, "Repeated dizziness and collapse near the refill queue; only a small water supply remains.");
      unknownLocations("approvedAlternativeWaterSources");
      break;
    }
    case "storm": {
      const stage = zone("stage", "lawn-stage");
      input.weather = { temperatureC: 29, trendCPerHour: null, condition: "storm", warning: "storm", warningInMinutes: 0 };
      number("weather.windSpeed", 82);
      number("weather.lightningDistance", 3);
      observe({ key: "stageSafety.windLimitExceeded", kind: "boolean", value: stage ? true : null,
        zoneSlug: stage?.slug ?? null, minutesAgo: 2 });
      status("stageStatus", "running", stage);
      crowd(stage, 0.8);
      set(stage, 0.9);
      incident("weather", stage, 2, "Stage monitoring reports a wind-limit exceedance and lightning close to the open-air audience zone.");
      unknownLocations("shelters");
      unknownRoutes("approvedRoutes");
      break;
    }
    case "crowd-surge": {
      const stage = zone("stage", "lawn-stage");
      crowd(stage, 0.95, "growing");
      number("crowd.densityByZone", 5.5, stage, true);
      status("crowd.flowDirection", "inbound", stage);
      status("barrierStatus", "damaged", stage);
      status("stageStatus", "running", stage);
      nextSets(stage, 5);
      text("medicalReports", "Six people have fallen near the front barrier; two require medical extraction. The number still at risk is unknown.", stage);
      incident("crowding", stage, 6, "Stewards report repeated falls and compression at the front barrier while inflow continues.");
      unknownRoutes("approvedReliefRoutes", "emergencyAccessRoutes");
      break;
    }
    case "vendor-fire": {
      const food = zone("food", "food-alley");
      location("incidentLocation", food);
      status("fireOrGasStatus", "confirmed_fire", food);
      status("windAndSmokeDirection", "E");
      status("airQualityStatus", "unhealthy", food);
      text("medicalReports", "Two visitors report smoke irritation; the extent of burns or other injuries is unknown.", food);
      crowd(food, 0.65);
      incident("facilities", food, 2, "Visible flames at a vendor cooking area and smoke spreading into the nearby queue; isolation status is unconfirmed.");
      unknownLocations("gasIsolationMap", "electricalIsolationMap", "approvedExclusionZones");
      unknownRoutes("approvedRoutes");
      break;
    }
    case "gate-breach": {
      const gate = zone("gate", "gate-a");
      location("incidentLocation", gate);
      status("ticketScanStatus", "failed", gate);
      status("barrierStatus", "breached", gate);
      status("alternateGateStatus", null);
      status("crowd.flowDirection", "inbound", gate);
      number("siteCapacity", null);
      crowd(gate, 0.9, "growing");
      observe({ key: "gateCounts", kind: "zone_counts", zoneSlug: null, minutesAgo: 2,
        value: gate ? { coverage: "partial", entries: [{ zoneSlug: gate.slug, count: 450 }] } : null });
      incident("crowding", gate, 3, "Stewards count roughly 450 uncontrolled arrivals after an entry barrier gives way; current total site attendance is unknown.");
      unknownLocations("approvedHoldingAreas");
      break;
    }
    case "structure-failure": {
      const stage = zone("stage", "lawn-stage");
      location("structureLocation", stage);
      status("structureStatus", "unstable", stage);
      text("engineerAssessment", null);
      text("casualtyReports", "Two injuries reported after falling roof components; no competent engineering assessment is available yet.", stage);
      number("casualtyEstimate", 2, stage);
      crowd(stage, 0.7);
      incident("facilities", stage, 3, "Roof components have fallen from a temporary stage structure, and further movement is visible.");
      unknownLocations("electricalFeeds", "approvedExclusionZones");
      unknownRoutes("approvedRoutes");
      break;
    }
    case "power-comms": {
      const stage = zone("stage", "lawn-stage");
      status("power.primaryStatus", "failed");
      status("power.backupStatus", "degraded");
      status("lightingStatus", "failed");
      status("radioNetworkStatus", "failed");
      status("paStatus", "offline");
      status("cctvStatus", "offline");
      status("gateSystemStatus", "degraded");
      number("timeToDarkness", 25);
      crowd(stage, 0.65);
      incident("technical", stage, 3, "Site technicians report loss of primary supply and radio coverage across major areas; backup supports only limited services.");
      unknownRoutes("approvedRoutes");
      break;
    }
    case "contamination": {
      const water = zone("water", "water-2");
      status("waterSourceStatus", "suspected_contamination", water);
      text("illnessCasesByTime", "12 reports of vomiting and abdominal cramps arrived within the past 20 minutes.");
      text("symptoms", "Vomiting and abdominal cramps; severity and any common cause are not confirmed.");
      text("vendorTransactionOrBatchRecords", null);
      text("testResults", null);
      observe({ key: "illnessCasesByLocation", kind: "zone_counts", zoneSlug: null, minutesAgo: 2,
        value: water ? { coverage: "partial", entries: [{ zoneSlug: water.slug, count: 12 }] } : null });
      crowd(water, 0.55);
      incident("medical", water, 12, "Similar gastrointestinal symptoms are reported near one water point; proximity does not establish the source.");
      unknownLocations("approvedAlternativeWaterSources");
      break;
    }
    case "security-threat": {
      const gate = zone("gate", "gate-a");
      location("threatLocation", gate);
      status("threatCredibilityStatus", "credible", gate);
      text("lawEnforcementGuidance", null);
      status("cctvStatus", "degraded", gate);
      const stage = findZone(context, "stage", "lawn-stage");
      status("stageStatus", stage ? "running" : null, stage);
      crowd(gate, 0.65);
      incident("security", gate, 2, "Security supervisors classify matched reports of an unattended item as a credible threat; its contents and police instructions remain unknown.");
      unknownLocations("approvedShelterZones");
      unknownRoutes("approvedEvacuationRoutes");
      break;
    }
  }
  return { input, summary: definition.summary, missingContext };
}
