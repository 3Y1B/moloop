# Chien's mobilization: audit

Branch `chien-fixes` (worktree `.claude/worktrees/chien-fixes`), c6d5485..18d7797: Chien's 1f73192 and 6c6db9c, then
3f49339 (experiments dropped), 231d694 (migration dates), dd90e48 (approve uses `canHelp`), 18d7797 (silent helpers
released). 138 files, +21k/−2.9k.

State: `tsc --noEmit` clean, vitest 601/601, `expo lint` 0 errors (8 no-redeclare warnings, already there).

Note: 3f49339 removed the experiment outputs and benchmark only. The playbook store, YAML, `/mobilize`, `/playbooks`,
`/mobilize/simulate` and the five migrations are all still on the branch.

## Holds up

- Authz: role from `profiles`, not the token. Playbook and mobilization routes are Mo-only in HTTP and again in the
  domain (`requireMo`). Volunteers and leads can't edit SOPs or approve.
- RLS: new tables are select-only for clients, Mo-only for `playbook_versions` / `mobilization_runs`.
- Model output never names a volunteer. People are picked server-side; zones, teams, skills and SOP refs are checked
  against the snapshot (`predict/validate.ts`, `action-output.ts`).
- Approve is idempotent under the world lock; a second approve is a 409. Publish races are covered by the slug lock and
  the one-published index.
- Nothing still imports what 3f49339 removed.
- Client: the repo is disposed on unmount, channels cleaned up, no subscription leaks found.

## Must fix before it ships

| ID | Where | What goes wrong | Fix |
|---|---|---|---|
| U1 | `app/mobilize/simulate.tsx:237`, `predict/simulation.ts:338` | "Test situation" (10 canned scenarios, source `manual_demo`) writes a real mobilization. It shows in Mo's Needs list with no marker; approving it sends real people to a fire that doesn't exist. | Remove simulate and `mobilization-scenarios.ts` (no demo scaffolding), or flag `is_simulation` and block approve. |
| D1 | `lib/commands.ts:95-110`, `:969-977` | A helper who declines or is released never gets `freeUp`. A task queued for them while they were `notified` stays queued for good; nobody is told. | `freeUp(b, id)` after helper decline and `helper_released`. |
| D2 | `lib/commands.ts:95`, `server/http/commands.ts:85` | A helper still `notified` (never accepted) can say "done" and resolve the task for everyone. `applyHelperReply` doesn't check the task is active. | `done` from a helper only when their slot is `accepted` and the task is active. |
| D3 | `lib/lifecycle.ts:202`, `lib/commands.ts:140` | Owner declines a multi-person task: it goes open with no owner but keeps its helpers. They get no message and aren't freed, the status still counts them, nothing re-dispatches and no lead is told. A mobilization step sits at "awaiting reply". | On owner decline, promote an accepted helper or clear and free them, then `dispatch` or alert the lead. |
| S1 | `lib/commands.ts:1227-1235`, `lib/lifecycle.ts:289` | A step nobody could staff at approval is saved open and unowned with one lead message. Nothing retries it; `ownerTick` skips unowned tasks and no proposal exists. | Create a normal proposal (auto-assigns), or have `freeUp` pull open mobilization tasks. |
| D4 | `lib/commands.ts:894`, `lib/lifecycle.ts:265-280` | An empty helper slot (declined or released) is never refilled. The screen says "N crew still needed" and that's it. | Run `recruitHelpers` again after a decline or release; re-alert Mo while short. |

## Should fix

| ID | Where | What goes wrong | Fix |
|---|---|---|---|
| D5 | `lib/commands.ts:335-348` | Backup on an ordinary task skips `canHelp`, so a lead can put someone on two active tasks; their voice replies then go to whichever comes first. Predates Chien. | `canHelp` for every backup target. |
| D6 | `lib/commands.ts:1126`, `lib/status.ts:405` | Stand down leaves every child task running and every crew member busy. A mobilization never moves past `active`. | Stand down cancels open child tasks and frees their crews; finish when all are done. |
| D8 | `lifecycle.ts:72`, `candidates.ts:50-54`, `commands.ts:902-907` | Three copies of "who can go", already drifting. All require the task's team, so a task with no team never gets helpers and cross-team crews are impossible. | One `available(v, task, tasks, now)` plus a separate team rule. |
| S3 | `http/mobilization-review.ts:12-67` | Approve doesn't check age or whether the cited SOP is still published. A 14:00 plan from a since-disabled SOP can be approved at 16:00. | Reject when the run is stale or any cited `slug:version` isn't published. |
| S4 | `lib/mobilization-contracts.ts:108` vs `http/commands.ts:257` | AI path allows `peopleNeeded` up to 500, manual 10. `recruitHelpers` would take the whole team; the only gate is ticking "acknowledge gaps". | Cap at 10, or at the team's free count in the snapshot. |
| S5 | `predict/simulation.ts:333-335`, `:362-367` | One failed semantic check discards a whole run (about 160 actions over 10 SOPs); a timeout is 3.5 min then `failed`. The only fallback is a bare manual plan. | On failure, pre-fill the manual plan from the retrieved SOP actions; let unmet requirements become reviewable gaps. |
| S6 | `supabase/playbooks/festival-emergency.yaml` | No lost-child SOP. No action in the file sets `requiredSkills`, so child-facing welfare actions don't require WWCC. | Lost child goes in code (see the lost-child plan); add `requiredSkills: [wwcc]` to the welfare child actions. |
| U2 | `mobilize/[id].tsx:666`, `:700`; `playbooks/[id].tsx:834` | Reject, Stand down and "Disable this version" are one tap, no confirm. | The two-step confirm "Delete draft" already uses. |
| U3 | `components/mobilization/planning-form.tsx:38` | `inputMode="decimal"` has no minus on iOS; "temperature trend" can't go negative. | Signed fields: `numbers-and-punctuation`. |
| U4 | `app/_layout.tsx:65-68`, `components/screen-header.tsx:31` | Playbooks and simulate are `formSheet` but use `ScreenHeader`, which pads by the top inset: a blank band above the title. | Use `Sheet`/`SheetTitle` like the other sheets. |

## Low

- D9 `commands.ts:396`: reassign empties helpers before `place`, so accepted helpers are `notified` again, re-messaged,
  and can be released 5 min later.
- D10: `sameSituation` (`commands.ts:1168`) is unreachable; `goQuiet`/`spawnIncoming` (`commands.ts:1296-1346`) are
  demo-panel code; `helper_released` is logged as `lead_alerted`; "Helping X" shows before a helper accepts
  (`status.ts:112`).
- S8 `http/commands.ts:268`: unknown `zoneSlug` silently becomes null; `playbookSlug` has a foreign key to the old
  `playbooks(slug)`, so a slug from `playbook_versions` 500s.
- S9 `simulation.ts:256`: bad timeout config throws a `RangeError`, a 500 instead of `configuration_required`.
- S10: a fresh `db reset` has no published SOPs (`playbooks:import` isn't in setup) and the timetable is hard-coded to
  8-10 Oct 2026.
- S11 `playbooks/store.ts:171`: two Revise taps make two drafts.
- U5 copy narrates (team wants terse): `mobilize/[id].tsx` 157, 166, 183, 188, 201, 547, 648; `simulate.tsx` many;
  `playbooks/index.tsx` 19, 64; `playbooks/[id].tsx` 232, 279, 294, 306, 827, 843; `observation-editor.tsx` 273, 283,
  317, 386.
- U6: no route guard; on a cold deep link Mo briefly sees "Mo manages…". U7: `Repo.mobilizations?` is optional but
  always set, so the "not connected" branches are dead; `MobilizationControls.create` has no UI; the lead branch of
  `/mobilize/[id]` is unreachable.
- U8 `mobilize/[id].tsx:689`: after any approve error, "needs review" sticks for the life of the sheet.
- U10 `playbooks/[id].tsx:187`: first save of a new playbook refetches and can overwrite typing.
- U11: `key={index}` on removable cards (`simulate.tsx`, `observation-editor.tsx`).
- U12: the web map needs `/maplibre/maplibre-gl-worker.mjs`, gitignored and only copied by some scripts; plain
  `expo start --web` gives a blank map.
- U13: most of the diff is quote-style reformatting (`commands.ts`, `candidates.ts`, `domain.ts`, `hooks.ts`,
  `task/[id].tsx`, …). That's what makes the merge hard.

## Merging with the uncommitted work on typed-sends-straight

22 files overlap. The hard parts:

- **Reformatting.** Chien's branch rewrote the shared files to double quotes, one item per line. `commands.ts`,
  `candidates.ts`, `domain.ts`, `batch.ts`, both `rows.ts`, `world.ts`, `scheduler.ts`, `lifecycle.ts` conflict on
  nearly every hunk.
- **`Task.helperIds` → `Task.helpers: HelperAssignment[]`** plus `requiredCount`. The new picker, roster code,
  `bench-pick.ts` and tests read `task.helperIds`. `Proposal.helperIds` stays.
- **Deleted files still imported.** `heuristics.ts` and `respond-words.ts` are imported by `commands.ts`,
  `models/interpreter.ts`, `models/venue.ts`, `http/commands.ts`, `data/repo.ts`, and `predict/validate.ts` (that last
  one only shows at typecheck). Point them at `@/lib/ai`, and drop `interpretHeuristic` and its tests.
- **Picker vs `canHelp`.** The nearest lane is cross-team, `canHelp` is team-locked, so `approve()` with the picker's
  helpers can throw. `sendHelpers` and `place()` both send "Help X", so helpers get it twice. `interpret()` only lets a
  helper say "done", so they can't accept or decline by voice. The approve sheet pre-ticks `proposal.helperIds`,
  skipping dd90e48's `joins()` check.
- **Models.** Only `CallOptions` in `models/index.ts` (Chien's `timeoutMs`/`maxTokens`/`onAttempt` + `cloud`) and
  `interpreter.ts`. Chien's extra retries in `http.ts` change fixture counts in the intake/picker failure tests.
- **Migrations.** No table overlap. Chien's 110000-110400 sort before roster 120000/130000. If roster is already
  pushed to Spark, `db push` will refuse the earlier dates again (the 231d694 problem): check `supabase migration list`
  first.

Order:
1. Commit typed-sends-straight as it is.
2. `git merge chien-fixes`.
3. Take Chien's side for `commands`, `candidates`, `domain`, `batch`, `rows`×2, `world`, `scheduler`, `lifecycle` and
   re-apply ours by hand. Take ours for `interpreter`, `venue`, `intake-tools` and re-apply his. Combine `CallOptions`.
4. `rg "heuristics|respond-words|\.helperIds"` until clean.
5. The picker fixes: `canHelp` (team rule relaxed) in `rerank`, drop `sendHelpers`, helper accept/decline in
   `interpret()`.
6. `db reset`, `db:types` (don't hand-merge `database.types.ts`).
7. Fixtures, then tsc, lint, vitest, `commands:check`.
8. D1-D4, U1, S1 before the lost-child work starts.
