# moloop

**Everyone in the loop.** AI coordination for volunteers at a 15,000-person music festival.

Anyone reports by voice or text. Models turn it into a task, the right volunteer gets it, nothing goes silent. Expo (iOS, Android, web) + Supabase + one Bun command server.

| Role | Gets |
|---|---|
| **Mo** (coordinator) | Console: Needs action, Tasks, Crew, Map. Approves P1s and mobilizations. |
| **Team leads** | Approve P1/P2 picks for their team, answer "need help", reassign. |
| **Volunteers** | One task at a time, spoken aloud. Accept, Done, Need help, Take a break. |
| **Festival-goers** | Ask or report without an account. See who is coming and when. |

## Agent architecture

All model calls run on the command server. Phones read Supabase directly (RLS + Realtime); every write goes through the server.

```mermaid
flowchart LR
subgraph C["Client · Expo"]
G([Festival-goer])
V([Volunteer / lead])
M([Mo console])
end

subgraph S["Command server · Bun + Hono"]
T[Transcriber]
RI[Reply interpreter]
CL[Classifier / gate]
AW[Answer writer]
IA[Intake agent]
MA[Re-triage matcher]
PK[Picker]
TR[Triggers T1–T4]
PL[Mobilization planner]
SC[Scheduler · 5 s]
OUT[TTS + push]
end

subgraph D["Supabase"]
PG[(Postgres + RLS)]
RT[Realtime]
end

subgraph X["Models"]
OA[OpenAI · gpt-6-luna / sol]
SP[Spark · qwen3.5 opt-in]
end

G & V -->|voice| T
G -->|ask| CL
T --> RI
RI -->|new report| CL & IA
CL -->|routine| AW
CL --> IA
IA --> MA --> PK
PK -->|proposal / assign| PG
PG --> TR --> PL -->|plan| M
SC -->|nudges, no-shows, auto-assign| PG
PG --> OUT --> V
PG --> RT --> C
S -.-> X

classDef agent fill:#EAF0FE,stroke:#2F6BF5,color:#111827
classDef rule fill:#FFFFFF,stroke:#9CA3AF,color:#111827
classDef store fill:#F1F3F6,stroke:#6B7280,color:#111827
classDef actor fill:#2F6BF5,stroke:#2F6BF5,color:#FFFFFF
class T,RI,CL,AW,IA,MA,PK,PL agent
class TR,SC,OUT rule
class PG,RT,OA,SP store
class G,V,M actor
```

`decide` = typed decision with probabilities (OpenAI Decisions API; Spark first when `MODEL_PROVIDER=spark`, OpenAI after 4 s).

| Agent | Job | Model |
|---|---|---|
| Transcriber | Hold-to-talk audio → text, "Heard: …" | gpt-4o-mini-transcribe |
| Classifier / gate | Team (1 of 8), P1/P2/P3, routine? | `decide` |
| Answer writer | Answers routine guest questions in their language | gpt-6-luna |
| Intake agent | Calls one tool: `create_task`, `escalate`, `answer_question` | gpt-6-luna tools |
| Re-triage matcher | Is this about an open task nearby? Worse? | `decide` |
| Reply interpreter | Accept / decline / done / need help / new report | `decide` |
| Detail reader | Guest's "What's changed?" → worse or not | `decide` |
| Picker | Re-ranks free crew, picks 1–3 people | `decide` (OpenAI) |
| Respond-by-voice | Lead's spoken call on an escalation | `decide` |
| Pile-up checker | 3+ reports in a zone → playbook or none | gpt-6-luna |
| Mobilization planner | One playbook + live snapshot → crew plan | gpt-6-sol, `/responses` |
| TTS briefs | Spoken messages → mp3 | gpt-4o-mini-tts |

Rules, not models: scheduler, rule ranker (team → free → skill → nearest), sensor triggers, push.

## How a request works

<img src="docs/readme/request-intake.svg" width="880" alt="Intake: speak or type, transcribe, interpret, classify; routine guest questions answered">

<img src="docs/readme/request-routing.svg" width="880" alt="Routing: intake agent, re-triage, picker, approval or straight assign, push and TTS">

- **Gate at 0.95:** the only value in a 336-case eval where nothing that needs a person got through.
- **Priority merge:** agent P1 always wins; low classifier confidence rounds up.
- **Crew reports** skip approval and go to the first free teammate.
- **Fails closed:** both providers down → a person gets it at P2. The AI never answers.

## Priority, classification and routing

<img src="docs/readme/priority-levels.svg" width="880" alt="P1, P2 and P3: definition, approver, need-help bump, example">

| Request | Class | Route |
|---|---|---|
| "Where are the nearest toilets to the Oval Stage?" | info · routine | AI answers, nobody sent |
| "Can someone bring a plaster to Water 2, I've got a blister" | first-aid · P3 | Straight to top pick |
| "My friend feels really dizzy and faint, we're by Water 2" | first-aid · P2 | Jordan (lead) approves |
| "A man's collapsed by Food Alley and he isn't responding" | first-aid · P1 | Mo + Jordan approve |
| "I want a refund, the headliner cancelled" | info · P3 · escalate | Held for the lead |
| "I overheard someone saying there is a bomb at the main stage" | security · P1 · escalate | Mo decides; help still goes |
| "She's fainted, she's on the ground now" (follow-up) | worse | P2 → P1, lead alerted |

## Task lifecycle

<img src="docs/readme/task-lifecycle.svg" width="880" alt="Task states: open, queued, assigned, accepted, escalated, resolved, cancelled">

Every change is logged in `task_events`, every model decision in `triage_runs`.

## Keeping volunteers in check

<img src="docs/readme/volunteer-states.svg" width="880" alt="Volunteer duty states: on duty, on break, off shift">

<img src="docs/readme/nudges.svg" width="880" alt="Nudge timeline, spoken brief vs ping, need-help bump to Mo">

<img src="docs/readme/roster-noshow.svg" width="880" alt="Shift start, no-show at 15 min, lead told who is free to cover">

- Free = on duty, in shift, qualified, not busy. One active task each; extras queue.
- Silence never closes a task.
- No-shows are not auto-reassigned: the lead gets "<Name> not in for <time>. Free to cover: …".

## SOPs → mobilization

<img src="docs/readme/playbooks-triggers.svg" width="880" alt="Four playbooks and the four triggers T1 to T4">

<img src="docs/readme/mobilization-review.svg" width="880" alt="Planner, Mo's review: approve, dismiss, stand down, capped crews">

- Four playbooks, fixed in code: storm, crowd crush, heat + water shortage, gate breach. Each has one must action per team.
- One plan per playbook + zone; new triggers join as causes.
- Planner fails or is slow → the plan comes straight from the playbook's actions.

## Demo simulator

`npm run simulate` drives the real server as sensors and people. Default `storm`: Oval Stage wind climbs 35 → 45 → 55 km/h, two volunteers report it, wind hits 72 km/h, Mo gets a plan. Flags: `--fast`, `--crew-replies`. Also: `triggers`, `examples`, `no-show`.

## Run it locally

<details>
<summary>Prerequisites, commands, env vars</summary>

Needs Node, Bun, Docker, the Supabase CLI, and Xcode or Android Studio. MapLibre and the BLE beacon module need a dev build; Expo Go won't work.

```bash
npm install
node scripts/ensure-supabase.mjs  # Docker, local Supabase, migrations, writes .env.local
# add OPENAI_API_KEY to .env.local (see .env.example)
npm run server                  # server on :8787
npm run web                     # Mo's console, http://localhost:8081
npm run ios                     # or: npm run android
npm run simulate                # storm at the Oval Stage
```

Reset data: `supabase db reset`. Checks: `npm test`, `npx tsc --noEmit`, `npm run lint`.

| Where | Env vars |
|---|---|
| Server | `SUPABASE_URL`, `SUPABASE_SECRET_KEY`, `DATABASE_URL`, `OPENAI_API_KEY` |
| Server, optional | `MODEL_PROVIDER`, `SPARK_BASE_URL`, `SPARK_API_KEY`, `MOBILIZATION_MODEL`, `SPEECH_BASE_URL`, `POLICY_SCALE`, `PORT` |
| App | `EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `EXPO_PUBLIC_SERVER_URL` (LAN address on a phone) |

</details>

## Repo map

```
src/app/            screens (Expo Router): (mo) (staff) (guest), approve, mobilize, respond
src/components/     UI, map
src/lib/            commands, lifecycle, ranking, roster, shifts
src/server/         command server: http, scheduler, triggers, pick, push
src/server/models/  interpreter, intake tools, providers, speech
src/server/predict/ mobilization planner
src/server/playbooks/ the four SOPs
supabase/           migrations, seed
scripts/            simulator, checks, evals, roster
modules/moloop-beacon/ BLE finder
```

More: [ARCHITECTURE](docs/ARCHITECTURE.md) (mobilization section predates code-defined playbooks) · [DEMO](docs/DEMO.md) · [PLAYTHROUGH](docs/PLAYTHROUGH.md) · [SCREENS](docs/SCREENS.md) · [MOBILIZATION-LATENCY](docs/MOBILIZATION-LATENCY.md)
