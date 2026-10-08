# Playthrough: rehearsal checklist

Every role, every screen, every flow, in an order you can run top to bottom before demo day. Each line is one thing
to do and what should happen. Tick it, or write down what lagged or broke. The stage script is `DEMO.md`.

Nothing here is mocked. Positions come from the joystick (**Testing tools** at the top right of every map →
**Joystick**, then a place), the storm from `npm run simulate`. Team and priority are the AI's call: where a step
says "P2", the AI may read it differently, and the step says what happens either way when it matters.

## Accounts

Crew sign in with **Crew** → email → **Sign in**: no code, no email sent. Festival-goers tap **I'm at the festival**
(an anonymous session). To be someone else: **Testing tools** → **Sign out**.

| Who | Email | Role | Team | Posted at |
| --- | --- | --- | --- | --- |
| Mo | `mo@moloop.test` | Coordinator | | Info |
| Jordan Lee | `jordan@moloop.test` | Lead | First Aid & Heat | First Aid |
| Sam Okafor | `sam@moloop.test` | Lead | Tech & Logistics | Supplies |
| Georgia Martin | `georgia.martin@moloop.test` | Lead | Welfare & Lost Kids | Info |
| Theo Mensah | `theo.mensah@moloop.test` | Lead | Crowd & Gates | Artist Gate |
| Priya Shah | `priya@moloop.test` | Volunteer | First Aid & Heat | Oval Stage |
| Tom Becker | `tom@moloop.test` | Volunteer | First Aid & Heat | Track Stage |
| Linh Tran | `linh@moloop.test` | Volunteer | Welfare & Lost Kids | Food Alley |
| Kai Walker | `kai@moloop.test` | Volunteer | Crowd & Gates | VIP Gate |
| Festival-goer | none | Guest | | |

Priya holds a first aid cert and speaks Hindi; Tom a first aid cert; Linh a WWCC and Vietnamese; Kai crowd control.
The other leads (Sienna Young, Security; Eli Parker, Info; Yasmin Tran, Artists; Harry Parker, Vendors) and about 300
volunteers come from the generated crew (`scripts/gen-crew.ts`), rostered for Saturday 10 and Sunday 11 October in
three blocks: 10am–2pm, 2pm–6pm, 6pm–11pm.

Devices: a laptop for the server and Mo's console, and three phones with the dev build (festival-goer, Priya, Jordan).
Tom, Linh and Kai can share a phone by signing out and in. Push needs physical phones.

## Reset to a clean world

- [ ] Local: `supabase db reset`. Migrations and `seed.sql` bring back teams, zones, the crew and the roster.
      `bun scripts/seed.ts` is only needed for a different `crew.json`.
- [ ] Spark: `supabase db push` against it for new migrations. For a clean world, `supabase db reset` against it:
      that wipes the day's tasks, requests and plans, and also every session and push token.
- [ ] Restart the server.
- [ ] Every device: **Testing tools** → **Sign out**, then sign in again. Accounts get new ids on a reset, so old
      sessions don't work.
- [ ] Volunteers start off shift; leads and Mo start on duty. The cast tap **Back on duty** when a step needs them.
      The rest of the crew stays off until the mobilization section.

## Start

- [ ] Server: `npm run server` (local: it checks Docker, starts the stack, applies migrations). Against the Spark:
      `bun src/server/main.ts` with the Spark's env. `curl <server>/health` shows `"ok":true`, the timings and
      `"briefs":true`.
- [ ] Mo's console: `npm run web`, open `http://localhost:8081` at least 1000 px wide: tabs in a left column, the map
      beside them.
- [ ] Phones: `npm start` for Metro, the dev build on each phone. `EXPO_PUBLIC_SERVER_URL` is the laptop's LAN
      address (or the Spark's), not `127.0.0.1`.
- [ ] Fast timings, for the nudge and bump checks only: `POLICY_SCALE=0.1 POLICY_AUTO_ASSIGN_MS=30000 npm run server`.
      Ack 12 s, nudge gap 18 s, ETA P1 24 s / P2 1 min / P3 2 min, bump to Mo P1 6 s / P2 12 s / P3 18 s. Restart on
      real timings afterwards.

## Automated checks

Run these first, while the generated crew is still off shift: they bring their own people and expect assignment to
land on them.

- [ ] `npm test`, `npx tsc --noEmit`, `npm run lint`.
- [ ] `npm run db:check` (RLS per role) and `npm run repo:check` (snapshots, realtime, command shapes).
- [ ] `npm run commands:check` against `POLICY_SCALE=0.05 POLICY_AUTO_ASSIGN_MS=3000 SCHEDULER_MS=0 npm run server`.
- [ ] `npm run presence:check` against `PORT=8788 SCHEDULER_MS=0 bun src/server/main.ts`, with
      `SERVER_URL=http://127.0.0.1:8788`.
- [ ] `npm run models:check` and `npm run voice:check` (live models, real timings).
- [ ] `npm run mobilization:check`, `mobilization-observations:check`, `mobilization-commands:check`,
      `mobilization-status:check`.

## Part 1: every screen, by role

### Sign-in

- [ ] Open the app signed out: the wordmark, "Everyone in the loop", **Crew** and **I'm at the festival**.
- [ ] **Crew**, type `nobody@moloop.test`, **Sign in**: "No crew account for that email".
- [ ] **Crew**, `priya@moloop.test`: the staff map. `jordan@moloop.test`: the same, with **My task** / **Team** on
      the sheet. `mo@moloop.test` on the laptop: **Needs action**. On a phone Mo gets four tabs: **Needs action**,
      **Tasks**, **Crew**, **Map**.
- [ ] **I'm at the festival**: the Ask screen.

### Festival-goer

- [ ] Ask: the site map; the place chip top left ("Set location" without a position); **Testing tools** top right; the
      bar "Hold to talk" with the keyboard button; "Ask or report" when typing.
- [ ] **Testing tools** → **Joystick** → **Water 2**: your dot at Water 2, the chip says "Near me", a joystick
      appears. Drag it: the dot walks.
- [ ] The place chip opens "Near me" and every place by name. Pick one, then **Near me** again.
- [ ] Hold the bar and speak (first hold asks for the mic): "Listening", then what was heard with **Send**, and
      the round button to try again. A tap shorter than about half a second, or silence, sends nothing.

### Volunteer (Priya)

- [ ] Top: the duty chip (first name, "On duty" or "On break"), **Testing tools**, **Inbox**.
- [ ] Off shift or on a break: the sheet says "On break" and **Back on duty** sits under it. Tap it: "On duty", the
      sheet says "Free".
- [ ] The chip opens the shift panel: team name, **Take a break** / **Back on duty**. Tap outside to close.
- [ ] The dock says "Report something" when free, "Accept or decline" with a new task, "Update your task" once on it.
- [ ] **Inbox**: "Nothing yet." when empty; **Read all** once there's something.
- [ ] **Testing tools** → **Joystick** → **Toilets East**. Pins don't survive closing the app: set them again after a
      restart.

### Team lead (Jordan)

- [ ] **My task** is the volunteer's screen. **Team** shows the team on the map and, in the sheet, the one thing that
      needs Jordan most with its button, then **Needs you**, **People** and **Open tasks** when pulled up. The Team
      switch carries a count.
- [ ] People rows: "Free · Oval Stage", "On break", "Off shift", "<task> · N min".
- [ ] Tap a person (row or map dot): their sheet with status, **Call** (greyed: no phone numbers in the crew data),
      **Message**, **Assign**, what they're on with **Timeline**, and **Up next**.
- [ ] Tap an open task's pin: the approve sheet if one is waiting, the picker if nobody has it, else the task page.

### Mo (console)

- [ ] **Needs action**: "All clear" and the on-duty count when nothing waits; otherwise "Waiting on you", and "Yours"
      above it whenever Mo is on a task. The tab badge counts what waits.
- [ ] **Tasks**: team pills, **All** / **Open** / **Active** / **Done** with counts, the shift summary on top
      ("Summarising the shift…" first). A row opens the task page: priority in the title, the task's own summary, the
      full log, **Message** (the person on it, **Festival-goer**), **Where**, **Assigned to**.
- [ ] **Crew**: pills (All, then each team with its count). Under All each team folds from its head, and a folded team
      shows a red dot when someone in it asked for help. Pick a team: who leads it, counts for on duty, on a task, free,
      on break, then its people and open tasks.
- [ ] The pill picked in Crew is the one on Tasks and on the map.
- [ ] The map: dots for the crew, pins for open tasks. On a phone it's the **Map** tab, with the pills floating over.
- [ ] The dock: "Report something".

## Part 2: flows

Set up for this part: Priya, Tom, Linh and Kai on duty (**Back on duty**). Pins: Priya **Toilets East**, Tom
**Track Stage**, festival-goer **Water 2**. The rest of the crew off shift, so assignment lands on the cast.

### Intake and triage

- [ ] **Question.** Festival-goer: "Where are the nearest toilets to the Oval Stage?" → "Understanding…" → "Answered":
      Toilets East, by the tennis courts. "Problem solved?" **Yes**: back to Ask. No task anywhere.
- [ ] **Not solved.** Ask "When's the next act on?", then **No**: the box comes back ("What's changed?", with ×).
      Add "I need to talk to someone". The AI answers again or sends someone.
- [ ] **Another language.** "¿Dónde puedo rellenar mi botella de agua?": the answer comes back in Spanish.
- [ ] **Report, P2.** "My friend feels really dizzy and faint, we're by Water 2" → "Finding someone…". Jordan:
      "Needs you" push "Approve: …" and an approval row with a countdown. Mo: no row (Mo gets P1 approvals), but a pin
      at Water 2 on the map.
- [ ] **Report, P1.** "A man's collapsed by Food Alley and he isn't responding": Mo and Jordan both get "Approve: …",
      and it's the top of Mo's Needs action, "Approve Priya · 24 s" or whoever the AI picked.
- [ ] **Report, P3.** "Can someone bring a plaster to Water 2, I've got a blister": straight to the top pick, no
      approval. Festival-goer: "Matched with …".
- [ ] **Report in Spanish.** "Mi amiga está mareada cerca de Water 2": staff read it in English under "Translated from
      Spanish"; tap the quote for the original.
- [ ] **Volunteer report.** Linh, dock: "Spill by the Bar, someone's going to slip" → "Report sent". Linh's inbox: "Your
      report "…" went to …". The task goes straight to a teammate, no approval. Nobody on duty in that team: "A lead
      will pick it up", and it waits in the lead's Needs you.
- [ ] **Second report about the same thing.** With the Water 2 task open, Tom reports "The woman at Water 2 has passed
      out" → "Added to "…"". Worse: the priority goes up, the person on it hears "Update: …", the lead (and Mo at P1)
      gets "Worse: … Now P1. Send backup?".
- [ ] **Needs a decision first.** A volunteer report a volunteer mustn't act on alone (a whole-event call, e.g. "Should
      we stop letting people in at the Main Entrance? It's packed"): if the AI escalates it, the task is held, status
      "Needs Mo's call" or "Needs a lead's call", and its sheet opens on "Why the AI escalated it".

### Assignment, accept, decline

- [ ] **Approve.** Jordan opens the approval: the pick, a one-line why, "Auto-assigns in N s", **Approve Priya**, and
      "Who goes". Tick a second person: **Send 2**; the second gets "Help Priya: …" and must **Accept** before **Done**. Untick
      the pick and tick another: **Send <name>**.
- [ ] **Auto-assign.** Leave one alone: at 0 s "Assigning", then it's placed; the log says "auto-assigned, no approval
      in 30 s".
- [ ] **New task.** Priya: spoken if the app is open ("New task: …"), status "New task", **Accept** and **Decline**.
      Festival-goer: "Matched with Priya", her dot, her team.
- [ ] **Accept.** "On it · 0 min", the walk in minutes, **Directions**. Festival-goer: "Priya is coming", the minutes
      boxed. Say "on my way" into the dock instead: "Sent "Accept"".
- [ ] **Directions.** The route, minutes, **Show whole site** / **Zoom to route**, the next reply, **Back to task**.
- [ ] **Busy.** Give Priya a second task while she's on one: "Up next" for her, "Matched with Priya" with "Finishing a
      task" for that festival-goer. Done on the first brings the second up, spoken.
- [ ] **Decline.** Tom gets a task, **Decline**: it's back in the pool, Jordan gets "Tom declined: …" and an
      **Assign** row. The picker never offers Tom for it again.
- [ ] **Assign by hand.** Jordan: **Assign** → "Assign" sheet, suggested first, "Busy" chips. Tap someone: assigned.
      With everyone off: "No one on duty".
- [ ] **Assign from a person.** Jordan → Tom's sheet → **Assign** → pick an open task.
- [ ] **Done.** **Done** → "What did you do?" → type → **Mark done** (needs a few words). Festival-goer: "Sorted", with
      **Still need help?** and **Done**.
- [ ] **Reopen.** **Still need help?**: the task opens again and goes back to the same volunteer if they're on duty.
- [ ] **Cancel.** Festival-goer with someone coming: **Cancel request** → **Cancel request**. The volunteer gets
      "Cancelled by the festival-goer: …" and is free.

### Help and escalation

- [ ] **Need help.** Priya on an accepted task: **Need help** → "What's going on?" (optional) → **Ask for help**.
      Priya: "Asked Jordan for help · 0 min" in red. Jordan: "Needs you" push "Priya asked for help: …", and
      **Respond**.
- [ ] **Respond.** The map with what she said on top; **Backup**, **Call**, **Hand over**, **More** (**Reassign**,
      **Close**, **Pass to Mo**, **Message Priya**, **Message festival-goer**). Hold the dock and say what to do: the AI
      does it.
- [ ] **Backup.** **Backup** → pick Tom → **Send Tom**. Tom: "Help Priya: …", spoken; he's on it as backup, with
      **Done**. Priya: "Tom joining · ~N min" and "Tom is joining you." Done from either closes it for both.
- [ ] **Hand over.** **Hand over** → **First Aid medics**. Festival-goer and Priya: "Medics on the way". Jordan's row
      gets **Arrived**: tap it, the task closes as handed over, Priya is free.
- [ ] **Emergency services.** **Hand over** → **Emergency services**: hold to confirm it was called. The app never
      calls 000 itself.
- [ ] **Call.** Records the call; Priya sees "Jordan is calling you". No dialer opens: crew have no phone numbers.
      Then **Carry on**.
- [ ] **Reassign.** **More** → **Reassign** → pick: the new person gets it, Priya is freed.
- [ ] **Close.** **More** → **Close** → **Close task** (reason optional): cancelled.
- [ ] **Bump to Mo.** Ask for help and leave it: after 1 / 2 / 3 min (P1 / P2 / P3) Mo gets "Priya asked for help: …"
      in Needs action, Jordan gets "Passed to Mo: …", Priya reads "Asked Mo for help". Jordan still sees it.
- [ ] **Pass to Mo.** Jordan: **More** → **Pass to Mo**: same, straight away.

### Nudges for quiet volunteers (fast timings)

- [ ] **Not accepted, P2/P3.** Assign Tom and don't touch it: after the ack timeout, push "Check-in": "New task
      waiting: "…". Can you take it?" After the gap: Tom "Your team lead has been alerted about …", Jordan "Tom went
      quiet: …", a "Quiet · N min" row. **Respond** offers **Call**, **Reassign**, **They're fine**.
- [ ] **Not accepted, P1.** No nudge: straight to the lead.
- [ ] **Past the ETA.** Accept, then wait: "Send an update" in amber; tap it → "How's it going?" → **Send update** adds
      time (5 minutes on real timings). Left again: "Jordan asked for an update".
- [ ] **Silent helper.** Approve with a second person ticked and let them ignore it: after ack + gap they're released,
      and Jordan gets "<name> didn't answer: … Released."
- [ ] Silence never closes a task.

### Replies and messaging

- [ ] **Volunteer to festival-goer.** Priya on a festival-goer's task, dock: "Tell her I'm two minutes away" → "Sent to
      the festival-goer". Or the task page → **Reply** → **Send reply**. The festival-goer's thread shows it under
      "Priya S.".
- [ ] **Festival-goer detail.** "What's changed?": "She's sitting up now" → "Note added.", and Priya gets "Update: …"
      (from "Festival-goer"). "She's fainted again" → "Lead alerted.", priority up, Jordan "Worse: … Now P1."
- [ ] **Lead to the crew on a task.** Task page → **Message** → Priya's name → "Message Priya" → **Send**: spoken on
      her phone, a line in the log.
- [ ] **Lead to the festival-goer.** Task page → **Festival-goer** → **Send reply**: in their thread; Priya gets "To
      the festival-goer: "…"".
- [ ] **Lead to one person.** Person sheet → **Message** → **Send**.
- [ ] **Inbox.** Rows say who from ("Needs you", "Check-in", "Backup", "Moved", "Closed", "Handed over", or a name),
      and "Read aloud" or "Pinged (you were busy)". **Read all** clears the badge.

### Roster, shifts and reminders

- [ ] Crew tab: each team's count, its lead ("Led by …" opens their sheet), the split of on duty, on a task, free, on
      break.
- [ ] Off shift or on a break gets no tasks: put Tom on **Take a break**, report something at the Track Stage, it
      doesn't go to him.
- [ ] **Reminder and no-show.** On the rostered weekend this happens on its own. Before it, make Tom a shift that
      started 14 minutes ago (rehearsal data, gone on the next reset):

      ```sql
      with s as (
        insert into shifts (team_id, starts_at, ends_at)
        select id, now() - interval '14 minutes', now() + interval '6 minutes' from teams where slug = 'first-aid'
        returning id
      )
      insert into shift_assignments (shift_id, volunteer_id)
      select s.id, u.id from s, auth.users u where u.email = 'tom@moloop.test';
      ```

      With Tom on a break: "Shift at …: First Aid & Heat till …. Go on duty when you're there." on the next pass, then a
      minute later Jordan gets "Tom Becker not in for …" with who's free to cover.
- [ ] **Check in.** Tom: **Back on duty**: checked into the shift, no more no-show alerts.
- [ ] **Shift end.** At the end, if he's not on a task: off shift, and "Shift done. Thanks, Tom!" in his inbox (no push).
      On a task: he finishes it first.

### Map and presence

- [ ] Priya on duty with a pin: her dot on Jordan's team map and Mo's map within about a second. Drag the joystick:
      it glides.
- [ ] Priya **Testing tools** → **GPS**: in the hall that's off the site, so her dot fades after a minute and routes
      fall back to her zone.
- [ ] Leads see their team; Mo sees everyone. Dots ring when on a task and go red when they asked for help. Markers in
      one place fan out.
- [ ] Festival-goer with someone coming: the walk counts down; "Priya is here" within about 12 m.
- [ ] Priya's route ends at the festival-goer's dot when they're near what they reported, else at the place.
- [ ] Nearest wins: with Priya pinned at Toilets East and Tom at Track Stage, a first aid report at Water 2 goes to
      Priya.
- [ ] **Find.** The festival-goer taps **Find** next to who's coming: full-screen finder, "Searching…", and Priya gets
      "… turned on Find" (or "They're looking for you") with **Find**. Pins within about 30 m: "You're close to …".
      Both open: "Nearby", "Getting closer", "Very close", "Here". Needs Bluetooth on both phones.

### Mobilization

Set up: the crew on duty, so plans have people to staff them:
`psql "$DATABASE_URL" -c "update profiles set status = 'active' where role = 'volunteer'"`. Reload the console.

- [ ] **Readings (T3).** `npm run simulate -- --fast`. Terminal: wind 35, 45, 55, two reports, wind 72 "(limit 60)",
      "planner started by …", "plan for Mo: …", "done: …". Mo: a badge on Needs action and a row with the plan's
      title, "Needs approval", "N tasks · N teams".
- [ ] **Review.** Tap the row: "Needs approval" over the title, one line per cause ("Wind 72 km/h at Oval Stage (limit
      60 km/h), …", the reports), one row per task (team, people, from where). A row opens its instructions, and "At …"
      when it's somewhere else. "N short. Will keep trying." when a team hasn't enough free. No ids, no raw times.
- [ ] **Approve.** **Approve**: each row "0 of N confirmed", the plan's line "0 of N tasks done" with who's still to
      reply. New tasks in Tasks; crew get "New task: …", spoken and pushed. A task's sheet shows its instructions, "N of
      M people committed" and any required skills. **Open task** in the review goes to it.
- [ ] **Run it again.** `npm run simulate -- --fast` while it's active: "storm plan already active at Oval Stage: new
      causes add to it", and no second plan.
- [ ] **Decline a step.** Sign in as someone on a storm task (generated crew are `first.last@moloop.test`) and
      **Decline**: an accepted helper takes over, or the step is staffed again.
- [ ] **Stand down.** **Stand down** → **Confirm stand down**: open tasks cancelled, crew get "Stood down: …" and are
      free.
- [ ] **Dismiss.** Run it again for a new plan, **Dismiss** → **Confirm dismiss**: it leaves Needs action. Run it
      again: "storm plan dismissed at Oval Stage: the wind stays quiet until …". The wind starts nothing for 15
      minutes (a P1 report naming the storm still can), and after 3 minutes the simulator gives up.
- [ ] **Mo says so (T4).** Mo's dock: "Storm coming in at the Oval Stage, wind's way up and the truss is moving". When
      intake names the storm playbook: a plan for Mo, even inside a dismissal's quiet.
- [ ] **A serious report (T1).** Kai: "People are getting crushed against the barrier at the Track Stage, kids are
      screaming": a crowd surge plan for the Track Stage.
- [ ] **Reports adding up (T2).** Three ordinary reports from one place within 10 minutes: one check by the model, at
      most one plan. Two reports don't ask.
- [ ] **Not Mo.** Leads never see a plan in Needs you, and only Mo can approve, dismiss or stand down.

### Push (physical phones, app in the background or locked)

- [ ] The first sign-in as a lead or Mo asks for notifications; a volunteer is asked on going on duty; a festival-goer
      after filing a request (nothing is pushed to festival-goers yet).
- [ ] Locked, Priya gets: a new task ("New task", sound), backup ("Backup"), a nudge ("Check-in"), a message (the
      sender's name), a festival-goer's detail ("Festival-goer"). Moved or closed arrive without sound.
- [ ] Locked, Jordan gets approvals, help, went quiet and worse, all as "Needs you".
- [ ] Tapping a push opens its task, or the inbox when there's no task, and marks it read.
- [ ] App open: no banner. The inbox has it, and a new task is spoken.
- [ ] Your own actions don't push you ("Declined: …", "Asked Jordan for help: …", "Shift done").
- [ ] **Sign out**, then send that person something: no push.
