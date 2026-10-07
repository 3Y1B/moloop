# Who gets sent: the new ranking

## Context

For a P1/P2, the server proposes who to send and a lead or Mo approves. The old shortlist was `rankCandidates` in
`src/lib/candidates.ts`, a strict order: same team, then free, then the one certificate the category wants or the
reporter's language, then nearest. That order caused three problems:

- A busy teammate always beat a free, certified person from another team.
- One certificate per category. A panic attack never asks for mental health first aid; a hurt lost child only asks for WWCC.
- It knew nothing about people beyond those checks, so bios were only read at the final pick.

What we measured (`scripts/bench-pick.ts`, 300-person generated crew, 167 on duty at 3pm Saturday):

- **A yes/no per person, everyone** (`each`, `batch`): fast on OpenAI (1.4 s), but each person judged alone gets a
  yes if good enough. Nurses standing right there lost to an engineering student. The Spark can't take the burst (429s).
- **Bio scores, 10 per call × 3 shuffles** (what's built now): best of the bio methods, 39 calls.
- **One choice over everyone's full profile** (team, certs, languages, bio): 1 call. Alone it missed speakers. With the
  speaker slot below it matched the bio-score version on every case, at a tenth of the calls.

## The algorithm

```
report ──► intake agent ──► task + speaker_needed + first_aid_needed
                                   │
             free, on-duty volunteers (busy ones only if nobody's free)
                    │                                  │
   Qualified lane: OpenAI choice over full         Nearest lane: walk distance
   profiles, no distance, 3 shuffles averaged      only (code) → top 6
   → top 6
                    └───────────────┬──────────────────┘
                     taken in turn, nobody twice (≤ 12)
                     + the nearest speaker / first aider if neither lane has one
                                    │
              Final pick: "who's best" + "how many" (OpenAI, side by side)
                                    │
              Speaker and first-aid slots: if nobody being sent speaks the
              language / holds first aid, the best-placed one goes too
              (or replaces the last one nobody else depends on)
                                    │
                              lead / Mo approves
```

1. **Intake says the language.** `speaker_needed` on `create_task`/`escalate`: the report's own language if it
   isn't English, or one it names ("his wife only speaks Mandarin" → `zh`, "a lost Japanese tourist" → `ja`).
   Null for "the Korean BBQ stall". Stored on `reports.speaker_needed`, read as `Reporter.speakerNeeded`.
   `language` stays "written in", for replies and "translated from".
   **First-aid floor**, the same way: `first_aid_needed` (true for hurt, collapsed, very drunk, spiked, chest pain,
   bleeding, heat, seizure), on `reports.first_aid_needed`, read as `Reporter.firstAidNeeded`. Null or missing (no
   model said, older rows) falls back to the category: medical and heat want first aid.
2. **Qualified lane.** A `choice` over every free person, described as team, certificates held (in date),
   languages and bio. No distance, so the model judges fit, not position. Asked 3 times at once in shuffled order,
   probabilities averaged (step 5). Top 6. This replaces the category→certificate table, the bio scoring and the
   points for the shortlist.
3. **Nearest lane.** The 6 shortest walks (live GPS, else zone). No model.
4. **Merge.** One from each lane in turn, nobody twice. If the task needs a language and nobody listed speaks it,
   the nearest free speaker gets a seat of their own; the same for a first aider. Missing both, the nearest person
   with both takes one seat.
5. **Final pick.** Unchanged: "who's best" over the shortlist (which does see distance) and "how many" asked apart.
6. **Speaker and first-aid slots** (`withNeeded`). If nobody in the crew speaks the needed language, or nobody holds
   first aid when it's needed, the first in the model's order who does joins as one more person while the priority
   allows (P2 2, P1 3), otherwise in place of the last one who isn't the only speaker or first aider. One person who
   meets both is preferred.

Model calls per incident: intake (already ran) + 3 qualified (parallel) + 2 final = **5 new**, down from 41–43.

**Fallbacks.** All three qualified calls fail → the qualified lane is `rankCandidates`' order. One or two fail →
averaged over the rest. Final pick fails → the proposal keeps the rules' order and one person goes. A person
approves either way.

## Status

| Step | State |
| --- | --- |
| Intake `speaker_needed`, `reports.speaker_needed` migration, `Reporter.speakerNeeded` | Done; column on local DB only |
| Speaker seat in the shortlist, speaker slot in the crew (`withSpeaker`) | Done |
| First-aid floor: intake `first_aid_needed`, `reports.first_aid_needed` migration, seat + crew slot (`withNeeded`) | Done; migration not applied anywhere |
| Picker on OpenAI only (`decide(…, { cloud: true })`) | Done |
| `rankQualified` (3 shuffled calls averaged), `laneCandidates({ qualified })` | Done |
| Remove bio scoring and points | Done |
| `pick.ts`: `rankQualified` → `laneCandidates` → `pickCrew` → `rerank`; qualified run stored beside the pick run (`Owners.before`) | Done |
| Bench: `cases` A = rules only, B = real `rankQualified`; `stability` mode | Done |
| Stability (step 5) | Done; averaging didn't reach 4 of 6 either, see Results |
| Deploy (step 6) | **Not yet applied** |

## To do

### 1. Qualified lane (`src/server/models/picker.ts`)

- `profile(v, teams)`: "Name, Team. Holds: …. Speaks …. Bio." Like `describe`, without the `Now: free · 120 m` part.
- `rankQualified(task, people, teams): Promise<string[] | null>`: one `choice` ("Who is best qualified for this task:
  the certificates, team, languages and background it needs? Ignore where they are."), with the report and the
  reporter's words as state, `{ cloud: true }`. Ids by probability, the list's order breaking ties; null on failure.
- Delete `rateBackgrounds`, `readBackgrounds`, `BACKGROUNDS_PER_CALL`, `BACKGROUND_ROUNDS`, `shuffled`.

### 2. Lanes (`src/lib/candidates.ts`)

- `laneCandidates(task, volunteers, tasks, { qualified, size, positions, now })`: `qualified` is ids, best first,
  or null for `rankCandidates`' order. Drop `background`, `certs` and the points.
- Keep the speaker seat, the free-only pool, and the rationale ("free · 120 m · first aid cert · speaks Korean").
  The rationale still uses `SKILL_FOR` for its label; nothing ranks on it any more except `rankCandidates`
  (Assign and backup pickers, and the proposal's first order).

### 3. Wire (`src/server/pick.ts`)

`rankQualified` → `laneCandidates` → `pickCrew` → `rerank`. Log the qualified call's latency and confidence on the run.

### 4. Tests

- `candidates.test.ts`: lanes from a given `qualified` order; null falls back to the rules; seat; nobody twice.
- `picker.test.ts`: `rankQualified` orders by probability, sends no distance, returns null on a 500; drop the
  `rateBackgrounds` tests.
- `bun scripts/bench-pick.ts cases`: switch A to the rules-only lane, B to the real `rankQualified`.

### 5. Stability check before shipping

Run the qualified call 3 times per case in shuffled order. If fewer than 4 of the top 6 hold across the three, take
the average of 3 shuffled calls instead (3 calls, still under a second on OpenAI).

### 6. Deploy

Apply on the Spark Supabase before the new server runs (`world.ts` reads both columns):

- `supabase/migrations/20261008140000_speaker_needed.sql`
- `supabase/migrations/20261008150000_first_aid_needed.sql` (not applied yet, local DB included)

## Results (cases, two runs each)

| | Old (bio scores + points) | Bench B, one call (before) | Rules only (A) | B, 3 averaged | A + first-aid floor | B + first-aid floor |
| --- | --- | --- | --- | --- | --- | --- |
| Everything wanted was sent, of 12 | 12, 12 | 12, 12 | 12, 12 | 11, 10 | 12, 12 | 12, 12 |
| Calls per incident | 43 | 3 | 2 | 5 | 2 | 5 |
| Picker time | 0.5–2.5 s | 0.3–1.2 s | 0.3–0.8 s | 0.6–1.2 s | 0.3–0.5 s | 0.6–2.7 s |
| Intake read the speaker right, of 12 | 11, 11 | same | 11, 11 | same | 11, 11 | same |
| Intake read first aid right, of 12 | | | | | 11, 11 | same |

**First-aid floor.** "Drunk at the bar" now sends a first aider both runs: once the crew slot swapped one in for a
second security licence holder, once the pick chose two itself. With the field's first wording intake read "this guy
is absolutely gone" as no first aid (the security team's "very drunk person who is not hurt") and B still missed it,
11 and 11; "very drunk or high, even if not hurt" fixed it. Intake's one first-aid miss: the panic attack ("she cant
breathe properly") reads as yes both runs, even with "a panic attack alone" listed as false. Costs a first aider beside
the mental health first aider at worst.

Before the floor, B's misses: "drunk at the bar" both runs (sent two security licence holders, no first aider: it reads the bar
serving him as a security job), "vietnamese collapse" once. "Korean BBQ gas" got three refusals once and fell back
to the rules. Italian mate still reads as needing Italian.

**Stability** (`bun scripts/bench-pick.ts stability`, top 6 held across 3 shuffled runs, per case in the order listed below):

| | Held, of 6 | Fewest |
| --- | --- | --- |
| One call | 0, 0, 0, 0, 2, 1, 1, 0, 1, 0, 2, 0 | 0 |
| 3 averaged, run 1 | 0, 0, 3, 1, 2, 1, 1, 2, 1, 0, 2, 2 | 0 |
| 3 averaged, run 2 | 1, 0, 2, 2, 1, 2, 1, 1, 2, 0, 1, 0 | 0 |

One call failed the 4-of-6 rule, so averaging went in; it barely helps. ~130 free, dozens equally fit: who lands in
the top 6 is close to a coin toss among equals. How many of each top 6 hold what the case wants also swings (drunk
at the bar 0/3/5 first aiders, lost child 5/3/2 WWCC).

Cases: panic attack, drunk at the bar, lost and hurt child, lost child, spiked drink, Mandarin, Korean, Vietnamese,
lost Japanese tourist, and three traps (Korean BBQ gas leak, "my Italian mate", Spanish band).

## Open questions

- **Is the qualified call earning its place?** On these 12 the rules-only lane sent everything wanted 12/12, the
  averaged call 11 and 10, and its top 6 doesn't hold. Options: keep it (it finds bios the rules can't see), put the
  rules' first 3 in the qualified lane beside the model's first 3, or drop it.
- **"My Italian mate cut his hand"** reads as needing Italian. Costs one extra volunteer. Tighten the field's wording, or accept it.
- **A language that only comes up in an update.** The picker runs once, on the new proposal. Re-ask on an update
  and offer the nearest free speaker as backup.
- **Big crews.** One choice over ~130 people is fine on OpenAI; past ~300 free, cap the list to the nearest 200.
- **Lost and hurt child.** First aiders go, no WWCC holder. Fine medically; a lead may want one WWCC holder in the pair.
- **RSA** never comes up. Fine unless the bar team wants it for intoxication.
