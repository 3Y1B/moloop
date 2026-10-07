# Mobilization: plan

## What it is (Chien)

Mobilization is for the rare, serious situations (a storm, food contamination, a crowd surge) that need several
teams at once. A severe thunderstorm at the main stage, for example:

- **crowd** controls movement around the main stage and stops further entry
- **ops** manages the stage, power and exposed equipment
- **artist** coordinates the performance shutdown and backstage
- **info** announces evacuation and shelter instructions
- **security** protects evacuation routes and emergency access
- **first-aid** prepares for injuries
- **welfare** supports children, people with disabilities and other vulnerable people
- **vendors** shut off gas, electrics and exposed stalls

Mo doesn't brief everyone one by one. He approves one plan, and the system sends the nearest suitable volunteers and a
lead to every task.

The playbooks are written before the festival, calmly, not mid-crisis: what "severe storm, open-air stage" means for
every team. When live conditions match, the system reads the live data (weather, recent reports, who's on duty and
where) against that playbook and drafts one plan: which teams, how many people, doing what, and why. Every line
cites the reading or report behind it. A second check, plain rules rather than AI, rejects any plan that cites a fact
that isn't there or drops a required step, before Mo sees it. Once Mo approves, the tasks go straight to phones.

The map can't produce a situation big enough for this, so the demo sets one up and simulates it. Hardware readings
(stage wind sensor, gate counters) are simulated too, until real hardware is connected.

## Where it stands (8 October)

- Kept: the planner (`src/server/predict/`), the rules check (`validate.ts`, `action-output.ts`), approval,
  idempotency and Mo-only access.
- Removed: "Test situation" (it created real plans from a form nobody sees on the day) and the playbook editor.
- Playbooks: `src/server/playbooks/festival.ts`, four of them: storm, crowd surge, heat, gate breach.
- **Nothing starts the planner.** This plan adds the triggers.
- Not covered here: incident playbooks for a single incident (lost child, medical). They are a different, smaller
  thing: `2026-10-08-incident-playbooks-plan.md`.

## Triggers

No agent running in the background trying to predict. The planner only runs when something real arrives: a report or
a reading. Whatever triggers it, the result is the same: a plan for Mo to approve.

| # | Trigger | When it fires | Decided by |
|---|---|---|---|
| T1 | **A serious report** | Intake reads a report and names a playbook ("kids getting crushed at the barrier" → crowd surge) | The intake AI, one more field on the read it already does |
| T2 | **Reports adding up** | A new report makes 3+ in one zone within 10 minutes, with no plan already running there | One AI call over those reports: does a playbook apply? |
| T3 | **A reading crosses a line** | A sensor reading meets a playbook's trigger (wind over the stage's limit, a gate counter over capacity) | Rules: the number is the number |
| T4 | **Mo says so** | Mo reports "storm coming at the main stage" | Same path as T1. Mo doesn't need a button for this |

Rules for all of them:

- **One plan per playbook and zone.** If one is already pending or running, a new trigger adds its report or reading
  to that plan's evidence instead of starting another.
- **Dismissed means quiet.** After Mo dismisses a plan, the same playbook and zone doesn't come back for 15 minutes,
  unless a P1 report names it.
- **The planner gets one playbook, not all of them.** The trigger already knows which one applies. That's what made
  the old run take 70 seconds (it read all 10). Target: under 20 seconds.

### Readings (T3)

- New table `readings`: `key` (from the existing observation catalog, `mobilization-observations.ts`), `zone_id`,
  `value`, `observed_at`, `source` (`sensor` or `simulated`).
- `POST /api/reading` writes one: for hardware later, and for the demo simulator now. Server key only, not the app.
- Each playbook gets a `triggers` list next to its actions, checked on every new reading:

| Playbook | Fires when (numbers to confirm) |
|---|---|
| Storm | `weather.warning` is severe, or `stageSafety.windLimitExceeded`, or `weather.lightningDistance` < 10 km |
| Crowd surge | `crowd.densityByZone` ≥ 4 people/m² in a performance zone, or `barrierStatus` failed |
| Heat | `weather.heatIndex` ≥ 40, or `water.tankLevels` < 20% at any station |
| Gate breach | `gateSystemStatus` or `ticketScanStatus` failed, or `gateCounts` over the gate's capacity |

- The plan's evidence includes the latest readings from the last 30 minutes, not just the one that fired.

### The demo

The demo-day simulator (PLAN-LIVE phase 8) already drives simulated people. It also writes readings and reports on a
script: wind rising at the main stage, then two crowd reports, then the wind limit. Mo's phone shows the suggestion
on camera, with no "Test situation" button in the app. Simulated readings are stored as `source: simulated`.

## Mo's review: one screen, short

Replace the 24,000-character review with:

- **Title and why:** "Severe storm, Main Stage", then one line per thing that triggered it, in plain words: "Wind
  72 km/h at the stage (limit 60), 2 min ago", "3 crowd reports at the barrier in 8 min".
- **Tasks:** one row each: team colour, what, how many, from where. Tap to expand the instructions.
- **Shortfall:** one line if there aren't enough free people: "2 short. Will keep trying." No checkbox.
- **Approve** and **Dismiss**. Nothing else on the first screen.

Crew asked for is capped at the free people on that team. Volunteers and Mo never see ids, "Sources: …", raw JSON or
ISO times. Places use the app's names (VIP Gate, not "Gate A").

## After approval

- Each task is an ordinary task through the ordinary picker (`src/server/pick.ts`): nearest suitable people plus that
  team's lead.
- An unstaffed task goes through the normal auto-assign and keeps retrying as people free up (audit S1, D4).
- A helper can't mark the task done before accepting, and only while it's active (audit D2).
- The owner declining promotes an accepted helper, or re-dispatches (audit D3).
- Stand down cancels the plan's open tasks and frees their people (audit D6).
- The plan shows as a group header over its tasks in Team, not a separate kind of row.

## Changes

- `src/server/playbooks/festival.ts`: a `triggers` list per playbook.
- `src/server/models/intake-tools.ts`, `interpreter.ts`: a `playbook` field on the read (one of the four, or none).
- `src/server/triggers.ts` (new): `onReport(task)` for T1, T2 and T4; `onReading(reading)` for T3; dedupe and
  cool-down.
- `src/server/predict/simulation.ts` → `plan.ts`: `planMobilization(playbook, zone, cause)` builds its input from the
  database (readings, reports, roster) instead of a form; one playbook.
- `src/server/http/readings.ts` (new), migration for `readings` and `mobilizations.dismissed_at`.
- `src/app/mobilize/[id].tsx`: the short review above.
- `src/lib/commands.ts`, `lifecycle.ts`: the audit fixes listed under "After approval".
- `scripts/simulate.ts` (phase 8): readings and reports on a script.

## Tests

- A report the intake reads as crowd surge creates one pending plan. A second one adds evidence, not a second plan.
- 3 reports in one zone in 10 minutes ask once. 2 don't, and 3 spread over 30 minutes don't.
- A wind reading over the limit creates a storm plan. One under it doesn't. A stale reading (> 30 min) doesn't.
- Dismissed: the same trigger within 15 minutes is quiet, and a P1 report naming it still comes through.
- A plan citing a reading that isn't in the snapshot is rejected before Mo sees it (already covered, keep it).
- Approve with 2 free on a team that needs 4: 2 assigned, the other 2 retried when someone frees up.
- A helper's "done" before accepting is refused.

## Order

1. Merge Chien's slimmed branch into `typed-sends-straight` (Achal's work is already in).
2. Audit fixes D2, D3, S1, D4, D6: they break the basics, so they go first.
3. T1 and T4 (report → plan), with one playbook per run.
4. The short review screen.
5. Readings and T3, then T2.
6. The simulator script for demo day.

## Decisions needed

1. **Who writes the playbooks?** Chien's pitch has Mo writing them before the festival. Today they're in code.
   Recommended: code for the demo. A setup screen (not in Mo's live menu) can come back after it.
2. **Does Mo see "simulated" on a plan from simulated readings?** Recommended: no on the card (the demo is the
   point), but it's stored, so it can't be confused later.
3. **The trigger numbers** in the readings table above.
4. **Can T1 fire from one report that isn't P1?** Recommended: only P1, or a playbook named with high confidence;
   anything weaker waits for T2.
