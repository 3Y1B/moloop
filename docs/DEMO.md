# Demo day: stage script

About five and a half minutes in a uni hall. The festival is at Birrarung Marr, the terraced park on the Yarra (the
Birrarung) next to Fed Square. Everything runs on the real pipeline: the server, the models, the scheduler, Supabase,
push. Two things are simulated, because the hall isn't the park:

- **Positions.** Phones set where they are with the joystick (**Testing tools** at the top right of every map →
  **Joystick**). The position goes to the server like a GPS fix.
- **The storm.** `npm run simulate` (`scripts/simulate.ts`) writes the Lawn Stage's wind readings and files two
  reports as volunteers posted there. Triggers, planner and approval are the real ones.

The walk-through for every screen is in `PLAYTHROUGH.md`. This is only what happens on stage.

## Before you go on

### What runs where

| Device | Runs | Signed in as |
| --- | --- | --- |
| Laptop, on the projector | The server, Mo's console in a browser at least 1000 px wide (list on the left, map on the right), and a terminal for the simulator beside it | Mo, `mo@moloop.test` |
| Phone 1, mirrored | Dev build | Festival-goer: **I'm at the festival** |
| Phone 2, mirrored, a physical iPhone | Dev build, notifications allowed | Priya Shah, `priya@moloop.test` (First Aid) |
| Phone 3, in hand, optional | Dev build | Jordan Lee, `jordan@moloop.test` (First Aid lead) |

Crew sign in with **Crew** → email → **Sign in**. No code, no email: the server checks the address is crew.

### Env

- **Server:** `SUPABASE_URL`, `SUPABASE_SECRET_KEY`, `DATABASE_URL`, `OPENAI_API_KEY` (`.env.example`). The planner
  only runs on OpenAI, so the key is needed even with `MODEL_PROVIDER=spark`. No `POLICY_*` and no `SCHEDULER_MS`:
  real timings, so an approval waits 30 s.
- **Phones and the console:** `EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY`,
  `EXPO_PUBLIC_SERVER_URL`, all pointing at the same Supabase and server. On a phone the server URL is the laptop's
  LAN address or the Spark's, never `127.0.0.1`.
- **Simulator:** `SUPABASE_URL`, `SUPABASE_SECRET_KEY`, `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, and `SERVER_URL` if
  the server isn't on `http://127.0.0.1:8787`.

`npm run server` and `npm start` first check the local Supabase stack (Docker). Against the Spark, run
`bun src/server/main.ts` and `npm run web` instead.

### Checklist

Rehearse once earlier with `npm run simulate -- --fast` (a step every 2 s). Then reset and do this list again: a
rehearsal's storm plan left open would take the stage run's readings as its own.

- [ ] Clean world (`PLAYTHROUGH.md`, "Reset to a clean world"). Every device signs in again after a reset.
- [ ] Crew on duty. The rostered crew aren't in the hall, so put them on:
      `psql "$DATABASE_URL" -c "update profiles set status = 'active' where role = 'volunteer'"`. Reload the console.
- [ ] Server up. `curl <server>/health` shows `"ok":true`, `"autoAssignMs":30000` and `"briefs":true`.
- [ ] Console: Mo lands on **Needs action**, which says "All clear" with about 300 on duty. The map shows the crew.
- [ ] Priya: chip says "On duty" (else **Back on duty**). **Testing tools** → **Joystick** → **Toilets East**. No
      First Aid volunteer is posted there, so she's the nearest one to Water 2. Ringer and volume up.
- [ ] Festival-goer: **Testing tools** → **Joystick** → **Water 2**. The place chip says "Near me".
- [ ] Jordan, if used: signed in, phone face down. Don't approve anything on it.
- [ ] Terminal open in the repo, `npm run simulate` typed and not run.
- [ ] Phones mirrored, battery packs on, Do Not Disturb off on Priya's phone.

## Run of show

### 1. Mo (0:00–0:20)

- **Screen:** laptop, Needs action and the map.
- **Say:** "This is Mo. Three hundred volunteers, one coordinator. Right now, nothing needs him."
- **Do:** nothing.
- **They see:** "All clear", the on-duty count, the crew as dots along the river.
- **If it doesn't:** rows waiting means the world wasn't reset. Say "left over from rehearsal" and go on.

### 2. A question the AI answers (0:20–1:00)

- **Screen:** Phone 1.
- **Say:** "I'm at the festival. I don't know anyone here. I just ask."
- **Do:** tap the keyboard button on the bar, type "Where are the nearest toilets to the Lawn Stage?", **Send**.
- **They see:** the request page goes "Understanding…" to "Answered": Toilets East, on the riverside path near
  The Grove. Then
  "Problem solved?" Tap **Yes**.
- **Say:** "No volunteer was bothered. Mo's screen didn't move."
- **If it doesn't:** "Finding someone…" means the AI sent a person (it never answers when it isn't sure). Say "it
  played it safe", tap **Cancel request** twice, go on. Stuck on "Understanding" past 15 s: the model is down; check
  the server log and skip to 3.

### 3. A report, triaged and matched (1:00–2:00)

- **Screen:** Phone 1, then the laptop. Priya's phone on the projector, locked.
- **Say:** "Now something real."
- **Do:** back on Ask, type "My friend feels really dizzy and faint, we're by Water 2", **Send**. Lock Priya's phone
  now: her position was fresh when the report was ranked.
- **They see:** Phone 1: "Understanding…" then "Finding someone…". The laptop: a new pin at Water 2.
- **Say:** "The AI read it: First Aid, how urgent, where. It picked who should go: the nearest first aider who's free.
  Mo gets thirty seconds to say yes."
- **Do (laptop):** tap the pin at Water 2. If the AI read it as P1 it's also the top row of Needs action, "Approve
  Priya · 24 s"; tap that.
- **They see:** the approve sheet: Priya Shah, a one-line why, "Auto-assigns in 21 s".
  Tap **Approve Priya**.
- **They see:** Priya's locked phone lights up: "New task", with the task's title. Phone 1: "Matched with Priya" and
  her dot.
- **If it doesn't:**
  - The pick isn't Priya: under "Who goes", tap the pick to untick it, tap Priya; the button says **Send Priya**.
  - Mo is too slow: at 0 s it says "Assigning" and sends the top pick anyway. Say "it doesn't wait for Mo".
  - No banner: unlock. The task is on her screen anyway. Push needs a physical phone with notifications allowed.

### 4. Priya accepts and walks over (2:00–2:45)

- **Screen:** Priya's phone, then Phone 1.
- **Do:** tap the banner (it opens the task), **Accept**. Back on the map, tap **Directions**. Drag the joystick toward
  Water 2.
- **They see:** Priya: "On it", the route and the minutes. Phone 1: "Priya is coming", the minutes in a box, her dot moving
  closer, then "Priya is here" within about 12 m. The laptop: her dot moving on Mo's map.
- **Say:** "Her phone tells her where. Mine tells me who, and how far."
- **If it doesn't:** the dot doesn't move: check Priya is "On duty" and the joystick is on; **Testing tools** →
  **Water 2** puts her there. A "You're close to Priya" banner may drop in on Phone 1: tap **Not now**.

### 5. It gets worse (2:45–3:20)

- **Screen:** Phone 1, then Priya's phone (and Jordan's).
- **Do:** tap the keyboard button on "What's changed?", type "She's fainted, she's on the ground now", send.
- **They see:** Phone 1: "Lead alerted." Priya: the task goes up to P1, with "Festival-goer says it's worse. Now P1"
  in its log and the update in her inbox. Jordan's phone: "Needs you": "Worse: … Now P1." Mo's task row turns P1.
- **Say:** "Nobody pressed an 'it's worse' button. The AI read it, raised it, and told her lead."
- **If it doesn't:** "Note added." means the AI didn't read it as worse. Say it plainer: "She's collapsed and isn't
  responding."

### 6. Done (3:20–3:40)

- **Screen:** Priya's phone, then Phone 1.
- **Do:** **Done** → type "Sat her down with water, medics have her" → **Mark done**.
- **They see:** Phone 1: "Sorted", with **Still need help?** and **Done**. Tap **Done**. Mo's task row: Done.
- **Say:** "No stars, no survey. Just 'still need help?' in case we closed it too early."

### 7. The storm (3:40–5:30)

- **Screen:** laptop: the terminal beside Mo's console.
- **Say:** "That's one person. Now the whole site. Eight thousand people on the lawn, the river along one side, and
  the lower terrace right on the water. The Lawn Stage has a wind sensor. It's simulated today, and so are two
  volunteers standing at the stage. Everything after that is real."
- **Do:** run `npm run simulate` (a step every 20 s).
- **They see, in the terminal:** wind 35, 45, 55 km/h at Lawn Stage, then two volunteers' reports ("Report sent", or
  "Added to …" when the second joins the first), then wind 72 km/h "(limit 60)". In Mo's **Tasks** tab, the reports
  come in as tasks at the Lawn Stage, already sent to teammates.
- **Say, while it runs:** "Under 60, nothing happens. Nobody's guessing in the background. Two reports from the
  stage. Over 60: the storm playbook fires. It was written before the festival, calmly. Now the planner reads it
  against who's on duty and where."
- **They see:** the terminal says "plan for Mo". Needs action gets a badge and a row with the plan's title, "Needs
  approval", and how many tasks and teams. The plan can come at a report, before the limit; then the 72 adds to it
  ("+1 cause" in the terminal).
- **Do:** tap the row.
- **They see:** the review: the title, one line per cause ("Wind 72 km/h at Lawn Stage (limit 60 km/h), just now",
  the reports), one row per task with its team, how many people and from where. Tap a row to show its instructions.
  "N short. Will keep trying." if a team hasn't enough free.
- **Say, pointing at the rows the plan has:** "Get people off the lower terrace and back from the river edge and the
  Landing pier. Two roofs: ArtPlay by the Main Entrance, and the Grove Stage marquee at the east end. And keep the
  crowd off the bridge landings: both bridges are barricaded, and a crowd running for the trams will push at them. One
  screen. Mo doesn't brief eight teams one by one. He approves once."
  The model writes the rows, so say only what's there.
- **Do:** **Approve**.
- **They see:** the rows switch to "0 of N confirmed", the plan's line to "0 of N tasks done" and how many are still
  to reply, new tasks in Tasks, dots on the map ringed as people get them. Each volunteer picked gets the task on their
  phone, read out and pushed.
- **If it doesn't:**
  - The terminal says "planner failed", or "no storm plan with the wind limit yet" after 3 minutes: say "the planner
    is slow today", show the terminal, run it again. A plan already open takes the new readings; one that was made
    late shows up.
  - A crowd surge plan appears as well: the reports read as a crush. Review the storm one; **Dismiss** the other.
  - "Need two volunteers posted at Lawn Stage" or "No coordinator": the crew isn't loaded. Skip the beat.

### 8. Close (5:30–5:50)

- **Do (optional):** in the review, **Stand down** → **Confirm stand down**: open tasks are cancelled and everyone on
  them is freed.
- **Say:** "One person's question, one person's emergency, one storm. Same loop: someone says something, the AI works
  out who, a person decides, and nobody's left waiting."

## Things to know on the day

- Simulated crew never answer. Storm tasks they get go quiet after 2 minutes, and their leads get "went quiet". Stand
  down before taking questions, or ignore the inbox.
- A plan Mo dismisses keeps the same playbook and place quiet for 15 minutes. Don't dismiss the storm plan before the
  run.
- Spoken briefs play only while the app is open and the message is fresh and unread. Tapping the push marks it read.
- When the models fail, the server fails closed: the request goes to a person at P2, and the AI never answers it.
