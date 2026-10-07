# Incident playbooks: plan

## Context

The picker (src/server/pick.ts) treats every P1/P2 the same way: two lanes (most qualified, nearest), the model picks
from them, and a lead approves. That suits a medical call, where one or two of the right people should go.

A lost child doesn't fit. The first minutes are a search, and what matters is how many people are looking and how
close they are. The WWCC matters once she's found and someone has to stay with her, take her to the toilet or walk
her to the reunion point. Today the picker sends WWCC holders first and waits for a lead to approve.

Chien's playbooks (commit 1f73192, later dropped on chien-fixes) are YAML for site-wide emergencies (storm, crowd
crush, power failure) with actions per team, all waiting on Mo. The shape is right but the machinery is heavy for a
single incident. This plan is the small version: a playbook per incident category, kept in code, built from roles.

## Shape

```
Playbook (per category)
  └─ Phase          "missing", "found"; the task moves between them on an event
       └─ Role      who to pick, how many, and whether a lead approves
            pick:   nearest | qualified | lanes (today's picker) | in place (alert, nobody moves)
            count:  fixed number
            send:   auto | approve
```

A category with no playbook keeps today's picker unchanged.

## Lost child

Its own plan: 2026-10-08-lost-child-playbook-plan.md.

## Medical (first playbook after lost child, to check the shape generalises)

| Phase | Role | Pick | Count | Send |
|---|---|---|---|---|
| — | Responder | lanes, as today | 1 | approve |
| — | Helper | nearest | 0–2, the existing "how many" call | approve |

## Changes

- `src/lib/playbooks.ts`: the table above as data (`Playbook`, `Phase`, `Role`), pure.
- `src/lib/candidates.ts`: `nearest(task, volunteers, tasks, n)` for the search, helper and carer roles; lanes stay for "lanes".
- `src/lib/schema/domain.ts`: `phase` on a task; a role on each assignment (`search`, `carer`, ...).
- `src/lib/commands.ts`: `found(b, taskId, byId)` moves the phase, releases searchers, proposes the carer, re-broadcasts.
- `src/server/pick.ts`: a category with a playbook staffs its roles; "lanes" roles go through the picker as today.
- Volunteer screens: the heads-up card with "Found her"; a searcher's task shows the description and last-seen spot.
- Migration: `tasks.phase`, `task_assignments.role`.

## Tests

- `playbooks.test.ts`: a lost child sends three searchers and one with the parent without approval, and alerts gates.
- "Found her" releases searchers, proposes the nearest WWCC holder, and is a no-op the second time.
- A category without a playbook still goes through the lanes picker.

## Decisions needed

1. **Searchers without approval?** Searching harms nobody and minutes count. Recommended: yes, search and with-parent
   go straight away, a lead sees it happening and can recall anyone.
2. **Heads-up to everyone on duty, or only nearby zones?** Recommended: everyone; a child moves faster than you think.
3. **Who can tap "Found her"?** Any volunteer, or also the parent on the festival-goer app?
4. **Editable playbooks?** Code first. If leads need to edit them, bring back Chien's YAML store and editor later.
