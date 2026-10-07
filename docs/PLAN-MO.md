# Mo's console: plan

Today Mo gets the lead's screen: a map with a sheet that switches between **My task** and **Team**. That suits a volunteer, who has one task and a route to it. It doesn't suit Mo. Mo spends the shift scanning and comparing lists: the sheet covers half the screen and competes with the map for drags, the things only Mo can act on are buried in the Team tab, Mo can't see the crew by team, and there's nowhere to look back over what happened. Mo also works mostly from a laptop in the shed (web build).

Mo gets their own app: **bottom tabs** on a phone, and a **left column next to an always-visible map** on a laptop. Volunteers and leads keep the map-and-sheet screen as it is.

| Tab | What it's for |
| --- | --- |
| **Needs action** | Everything waiting on Mo, most urgent first. Opens by default, with a badge. |
| **Tasks** | Every task this shift: an AI summary at the top, filters, and each task's full history |
| **Crew** | Every team and its people, filtered with team pills, with the task each person is on |
| **Map** | The whole site, full screen, filtered with the same team pills |

On a laptop (1000 px and wider) there's no Map tab: the tabs become a left column of about 420 px, and the map fills the rest and is always visible. Every tab is a normal full-height scrolling list, so Mo never has to drag a sheet.

## 0. Shell

- A `(mo)` route group under `src/app/`, with a tabs layout. The root redirect sends `role === 'coordinator'` there and everyone else to `(staff)` as now. Check the Expo SDK 57 docs for the tabs API before building.
- The shared sheets (`respond`, `approve`, `assign`, `person`, `task`, `inbox`) stay where they are, so Mo opens the same ones a lead does.
- Along the top: Mo's duty chip and the Inbox, as on the staff screen. The "Report something" assistant pinned at the bottom stays too.
- Wide screens: a split layout (`useWindowDimensions`), with one `VenueMap` mounted for the whole session.

**Done when:** Mo signs in and lands on Needs action, while a lead signing in still gets the map and sheet.

## 1. Needs action

- The `useNeedsMe()` list: help requests passed up to Mo, P1 approvals with the auto-assign countdown, unassigned P1/P2 tasks, and handovers waiting on "Arrived". The rows and actions are the existing `NeedsRow`, which opens Approve, Assign or Respond.
- **Yours**, above that list, only when Mo has tasks: Mo's active task as a compact card, plus anything queued. When Mo is free, this section isn't shown.
- Empty: "All clear".
- Tab badge: the number of items.

**Files:** `src/app/(mo)/index.tsx`, `src/components/mo/needs-list.tsx`.

**Done when:** a lead passes a task to Mo, and it shows up at the top of Needs action with the badge, wherever Mo is in the app.

## 2. Crew, with team pills

- **Pills** across the top, scrolling sideways: **All**, then one per team in its colour with its icon and on-duty count ("First Aid 3"). Teams nobody is rostered on are hidden.
- **Team header**, once a team is picked: the team lead, then "3 on duty · 1 on a task · 1 free".
- **People:** one row each (`MemberRow`), with the task they're on as a second line: title, progress (`TaskProgress`), and its priority signal. Tapping the task line opens the task; tapping the rest opens the person.
- **Open tasks** for that team: unassigned and queued (`OpenTaskRow`).
- The chosen pill is shared with the Map tab and the laptop map, so the list and the map always agree.

**Data:** `useTeam(slug)` already takes a slug; All is `useCrew()`. Add `useTeamStats()` for the pill counts (on duty, on a task, free, per team), and a small store for the chosen pill.

**Files:** `src/app/(mo)/crew.tsx`, `src/components/mo/team-pills.tsx`, `src/components/mo/crew-list.tsx`.

**Done when:** Mo taps "Welfare", and both the list and the map show only Welfare's people and tasks, each person with the task they're on.

## 3. Tasks: the log

- Every task this shift, ordered by most recent activity.
- **Filters:** Open / Active / Done, plus the team pills.
- **Row:** priority signal, title, status line, then team · zone · "last: Priya replied, 2 min ago" (from the task's newest event).
- Header counts: "14 tasks · 3 open · 9 done".
- Tapping a row opens the task page (`src/app/task/[id].tsx`), which already has the full `Timeline`. It also gets a small map of the task's zone and the per-task AI summary (step 5).

**Data:** `useTaskLog(filter)` in `src/data/hooks.ts`: tasks joined with their last event, filtered and sorted. Mo's snapshot already holds every task and event, so the server doesn't change for this part.

**Files:** `src/app/(mo)/tasks.tsx`, `src/components/mo/log-row.tsx`.

**Done when:** Mo opens Tasks, filters to Done, opens the collapsed-person task, and can read every step from report to resolved.

## 4. Map

- A full-screen `VenueMap` with the crew and open-task markers (`useTeamMarkers`, already split out of the old `TeamMap`), and the team pills floating along the top.
- Tapping a person opens the person sheet, and tapping a task opens the right task sheet (`openTaskSheet`).
- On a laptop this is the right-hand map, not a tab.

**Files:** `src/app/(mo)/map.tsx`.

## 5. AI summary

Two places, both short and factual, so Mo can understand things at a glance:

- **Shift summary**, at the top of Tasks: one headline and up to three points. For example, "Busy at Food Alley: 2 P1s in 20 min, both handled. Welfare is stretched: 1 of 3 free." Each point links to the task or team it's about.
- **Task summary**, at the top of the task page: what happened, where it stands now, and what's still open. For example, "Priya reached him in 4 min; he's conscious, with medics on the way. Waiting on handover."

**Server:** a new `POST /api/summarize` route (who: `lead`) in `src/server/http/commands.ts`.
- Body: `{ scope: 'shift' } | { scope: 'task', taskId }`.
- The server reads the world itself (`read()`). The client never sends the content.
- It calls `generate()` (`src/server/models/index.ts`), so it uses OpenAI by default and the Spark first when that's turned on. The output schema is zod: `{ headline: string, points: { text, taskId?, teamSlug? }[] }`, with at most 3 points, English, facts only, and ids checked against the world before they're returned.
- **Cache** in memory, keyed by scope plus the newest event id. Opening Tasks again costs nothing, and a new summary is generated only after something has happened. Debounce the shift summary to at most one regeneration every 60 s.
- **Fails closed:** if the model is down or slow, the card shows plain counts built from the snapshot and no AI text.

**Client:** add `summarize(scope)` to `Repo` (`src/data/repo.ts`, `src/data/supabase-repo.ts`); add a `useSummary(scope)` hook that refetches when the newest event id changes; add `src/components/mo/summary-card.tsx` with a sparkles icon, the headline, the points as tappable rows, and "Updated 1 min ago".

**Done when:** after a P1 is reported, approved and resolved, the shift summary mentions it within a minute and tapping that point opens the task.

## 6. Reports in English

Titles and summaries are already English (the intake AI writes them that way). What isn't: the reporter's own words (`reports.raw_text`), which the task sheet and task card label "translated from Spanish" while showing the original, and a guest's follow-up detail, which goes into the summary ("Update: …"), the log and the inbox as typed.

- **Translate where the AI already reads the text.** The intake `create_task` tool returns `english` alongside `language`; the follow-up read (`DetailRead`) does the same. No extra model call.
- **Store it:** an `english_text` column on `reports` (migration), and `english` on `Reporter`. Follow-ups use the English in the summary, the log and the inbox, with the original kept as the event note.
- **For all staff:** English first, labelled "Translated from Spanish"; tapping the label shows the original ("Original, Spanish"). Names and places that don't translate stay readable.
- **Fails closed:** the heuristic fallback has no translation, so the original shows with no "translated" label. The label is only ever shown over a real translation.
- **The fallback's own titles:** `heuristicTriage` uses the raw text as title and summary and always says `language: 'en'`, so a Thai report made while the AI was down reached Mo's Needs action with a Thai title (seen 2026-10-08). It should say the language is unknown rather than English, and the row should show that it's untranslated.

**Done when:** a guest reports in Spanish, and Mo reads the quote in English on the task, can tap to see the Spanish, and a Spanish follow-up shows up in English in the summary and the inbox.

## Order

1. Shell and Needs action.
2. Crew with pills.
3. Tasks (the log).
4. Map tab, and the laptop split.
5. AI summary (server route, cache, card, task page).
6. Reports in English (after step 1; for every staff role).

Each step runs lint and typecheck, and is checked in the browser signed in as Mo (`mo@moloop.test`, code from local Mailpit), at phone and laptop widths.

## Also for leads and volunteers

The bottom sheet on the staff screen doesn't hold its position well. Two likely causes:
- `stop` resets its height on every tab switch: down to the lowest position on My task when free, and to the middle on Team.
- A quick flick can carry it past the middle position to the top or bottom.

Fix both once we've confirmed which one is felt on a phone.

## Open questions

1. Do leads get Tasks (the log) too, scoped to their team? It costs almost nothing once Mo's version exists.
2. Should the shift summary also be read out to Mo (TTS brief), or only shown?
3. Should summaries be kept (a `summaries` table) for after-the-event review, or are they in-memory only?

After this lands, update the "Coordinator (Mo) — later" section in `docs/SCREENS.md`.
