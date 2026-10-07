import type { z } from "zod";

import type { PlaybookContentSchema, PlaybookSlug } from "@/lib/mobilization-contracts";

/**
 * A reading that starts a playbook's plan (src/server/triggers.ts). Rules, not AI: the number is the number. `key` is
 * from the observation catalog (src/lib/mobilization-observations.ts); `zoneKinds` limits it to zones of those kinds
 * ("stage" is a performance zone). `overCapacity`: a count per zone over that zone's capacity (zones.capacity).
 */
export type PlaybookTrigger = { key: string; zoneKinds?: string[] } & (
  | { above: number }
  | { atLeast: number }
  | { below: number }
  | { is: (string | boolean)[] }
  | { overCapacity: true }
);

/** The festival's playbooks. The planner reads these; change them here, in code. */
export const FESTIVAL_PLAYBOOKS: (z.input<typeof PlaybookContentSchema> & { triggers: PlaybookTrigger[] })[] = [
  {
    schemaVersion: 1,
    slug: "severe-weather-main-stage",
    title: "Severe Thunderstorm at Main Stage",
    appliesWhen: "A severe thunderstorm warning has been issued and main-stage wind monitoring exceeds structural limits, lightning exposure is present, or site management determines that continued operation creates an immediate weather risk.",
    requiredInputs: [
      "weather.warning",
      "weather.windSpeed",
      "weather.lightningDistance",
      "stageSafety.windLimitExceeded",
      "audienceByZone",
      "shelters",
      "approvedRoutes",
      "currentRoster"
    ],
    decisionPoints: [
      {
        id: "stage-hold",
        owner: "mo",
        question: "Should the main stage enter hold or shutdown?"
      },
      {
        id: "shelter-vs-evacuate",
        owner: "mo",
        question: "Should affected zones shelter in place, move to approved shelters, or begin controlled evacuation?"
      },
      {
        id: "capacity-gap",
        owner: "mo",
        question: "If designated shelter capacity is insufficient, which approved overflow or dispersal plan should be used?"
      }
    ],
    constraints: [
      {
        id: "no-unknown-assembly-area",
        instruction: "Only direct people to shelters, assembly areas, or dispersal zones already approved in site data."
      },
      {
        id: "no-fabricated-capacity",
        instruction: "Do not claim that shelter capacity is sufficient unless confirmed by current capacity data."
      },
      {
        id: "no-auto-dispatch",
        instruction: "All mobilization actions must wait for MO approval."
      },
      {
        id: "no-conflicting-public-messages",
        instruction: "All public instructions must use the latest MO-approved movement plan."
      }
    ],
    actions: [
      {
        id: "restrict-stage-entry",
        requirement: "must",
        teamSlug: "crowd",
        title: "Stop new entry to the main-stage audience zone",
        instructions: "Freeze inflow, preserve emergency lanes, and meter all outward movement using approved crowd routes.",
        peopleNeeded: null
      },
      {
        id: "stage-safe-state",
        requirement: "must",
        teamSlug: "ops",
        title: "Put the main stage and exposed infrastructure into a safe state",
        instructions: "Follow approved stage, electrical, rigging, and temporary-structure weather procedures.",
        peopleNeeded: null
      },
      {
        id: "performer-comms",
        requirement: "must",
        teamSlug: "artist",
        title: "Notify performers and backstage teams",
        instructions: "Communicate the MO-approved show status, backstage movement restrictions, and restart conditions.",
        peopleNeeded: 2
      },
      {
        id: "medical-readiness",
        requirement: "must",
        teamSlug: "first-aid",
        title: "Pre-position medical resources around the main-stage zone",
        instructions: "Prepare for slips, trauma, panic reactions, lightning exposure, and weather-related illness.",
        peopleNeeded: null
      },
      {
        id: "shelter-guidance",
        requirement: "must",
        teamSlug: "info",
        title: "Direct patrons to confirmed safe locations",
        instructions: "Communicate only approved shelters, overflow areas, route status, and verified capacity information.",
        peopleNeeded: null
      },
      {
        id: "vulnerable-patron-support",
        requirement: "must",
        teamSlug: "welfare",
        title: "Assist children, disabled patrons, and other vulnerable attendees",
        instructions: "Prioritize safe movement, reunification support, and continuity of care during relocation.",
        peopleNeeded: null
      },
      {
        id: "route-security",
        requirement: "must",
        teamSlug: "security",
        title: "Secure evacuation and emergency-service routes",
        instructions: "Keep approved routes clear, prevent entry into unsafe zones, and coordinate with external emergency services.",
        peopleNeeded: null
      },
      {
        id: "vendor-weather-shutdown",
        requirement: "must",
        teamSlug: "vendors",
        title: "Secure vendor operations exposed to severe weather",
        instructions: "Follow approved procedures for gas, electrical equipment, awnings, loose objects, and temporary structures.",
        peopleNeeded: null
      }
    ],
    triggers: [
      { key: "weather.warning", is: ["storm"] },
      { key: "stageSafety.windLimitExceeded", is: [true] },
      { key: "weather.windSpeed", above: 60, zoneKinds: ["stage"] },
      { key: "weather.lightningDistance", below: 10 }
    ],
    source: "festival.ts"
  },
  {
    schemaVersion: 1,
    slug: "crowd-crush-main-stage",
    title: "Crowd Surge and Crushing at Main Stage",
    appliesWhen: "Crowd density, barrier pressure, repeated falls, distress signals, or medical extractions indicate a developing crush, crowd collapse, or dangerous compression in a performance zone.",
    requiredInputs: [
      "crowd.densityByZone",
      "crowd.flowDirection",
      "barrierStatus",
      "medicalReports",
      "audienceByZone",
      "approvedReliefRoutes",
      "stageStatus",
      "currentRoster"
    ],
    decisionPoints: [
      {
        id: "performance-hold",
        owner: "mo",
        question: "Should the performance be paused or stopped to reduce crowd pressure?"
      },
      {
        id: "pressure-release",
        owner: "mo",
        question: "Which approved crowd-pressure release route or zone should be activated?"
      },
      {
        id: "mass-casualty-escalation",
        owner: "mo",
        question: "Should the incident be escalated to the mass-casualty response plan?"
      }
    ],
    constraints: [
      {
        id: "no-new-inflow",
        instruction: "Do not permit additional inflow into the affected crowd zone until MO clears it."
      },
      {
        id: "no-conflicting-flow",
        instruction: "Crowd teams must not issue opposing movement instructions from different access points."
      },
      {
        id: "preserve-medical-corridor",
        instruction: "At least one approved emergency extraction route must remain clear."
      },
      {
        id: "no-auto-dispatch",
        instruction: "All mobilization actions must wait for MO approval."
      }
    ],
    actions: [
      {
        id: "freeze-inflow",
        requirement: "must",
        teamSlug: "crowd",
        title: "Freeze inflow and reduce local crowd pressure",
        instructions: "Stop new entry, open approved pressure-release paths, and create space around fallen or distressed patrons.",
        peopleNeeded: null
      },
      {
        id: "secure-extraction-corridor",
        requirement: "must",
        teamSlug: "security",
        title: "Establish a protected medical extraction corridor",
        instructions: "Keep the route clear, control crossing traffic, and support emergency-service access.",
        peopleNeeded: null
      },
      {
        id: "triage-and-extract",
        requirement: "must",
        teamSlug: "first-aid",
        title: "Begin rapid triage and casualty extraction",
        instructions: "Prioritize airway compromise, crush injury, unconscious patients, and those unable to self-evacuate.",
        peopleNeeded: null
      },
      {
        id: "stage-crowd-message",
        requirement: "must",
        teamSlug: "artist",
        title: "Coordinate performer and stage messaging",
        instructions: "If approved by MO, have stage personnel deliver concise instructions to stop pushing, create space, or move back.",
        peopleNeeded: 2
      },
      {
        id: "public-direction",
        requirement: "must",
        teamSlug: "info",
        title: "Issue unified crowd-movement instructions",
        instructions: "Repeat only MO-approved directions and avoid unverified casualty information.",
        peopleNeeded: null
      },
      {
        id: "vulnerable-and-separated",
        requirement: "must",
        teamSlug: "welfare",
        title: "Support separated families and vulnerable patrons",
        instructions: "Receive displaced children, assist distressed attendees, and coordinate reunification away from the pressure zone.",
        peopleNeeded: null
      },
      {
        id: "barrier-and-lighting",
        requirement: "must",
        teamSlug: "ops",
        title: "Inspect barriers, access lanes, and lighting",
        instructions: "Stabilize infrastructure and improve visibility without obstructing evacuation or medical movement.",
        peopleNeeded: null
      },
      {
        id: "suspend-nearby-service",
        requirement: "must",
        teamSlug: "vendors",
        title: "Suspend service adjacent to relief routes",
        instructions: "Close queues and remove movable obstructions from designated crowd-release and emergency corridors.",
        peopleNeeded: null
      }
    ],
    triggers: [
      { key: "crowd.densityByZone", atLeast: 4, zoneKinds: ["stage"] },
      { key: "barrierStatus", is: ["breached", "collapsed"] }
    ],
    source: "festival.ts"
  },
  {
    schemaVersion: 1,
    slug: "extreme-heat-water-shortage",
    title: "Extreme Heat with Water-System Shortage",
    appliesWhen: "Heat conditions exceed the event heat-response threshold and potable-water availability, refill throughput, shade capacity, or medical demand indicates a rising risk of mass heat illness.",
    requiredInputs: [
      "weather.temperature",
      "weather.heatIndex",
      "water.tankLevels",
      "water.refillStationStatus",
      "shadeCapacity",
      "queueLengthByWaterPoint",
      "medicalHeatCases",
      "audienceByZone",
      "currentRoster"
    ],
    decisionPoints: [
      {
        id: "program-reduction",
        owner: "mo",
        question: "Should performances, high-density activities, or operating hours be reduced or paused?"
      },
      {
        id: "water-redistribution",
        owner: "mo",
        question: "Which approved water stocks or refill assets should be redistributed?"
      },
      {
        id: "cooling-zone-expansion",
        owner: "mo",
        question: "Which approved spaces should be converted or expanded for cooling and welfare use?"
      }
    ],
    constraints: [
      {
        id: "potable-water-priority",
        instruction: "Potable water availability must not be reduced for non-safety operational reasons."
      },
      {
        id: "no-unverified-water-source",
        instruction: "Do not distribute water from a source that is not approved as potable."
      },
      {
        id: "no-unsafe-queue",
        instruction: "Water queues must not block emergency routes or create dangerous crowd compression."
      },
      {
        id: "no-auto-dispatch",
        instruction: "All mobilization actions must wait for MO approval."
      }
    ],
    actions: [
      {
        id: "heat-triage",
        requirement: "must",
        teamSlug: "first-aid",
        title: "Expand heat-illness triage and treatment",
        instructions: "Prioritize altered mental status, collapse, severe dehydration, and suspected heat stroke.",
        peopleNeeded: null
      },
      {
        id: "cooling-welfare",
        requirement: "must",
        teamSlug: "welfare",
        title: "Expand cooling and vulnerable-patron support",
        instructions: "Prioritize children, disabled patrons, older attendees, and anyone unable to tolerate heat exposure.",
        peopleNeeded: null
      },
      {
        id: "water-logistics",
        requirement: "must",
        teamSlug: "ops",
        title: "Reallocate potable water and cooling infrastructure",
        instructions: "Move approved water assets, refill capacity, shade, misting, or cooling equipment to highest-risk zones.",
        peopleNeeded: null
      },
      {
        id: "water-queue-control",
        requirement: "must",
        teamSlug: "crowd",
        title: "Control queues at water and cooling points",
        instructions: "Prevent crowd compression, keep emergency lanes open, and spread demand across approved locations.",
        peopleNeeded: null
      },
      {
        id: "hydration-messaging",
        requirement: "must",
        teamSlug: "info",
        title: "Issue heat and hydration guidance",
        instructions: "Publish verified water locations, cooling areas, symptoms requiring medical help, and any program changes.",
        peopleNeeded: null
      },
      {
        id: "protect-water-assets",
        requirement: "must",
        teamSlug: "security",
        title: "Protect water deliveries and critical cooling areas",
        instructions: "Keep delivery routes open and prevent conflict or unsafe crowding around limited resources.",
        peopleNeeded: null
      },
      {
        id: "vendor-water-support",
        requirement: "must",
        teamSlug: "vendors",
        title: "Support emergency potable-water distribution",
        instructions: "Redirect approved sealed water and cold non-alcoholic beverages where instructed and maintain food cold-chain controls.",
        peopleNeeded: null
      },
      {
        id: "artist-schedule-adjustment",
        requirement: "must",
        teamSlug: "artist",
        title: "Implement heat-related schedule changes",
        instructions: "Communicate delayed, shortened, or paused performances and backstage heat precautions approved by MO.",
        peopleNeeded: 2
      }
    ],
    triggers: [
      { key: "weather.heatIndex", atLeast: 40 },
      { key: "water.tankLevels", below: 20 }
    ],
    source: "festival.ts"
  },
  {
    schemaVersion: 1,
    slug: "gate-breach-uncontrolled-ingress",
    title: "Gate Breach and Uncontrolled Ingress",
    appliesWhen: "An entry barrier, scanning process, or security line fails and a large number of people begin entering without normal control, creating a risk of overcapacity, crushing, or loss of site accountability.",
    requiredInputs: [
      "gateCounts",
      "ticketScanStatus",
      "barrierStatus",
      "siteCapacity",
      "audienceByZone",
      "alternateGateStatus",
      "approvedHoldingAreas",
      "currentRoster"
    ],
    decisionPoints: [
      {
        id: "gate-closure",
        owner: "mo",
        question: "Should the affected gate be fully closed, restricted, or converted to controlled exit only?"
      },
      {
        id: "alternate-entry",
        owner: "mo",
        question: "Which alternate approved gate or holding area should receive diverted arrivals?"
      },
      {
        id: "capacity-response",
        owner: "mo",
        question: "Is site or zone capacity uncertain enough to require entry suspension or program hold?"
      }
    ],
    constraints: [
      {
        id: "no-compression",
        instruction: "Do not create a hard stop that traps a moving crowd against barriers without a pressure-release plan."
      },
      {
        id: "no-unapproved-holding-area",
        instruction: "Divert arrivals only to approved holding or queuing areas."
      },
      {
        id: "no-hostile-assumption",
        instruction: "Do not treat all uncontrolled entrants as hostile; use proportional crowd and security procedures."
      },
      {
        id: "no-auto-dispatch",
        instruction: "All mobilization actions must wait for MO approval."
      }
    ],
    actions: [
      {
        id: "stop-and-meter-entry",
        requirement: "must",
        teamSlug: "crowd",
        title: "Stop uncontrolled inflow and establish metered entry",
        instructions: "Create safe pressure relief, redirect new arrivals, and maintain emergency exits and pedestrian routes.",
        peopleNeeded: null
      },
      {
        id: "secure-breach",
        requirement: "must",
        teamSlug: "security",
        title: "Secure the breached gate and adjacent perimeter",
        instructions: "Protect staff, prevent secondary breaches, and coordinate with police if required.",
        peopleNeeded: null
      },
      {
        id: "redirect-arrivals",
        requirement: "must",
        teamSlug: "info",
        title: "Redirect arriving patrons",
        instructions: "Publish approved alternate gates, expected delays, and entry suspension information without encouraging convergence.",
        peopleNeeded: null
      },
      {
        id: "restore-entry-systems",
        requirement: "must",
        teamSlug: "ops",
        title: "Repair or replace failed barriers and access systems",
        instructions: "Restore scanning, fencing, lighting, power, or temporary infrastructure using approved procedures.",
        peopleNeeded: null
      },
      {
        id: "gate-medical-post",
        requirement: "must",
        teamSlug: "first-aid",
        title: "Position medical support at crowd-pressure points",
        instructions: "Prepare for falls, crush injury, heat illness, panic, and access problems near affected gates.",
        peopleNeeded: null
      },
      {
        id: "separated-party-support",
        requirement: "must",
        teamSlug: "welfare",
        title: "Support separated families and vulnerable arrivals",
        instructions: "Provide a controlled location for lost children, separated groups, and patrons unable to remain in queues.",
        peopleNeeded: null
      },
      {
        id: "clear-vendor-obstructions",
        requirement: "must",
        teamSlug: "vendors",
        title: "Clear nearby queues and movable vendor obstructions",
        instructions: "Reduce competing foot traffic around the breached gate and alternate access routes.",
        peopleNeeded: null
      },
      {
        id: "program-hold-if-needed",
        requirement: "must",
        teamSlug: "artist",
        title: "Prepare for performance holds if capacity is uncertain",
        instructions: "Keep stages ready to pause if crowd distribution or total attendance cannot be safely verified.",
        peopleNeeded: 2
      }
    ],
    triggers: [
      { key: "gateSystemStatus", is: ["failed"] },
      { key: "ticketScanStatus", is: ["failed"] },
      { key: "gateCounts", overCapacity: true, zoneKinds: ["gate"] }
    ],
    source: "festival.ts"
  }
];

/** What Mo reads as a plan's title, before the place: "Severe storm, Oval Stage". */
export const PLAYBOOK_NAMES: Record<PlaybookSlug, string> = {
  "severe-weather-main-stage": "Severe storm",
  "crowd-crush-main-stage": "Crowd surge",
  "extreme-heat-water-shortage": "Extreme heat",
  "gate-breach-uncontrolled-ingress": "Gate breach",
};
