# Lost child playbook: plan

First playbook in the shape set out in 2026-10-08-incident-playbooks-plan.md. Builds on the merged tree
(typed-sends-straight with chien-fixes merged in, see 2026-10-08-chien-mobilization-audit.md), because it uses Chien's
helper slots (`Task.helpers`, `notified` → `accepted`, released when silent) for searchers.

## Why the picker doesn't fit

Today a `lost_child` P1 goes to `dispatch` → proposal → `pickFor` (two lanes, most qualified first, WWCC weighted) →
a lead approves → one owner plus "how many" helpers. That's three model calls (language, backgrounds, crew) and an
approval before anyone moves, and it sends WWCC holders to search, which doesn't need WWCC.

Chien's mobilization doesn't fit either: the YAML has no lost-child SOP (children appear only as welfare lines in
`manual-welfare-logging`, `reunification-support`, `separated-party-support`, `vulnerable-patron-support`), no action
sets `requiredSkills`, a plan needs at least two team steps and Mo's approval, and it has no phases.

## The flow

```
report (guest app, voice, typed) + photo if the parent has one
  │  intake: category lost_child, description, last-seen zone
  ▼
MISSING  P1 ─────────────────────────────────────────── auto, no model call, no approval
  heads-up   everyone on duty: photo, "Missing: girl, 5, red hat. Last seen Lawn Stage front."  [Found her]
  search     nearest 3 free to the last-seen spot, any team, distance only → helper slots
  exits      people at a gate (live position near gate-a, gate-b, artist-gate): "Watch your exit for …"
  parent     nearest free 1 goes to the parent and stays with them (skipped if the reporter is already a volunteer)
  │
  │  10 min and still missing → Mo alerted, 3 more searchers, "call police?" on Mo's sheet
  │
  │  [Found her] from anyone on duty, or a new report that matches this task
  ▼
CONFIRMING  P1 ──────────────────────────────────────── search keeps going
  finder     stays with the child, takes a photo
  parent     sees the photo: "Is this her?" [Yes] [No]
             on the guest app if they reported there, else on the phone of the volunteer with them
  │
  │  No → back to MISSING; the finder's child is a lost child too, so a new lost_child task starts
  │       from the finder's spot
  │  No answer in 2 min → Mo decides from both photos
  │
  │  Yes
  ▼
FOUND  P3 ───────────────────────────────────────────── the emergency is over
  stand down searchers and exits released (freeUp), heads-up replaced: "Found. Stand down." (photo removed)
  carer      finder holds WWCC → finder is the carer
             else → nearest free WWCC holder, assigned straight away; the finder stays until they arrive
  reunion    the parent volunteer walks the parent to the child, or both go to Welfare
  │
  │  carer's Done (child handed to the parent who confirmed) resolves the task for everyone
  ▼
RESOLVED
```

Found drops the task to P3: the child is safe and with a WWCC holder, so what's left is staying with her until the
parent arrives. P3 nudges and lead alerts run at the P3 cadence, and it stops counting as a P1 on Mo's board.

## The table

| Phase | Priority | Role | Who | Count | Send |
|---|---|---|---|---|---|
| missing | P1 | heads-up | everyone on duty, with the photo | all | auto |
| missing | P1 | search | nearest free to `zoneSlug`, any team | 3 (+3 at 10 min) | auto |
| missing | P1 | exits | anyone whose live position is at a gate zone | in place | auto |
| missing | P1 | parent | nearest free to the parent | 1 | auto |
| confirming | P1 | finder | whoever tapped "Found her" | 1 | — |
| confirming | P1 | confirm | the parent, or the parent volunteer on their behalf | — | — |
| found | P3 | carer | finder if WWCC, else nearest free WWCC holder | 1 | auto |
| found | P3 | stand down | searchers, exits, heads-up | — | auto |

"Nearest" is the walk from a fresh phone position (`walkFrom`), else the stored zone. Exits use positions only:
`Volunteer.zoneSlug` is only updated when someone finishes a task, so it's a poor guide to who's at a gate.

## Changes

**Data**
- `src/lib/playbooks.ts` (new, pure): `PLAYBOOKS: Partial<Record<IncidentCategory, Playbook>>`, with
  `Playbook = { phases: Record<Phase, { priority: Priority; roles: Role[] }> }`,
  `Role = { key, pick: 'nearest' | 'qualified' | 'lanes' | 'in_place' | 'everyone', count, skills?, send: 'auto' | 'approve' }`.
  The table above is the only entry; medical stays on lanes.
- `src/lib/schema/domain.ts`: `Task.phase: 'missing' | 'confirming' | 'found' | null`, `Task.foundBy: string | null`,
  `Task.photos: { kind: 'reported' | 'found'; path: string; byId: string; at: number }[]`;
  `HelperAssignment.role?: string` (search, parent, carer). `MessageKind` gains `'alert'` (heads-up with a task action).
- Migration `20261008140000_task_phase.sql`: `tasks.phase text`, `tasks.found_by uuid`, `tasks.photos jsonb`;
  a private `photos` bucket, readable by staff on duty, writable by the parent's request and by volunteers on the task.
  `helper_status` is jsonb, so the role needs no column.

**Commands (`src/lib/commands.ts`)**
- `dispatch`: a category with a playbook calls `runPhase(b, task, 'missing')` instead of proposing.
- `runPhase`: sets the phase's priority, then for each role picks (`nearestFree(task, volunteers, tasks, n, positions)`
  in candidates.ts, cross-team, skipping anyone `canHelp` would reject on duty, shift or skills), sends, writes events.
  The first searcher is the owner, the rest are helper slots, so the existing accept/decline/silent-release paths apply.
- `found(b, byId, taskId, photo)`: no-op unless `phase === 'missing'`. Sets `confirming` and `foundBy`, adds the photo,
  asks the parent (guest request or the parent volunteer) "Is this her?". Search keeps going.
- `confirmFound(b, byId, taskId, yes)`: from the parent's request or the parent volunteer.
  - Yes: `runPhase(b, task, 'found')`, which releases search and exit slots with `freeUp` on each, assigns the carer,
    drops to P3 and re-broadcasts "Found. Stand down." to everyone who got the heads-up.
  - No: back to `missing`, `foundBy` cleared, and a new `lost_child` task for the child the finder is with, the finder
    as its owner.
- `schedulerStep`: a `missing` task older than `POLICY.lostChildWidenMs` (10 min) and not yet widened → Mo alert,
  3 more searchers. A `confirming` task with no answer after `POLICY.lostChildConfirmMs` (2 min) → Mo decides.

**Matching**
- `openMatch` / `nearbyOpenTasks`: keep open `lost_child` tasks matchable, so "found a lost girl in a red hat" calls
  `found()` instead of filing a second task. Chien's code excludes mobilization tasks here; lost-child tasks are not
  mobilization tasks, but check the filter after the merge.

**Server**
- `src/server/pick.ts`: `pickNewProposals` skips categories with a playbook, since no proposal is made for any phase.
- `src/server/http/commands.ts`: a `found` route for any on-duty volunteer, not only people on the task; a
  `confirmFound` route for the parent's guest request and the parent volunteer.

**Screens: no new ones**

Everything goes on screens that exist. The new UI is a button, a photo and a camera call.

- Heads-up: a message with a `taskId`, so the inbox already shows it ("· Everyone", megaphone) and opens the task.
  Its "Stand down" is a second message.
- Searchers: a lost-child task is a normal task with the description in `summary` and the spot on the map.
  `task-actions.tsx` gets one button, [Found her], for lost-child tasks in `missing`. Anyone on duty can open the task
  from the heads-up and tap it.
- Photo: an `expo-image` on the active task card and the heads-up row (expo-image is installed). The camera is
  `expo-image-picker`'s `launchCameraAsync`, a system screen with nothing to build. It's a native module, so it needs a
  new dev build.
- Parent: the guest request screen already asks "Problem solved?" with Yes/No (`(guest)/request/[id].tsx`). Same card,
  "Is this her?" and the photo. The parent volunteer gets the same Yes/No as a reply on their task.
- Mo: the 10-minute widen, police and a stalled confirm are `escalation` messages. The task sheet and timeline show the
  rest as events.

## Heads-up to everyone

`broadcast()` (commands.ts) and the inbox row exist, but a lead's broadcast is text only. For the lost child it needs:

- **A system sender.** `broadcast()` needs a volunteer as `byId`; the playbook sends as "Moloop".
- **`taskId` on each message**, so the inbox row opens the task, and the task screen shows [Found her] to anyone on
  duty, not only people on the task (`task/[id].tsx` only shows actions when `isOnTask`).
- **Spoken or ping**, same rule as `place`: read aloud to the idle, a ping to the busy. Today broadcasts have no
  `delivery`, so nobody hears them. The one-upload fix for `brief()` is in the push plan.
- **Searchers skip it**: they get the task itself.
- **Photo** on the inbox row and the task card.

**Push.** Today nothing reaches a locked phone, which defeats "everyone looks". Push for every message, this one
included, is its own plan: 2026-10-08-push-notifications-plan.md. The heads-up is the `alert` row there: time
sensitive, sound, tap opens the task. Same dev build as the camera.

## Fixes this depends on (from the audit)

- A released or declining helper must `freeUp` (audit D1), or a searcher's queued task is stuck.
- Team-locked `canHelp` (D8): searchers come from any team. Split `canHelp` into a shared "available" check plus the
  team rule, and use only the first for playbook roles.
- An owner who declines strands the helpers (D3): for search, promote the next searcher to owner.

## Tests

- `playbooks.test.ts`:
  - a lost child sends 3 nearest searchers with no proposal and no model call; the heads-up with the photo reaches
    everyone on duty; only people standing at gates get the exit alert.
  - a guest-reported child also sends 1 to the parent; a volunteer-reported one doesn't.
  - `found` moves to confirming and keeps the searchers on; a second `found` while confirming is a no-op.
  - confirm Yes: P3, searchers freed and their queued tasks start, a WWCC finder becomes the carer, otherwise the
    nearest WWCC holder is assigned with no proposal.
  - confirm No: back to missing, and a new lost_child task owned by the finder.
  - 10 minutes missing widens once and alerts Mo once; 2 minutes confirming with no answer alerts Mo once.
  - a declining searcher is replaced; a silent one is released and replaced.
  - medical still goes through the lanes picker.
- `commands:check` script: the full missing → confirming → found → resolved run against local Supabase.

## Decided (2026-10-08)

1. Searchers go without approval.
2. Heads-up, with the photo, goes to everyone on duty.
3. Any volunteer on duty can tap "Found her"; the parent confirms before the search stands down.
4. The WWCC carer is assigned automatically.
5. Once confirmed found, the task is P3.
6. Volunteer-reported child with no parent around: the reporting volunteer goes to find the parent and becomes the
   parent volunteer. The search doesn't wait for them.

## Open

- How long the photos are kept after the task resolves.
