# Screens and flows plan

Every screen for every role, the escalation logic behind them, and how the build is split across agents. UI only, on the mock repo. Supabase, real TTS and real GPS come after this.

## Roles

| Role | Who | Device | What they do |
| --- | --- | --- | --- |
| Festival-goer | Anyone at the event | Phone, no install (QR → web) | Ask a question or report something, track the response |
| Volunteer | Priya, Tom, Linh… | Phone app | Do one task at a time, hands-free |
| Team lead | Jordan (First Aid), Sofia (Welfare)… | Phone app | Exactly the volunteer app, plus a Team view to watch and coordinate their team |
| Coordinator | Mo | TBD | Whole event. **Logic is built now; screens are designed later** once the logic is in |

One Expo app holds all four. The signed-in role decides which route group you land in. For the demo, the dev panel switches roles.

## Task statuses

The 8 statuses stay as they are in `enums.ts`. `in_progress` stays in the schema but nothing sets it: there is no "arrived" reply.

What changes is that **status is shown in one place**: the top line of the task card. The separate banner goes. All status copy comes from one module, `src/lib/status.ts`, so every screen says the same thing.

### What the volunteer sees

| State | Status line | Tone | Tap |
| --- | --- | --- | --- |
| `queued` | Up next | neutral | — |
| `assigned` | New task | tint | Accept / Decline in reply bar |
| `accepted` | On it · 4 min | neutral | — |
| `accepted` + nudged | Send an update | warning | Opens reply sheet |
| `accepted` + lead alerted | Jordan asked for an update | warning | Opens reply sheet |
| `escalated`, no response | Asked Jordan for help · 1 min | danger | — |
| `escalated`, bumped to Mo | Asked Mo for help · 4 min | danger | — |
| Response: backup | Linh joining · ~3 min | tint | — |
| Response: handover | Medics on the way | tint | — |
| Response: call | Jordan is calling you | tint | Opens dialer |
| `resolved` | Done | success | — |
| Handed over (resolved) | Handed to medics | neutral | — |

"Stay with them" is added **only** for categories about a person (`medical`, `heat`, `lost_child`, `security`, `accessibility`), and only after a handover or backup response. Never for things like restocking.

Reassigned or closed tasks leave the volunteer's card. They get an Inbox message ("Moved to Kai", "Closed by Jordan").

### What a lead or Mo sees about a team member

| Member state | Line |
| --- | --- |
| Free, on duty | Free · Oval Stage |
| On break / off shift | On break |
| On a task | Dizzy man at Water 2 · 4 min |
| Asked for help | Asked for help · 1 min (danger) |
| Went quiet | Quiet · 6 min (warning) |
| Backing someone up | Helping Priya · Water 2 |

## Escalation

### Triggers

1. **Asked for help.** The volunteer says or taps "Need help", with an optional reason ("he's getting worse", "can't lift it"). Status becomes `escalated`.
2. **Went quiet.** No reply after a nudge, so the lead is alerted (exists today). This is not a status: the task keeps its status, with `leadAlertedAt` set.

Both land in the lead's **Needs you** list.

### Who gets it

- **Lead first**, for every priority.
- If the lead hasn't responded in time, it goes up to Mo. The lead still sees it.

| Priority | Bump to Mo after |
| --- | --- |
| P1 | 1 min |
| P2 | 2 min |
| P3 | 3 min |

- A lead can also pass it up by hand ("Pass to Mo").
- The scheduler now covers escalated tasks too: an unanswered escalation always moves up and never sits silent.

### Responses (lead or Mo)

| Response | Effect | Task after |
| --- | --- | --- |
| **Send backup** | Pick a volunteer (suggested: nearest free on the same team). They get it as their active task, as a helper. The original volunteer stays on it. | `escalated` → `accepted`, with `helperIds` and `escalation.response` set |
| **Hand over** | Pick a target: First Aid Post medics, Security, or Emergency services. The volunteer stays until they arrive; then the lead taps "Arrived" and the volunteer is freed. | `escalated` → `resolved` with `resolution: 'handed_over'` on "Arrived" |
| **Reassign** | Pick a volunteer. The original volunteer is freed and their next queued task is promoted. | `assigned` to the new volunteer |
| **Call** | Opens the dialer to the volunteer. Afterwards the lead picks another response, or **Carry on**. | stays `escalated` until the follow-up |
| **Close** | Not needed. Optional reason. | `cancelled` |
| *Carry on* | Only after Call, or for "went quiet". Clears the escalation. | back to `accepted`, nudges cleared |

Emergency services are human-only. The app shows "Call 000" to the lead and records that it was done; it never places the call itself.

For "went quiet" the response sheet offers only: **Call**, **Reassign**, **They're fine** (= Carry on).

### Data

```ts
type EscalationResponseKind = 'backup' | 'handover' | 'reassign' | 'call' | 'close' | 'carry_on';
type HandoverTarget = 'medics' | 'security' | 'emergency';

type Escalation = {
  at: number;
  reason: string | null;            // what the volunteer said
  level: 'lead' | 'coordinator';    // who owns it now
  ownerId: string | null;           // lead id, or Mo
  bumpedAt: number | null;
  response: null | {
    kind: EscalationResponseKind;
    byId: string;
    at: number;
    volunteerId?: string;           // backup or reassign target
    target?: HandoverTarget;
    etaAt?: number;
    note?: string;
  };
};

// Task gains:
escalation: Escalation | null;
helperIds: string[];
resolution: 'done' | 'handed_over' | 'cancelled' | null;
requestId: string | null;           // links back to a festival-goer request

// Volunteer gains:
phone: string | null;               // for Call; mock numbers only
```

## Festival-goer flow ("Uber" view)

### Steps

1. **Ask.** The map with them on it, and the voice pill (hold to talk, or the keyboard button to type). It shows "Heard: …" before sending, like the volunteer's pill. Location: pick a zone or "Near me" (mock GPS).
2. **Understanding.** The request moves through visible steps: Heard → Understanding → Sorted. The steps are real pipeline stages (`route` → `triage` → `assign`), not decoration.
3. **Then one of two outcomes:**
   - **AI answer** (routine question: toilets, set times, lost property hours). The answer is shown right away, with a **Talk to a person** button. Tapping it sends the request to triage as a P3 task for the right team. That's the "request human" path.
   - **Dispatched** (someone needs to come). Shows "Finding someone…", then **"Matched with Priya"** (with "Finishing a task" if she's busy, and her dot where she is), then **"Priya is coming · 3 min"**: a map with both dots, the volunteer's first name and initial, and the team. Two buttons: **Add detail** and **Cancel**.
4. **Add detail** is the voice pill on the request screen (hold or type): "What's changed?" The person describes the update in their own words. The AI decides what it means: a note on the task for the volunteer, or a priority bump that alerts the lead if it sounds worse. There is no separate "It's getting worse" button.
5. **Arrived.** After the ETA the screen shows "Priya should be with you" (real GPS proximity later).
6. **Sorted.** When the volunteer replies Done, the person sees "Sorted" with one question: **Still need help?** Tapping it reopens the request and goes back to step 4. This is not a rating or review: no stars, no feedback loop. It only catches tasks that were closed too early.

For a "Talk to a person" request, the volunteer's card gets a **Reply** action: a typed or voice note that shows up in the festival-goer's thread. Sometimes a reply is all it needs and nobody has to walk over.

Location is only shared while a request is open.

**Later, not now:** an AI-picked meet-up spot (for when the person should come to a volunteer, not the other way round). V1 always sends the volunteer to the person.

### Data

```ts
type GuestRequestStage = 'understanding' | 'answered' | 'finding' | 'coming' | 'with_you' | 'sorted' | 'cancelled';

type GuestRequest = {
  id: string;
  createdAt: number;
  heard: string;
  zoneSlug: string | null;
  locationHint: string | null;
  stage: GuestRequestStage;         // derived from the task once one exists
  aiAnswer: string | null;
  taskId: string | null;
  thread: { from: 'guest' | 'ai' | 'staff'; name?: string; text: string; at: number }[];
  reopenedAt: number | null;        // "Still need help?" after Sorted
};
```

## Screens

Every main screen is the same shape, like a ride-hailing app: **the site map full-screen, a sheet over it, and the voice pill pinned to the bottom.** There's no tab bar.

- **Map** (`components/map/venue-map.tsx`, `.web.tsx` on web): the real site, University Oval and the athletics track at the University of Melbourne (Parkville), on MapLibre with OpenFreeMap tiles, the festival drawn into the style as an illustrated site map (`map-art.ts`: ground from OpenStreetMap in `data/venue-features.ts`, stages, tents, trucks and toilets from the zones, badges in `assets/images/map`) and people and pins as views on top (`map-markers.tsx`). Positions stay in plan metres (`data/venue.ts`), pinned to the ground by `GEO`. Frames what matters in the part the sheet leaves clear (`frame`). Floating round controls along the top (`map-button.tsx`, `map-screen.tsx`). Needs a development build (`npx expo run:ios`); Expo Go can't load MapLibre.
- **Sheet** (`components/ui/bottom-sheet.tsx`): three stops: the headline, half the screen, and nearly full. Below the top stop the whole sheet drags; at the top its content scrolls. Pulling the sheet up replaces "Details" toggles.
- **Voice pill** (`components/voice/voice-dock.tsx`): hold anywhere on the pill to talk, or tap the keyboard to type. What was heard comes back in a small tray above it with exactly what Send will do. No orb on screen; the orb survives only as the small mic bubble.

Everything else (Inbox, Person, Respond, Reply…) opens as a sheet over the map. Copy states the action only. Read tokens from `theme.ts`; no new colors.

### Festival-goer — `src/app/(guest)/`

| Route | Screen |
| --- | --- |
| `(guest)/index.tsx` | **Ask**: map with them on it; sheet with the zone picker and their recent requests; voice pill to ask |
| `(guest)/request/[id].tsx` | **Request**: map with both dots and the route; sheet with the status (minutes boxed), steps, AI answer or who's coming, thread, Cancel; voice pill for Add detail; "Still need help?" after Sorted |

### Volunteer — `src/app/(staff)/index.tsx` + sheets

One screen. The map shows me and the walk to my task (or the whole site when I'm free). The sheet shows my task: status line, title, where, walk time with Directions, then the reply buttons; pull up for the summary, the reporter's words, Timeline, Up next and Done. Free, the sheet rests at its lowest stop. The voice pill replies to the task or reports something new. Top of the map: shift chip (break, demo controls) and Inbox.

| Route | Screen |
| --- | --- |
| `(staff)/index.tsx` | Map + sheet + voice pill, as above |
| `inbox.tsx` (formSheet) | Inbox: task, nudge, broadcast, moved, closed, handover arrived, guest reply |
| `task/[id].tsx` | Task detail with the timeline |
| `reply/[id].tsx` (formSheet) | Note for Done / Need help / check-in, or a reply to a festival-goer; hold the pill or type |
| `navigate/[id].tsx` | Walking directions |

### Team lead — same screen + shared sheets

A lead's app is **exactly the volunteer app**, plus a **My task / Team** switch at the top of the sheet, shown only when the role is `team_lead` (and Mo for now).

| Where | Screen |
| --- | --- |
| Team view of `(staff)/index.tsx` | The map shows the team: each member as a dot (ring when on a task, red when they asked for help) and the team's open tasks as pins; markers in one place fan out. The sheet: **Needs you** (help, quiet, approvals, unassigned), **People**, **Open tasks**. Tapping a dot or a person opens `person/[id]`, a pin opens the task's sheet |
| `respond/[id].tsx` (formSheet) | **Respond**: the reason, the volunteer, the map, then the response buttons; Backup and Reassign open a picker; Handover asks for a target; "Pass to Mo" for leads |
| `person/[id].tsx` (formSheet) | **Person**: status, their current task (card with progress and timeline link), queue, zone, skills, languages; Call, Message, Assign a task |
| `assign/[id].tsx` (formSheet) | **Pick a volunteer** for a task: suggested first (free, nearest, same team, skills), with why ("free · 120 m · first aid cert") |
| `approve/[id].tsx` (formSheet) | **Approve**: the AI's proposal for a P1/P2 guest report, with a 30 s countdown; approve the suggestion or pick another. If nobody acts, the AI's top pick is assigned automatically |

### Coordinator (Mo) — later

Mo's **logic** is built in Phase 1: escalations bumped to Mo, P1/P2 approvals with auto-assign, broadcasts, unassigned tasks. Mo's **screens** wait until that logic exists and Mo's job is clearer. Ideas so far:

- **Coverage heat map**: which areas are thin on volunteers, and where the big issues are.
- **Needs you**: what leads didn't handle in time.
- **Broadcast** to everyone, a team or a zone.

Until then, the dev panel can act as Mo: respond to bumped escalations and send broadcasts.

### Shared

- `dev.tsx`: role switcher (adds a Festival-goer identity) and scenario buttons:
  - Priya asks for help
  - Linh goes quiet
  - New guest question (AI answer)
  - New guest report (dispatched)
  - New P1 guest report (needs approval; auto-assigns after 30 s)
  - Act as Mo: respond to bumped escalations, send a broadcast
  - Jump clock +1 / +5 min

## Build split

### Phase 1 — Foundation (1 agent, runs first)

Owns everything shared. Leaves stub screens for every route, so Phase 2 agents only touch their own files.

- **Schema** (`src/lib/schema/domain.ts`): Escalation, helperIds, resolution, requestId, phone, GuestRequest, Proposal (with `autoAssignAt`).
- **Lifecycle** (`src/lib/lifecycle.ts`):
  - `respondToEscalation()`
  - escalation bump in `tick()`
  - `carryOn()`
  - helper rules: a helper counts as busy; `done` resolves for everyone
  - `POLICY.bumpToCoordinatorMs`
  - `POLICY.autoAssignMs` (30 s): P1/P2 proposals nobody acts on get the top pick assigned by the scheduler
  - P3 assigns straight away, no approval (as today)
- **Status copy** (`src/lib/status.ts`, new): `taskStatusFor(viewer, task, lookups, now)`, `memberStatus(volunteer, tasks, now)`, `guestStage(request, task)`. Returns `{ label, detail?, tone, action? }`.
- **Repo** (`src/data/repo.ts`, `mock/mock-repo.ts`, `mock/fixtures.ts`):
  - new commands: `respond`, `assign`, `approve`, `broadcast`, `sendDirect`, `guestAsk`, `guestRequestHuman`, `guestAddDetail` (the AI decides: note or priority bump), `guestCancel`, `guestReopen`, `guestReply`
  - snapshot gains `requests`, `proposals`, `guestId`
  - fixtures cover every Needs-you type
- **Hooks** (`src/data/hooks.ts`): `useNeedsMe`, `useTeam`, `useAllActive`, `useRequest`, `useMyRequests`, `usePerson`.
- **Routes**:
  - `(guest)`, `(tabs)/(team)`, plus the `respond`, `person`, `assign` and `approve` sheets, as stubs (no Mo routes yet)
  - root redirect by role (Mo lands in the volunteer tabs with the Team tab for now)
  - all `Stack.Screen` registrations in `src/app/_layout.tsx`
  - Team tab shown by role in `(tabs)/_layout.tsx`
- **Map** (`src/components/map/venue-map.tsx`): `markers` prop for many volunteers and tasks, plus two-person routes.
- **Shared UI** (`src/components/ui/status-line.tsx`, `src/components/ui/avatar.tsx`).
- **Dev panel** (`src/app/dev.tsx`): roles and scenarios.
- **Docs** (`docs/ARCHITECTURE.md`): update the lifecycle diagram.

### Phase 2 — Screens (3 agents in parallel, each owns only its files)

| Agent | Owns |
| --- | --- |
| **Volunteer** | `src/components/task/*`, `(tabs)/(task)`, `(talk)`, `(inbox)`, `task/[id].tsx`, `reply/[id].tsx` |
| **Lead** | `(tabs)/(team)/*`, `respond/[id].tsx`, `person/[id].tsx`, `assign/[id].tsx`, `approve/[id].tsx`, `src/components/lead/*` |
| **Festival-goer** | `(guest)/*`, `src/components/guest/*` |

Mo's screens are a later phase.

Rules for every Phase 2 agent:

- Don't edit files outside your list. If you need a change in shared code, write it down in your report instead.
- Read the Expo SDK 57 docs before touching an Expo API.
- Run `npx tsc --noEmit` and `npx expo lint`. Fix errors in your own files; ignore other agents' in-progress files.

### Phase 3 — Integration (main session)

- Walk every role and every scenario in the simulator.
- Fix seams between the screens and make copy and spacing consistent.
- Final typecheck and lint.

## Decided

- **Auto-assign.** P1/P2 guest reports get an AI proposal. A lead or Mo can approve or change it; if nobody acts within 30 s, the top pick is assigned automatically. P3 assigns straight away.
- **No ratings.** "Still need help?" after Sorted only reopens a request.
- **No "It's getting worse" button.** Add detail goes through the assistant, and the AI decides if it's worse.

## Open questions

1. **Mo's job and screens.** To define once the logic is in.
2. **Voice commands for leads.** "Send Linh to help Priya" through the voice pill. Later, once the respond actions exist.
3. **Meet-up spots.** Deferred (see the festival-goer flow).
