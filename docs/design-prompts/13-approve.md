# Moloop — Lead: Approve: five design directions

You’re in your own git worktree, designing **one screen** of Moloop. Other sessions are designing the other screens in their own worktrees at the same time. Stay inside the files listed under "Yours".

- Worktree: `../moloop-design-approve`
- Branch: `design/approve`
- Dev server: `npx expo start --web --port 8113` → http://localhost:8113/design/approve

Use the /frontend-design:frontend-design skill.

## The app

Moloop runs the help side of a music festival (demo venue: Birrarung Marr, Melbourne). Festival-goers ask questions or report problems by voice; an AI understands them, answers what it can, and dispatches a volunteer for the rest. Volunteers do one task at a time, mostly hands-free. Team leads watch their team and handle escalations. Every main screen today is the same shape: **the venue map full-screen, a sheet over it, and a voice pill pinned to the bottom.** No tab bar.

It’s an Expo SDK 57 / React Native app with Expo Router, running on iOS, Android and the web. Read `AGENTS.md` and `docs/SCREENS.md` before anything else.

## This screen: Lead: Approve

Route: `src/app/approve/[id].tsx (sheet)`
Who: A lead or Mo, for a P1/P2 report from a festival-goer.

Read these first, they’re the current implementation:
- `src/app/approve/[id].tsx`
- `src/lib/schema/domain.ts (Proposal)`

What it has to contain (fixed; the content contract, not the layout):
- What was reported and where, and the priority.
- The AI’s proposal: the volunteer it picked and why, plus runners-up.
- A 30 s countdown: "Auto-assigns in 24 s", then "Assigning". If nobody acts, the top pick is assigned.
- Approve, or pick another.
- Afterwards: "Auto-assigned", "Approved" or "Cancelled".

States every design must show (via a small design-only state switcher):
- P1, 28 s left
- P2, 5 s left
- Assigning
- Auto-assigned
- Picked another

What matters most here: The countdown is the point: the AI acts if humans are too slow. It must feel like a safety net, not a threat, and approving must take one tap.

## The task

Create **five distinct designs** of this screen. The direction for the whole app is **minimal and clean**: every design should feel calm, quiet and obvious, with nothing on screen that doesn’t earn its place. Premium through restraint, not decoration.

What minimal means here:
- Few elements per state. One primary action, clearly the primary one. Remove before you add.
- Generous whitespace, a strict spacing scale, a short type scale (3–4 sizes), one or two weights.
- Mostly neutrals plus a single accent; color carries meaning (tone), not decoration.
- Flat surfaces separated by hairlines or space. No glass, gradients, glows, textures or drop shadows.
- Motion is short and functional (state changes, the sheet, the hold gesture), never ambient.
- Today’s `src/constants/theme.ts` (white canvas, hairline cards, one blue accent) is already in this spirit: treat it as the baseline to beat, not a cage.

The five must still be clearly different from each other, through **structure and hierarchy** rather than loud styling: what leads, how much is shown at once, how the map, the content and the voice input share the screen, density, type choice, and the one signature interaction. Nothing that reads like a template.

Routes (web, phone viewport):
- `/design/approve/1` … `/design/approve/5`: one design each, full-screen, no header.
- `/design/approve`: a contact sheet showing all five as phone-sized frames, each linking to its route, with its name and one line on the idea.

Fixed vs free:
- **Fixed**: the content contract above, every state, the actions, and the copy rules below.
- **Free**: layout, hierarchy, type, palette (within the minimal brief), motion, how the map and content relate, how voice is presented. The map + sheet + voice pill shape is today’s baseline; keep it, simplify it or replace it, but at least three of the five should go somewhere today’s screen doesn’t.

Things only Moloop has to design for (use these, not generic app ideas):
- Outdoors at a festival: direct sun at noon and darkness at 11 pm. Every design needs light and dark, both legible outside.
- One hand, often walking, through a crowd. Thumb reach. Glance, don’t read.
- Loud. Voice is primary, hold-to-talk is the core gesture, and the screen confirms what was heard.
- Real stakes: some tasks are a person collapsing. Tone (neutral, tint, warning, danger, success) must read instantly, without alarm fatigue.
- The venue map is the real site (Birrarung Marr, the terraced riverside park by the Yarra next to Fed Square), drawn as an illustrated festival map with stages, tents, trucks and toilets.

Copy rules:
- State the action only. No narrating hints, no leading questions, no explanations ("Hold to keep talking", not "Cut off? Hold to keep talking").
- Status copy comes from `src/lib/status.ts`; reuse its functions so every screen says the same thing.
- One free-form input through the AI beats canned buttons. No ratings, stars or "Did that help?".

## Rules

Yours (create or edit only these):
- `src/app/design/approve/_layout.tsx` (Stack, `headerShown: false`), `index.tsx`, `1.tsx` … `5.tsx`
- `src/design/approve/**` for each design’s components, tokens and sample states

Everything else is read-only, including `src/constants/theme.ts`, `src/components/**`, `src/data/**`, `src/lib/**` and `src/app/_layout.tsx`. If a design needs a shared component to behave differently, copy it into `src/design/approve/` and change the copy. List every shared change the winner would need in your report.

Data:
- Type sample states with the real domain types from `src/lib/schema/domain.ts` (Task, Volunteer, GuestRequest, Proposal, Message…) and run them through the real `status.ts` functions, so the designs show real copy.
- Sample states live only in `src/design/approve/` and exist only for this exploration. This branch is never merged: the chosen design is later rebuilt on the real screen with the real hooks, and `src/design` and `src/app/design` are deleted. Don’t add mock modes, fixtures or demo switches anywhere else.
- Use the real map (`VenueMap` from `src/components/map/venue-map`) with real zones from `src/data/venue.ts`. To restyle it, copy its style into your folder rather than editing `map-style.ts` or `map-art.ts`.

Tech:
- Expo SDK 57. Before touching any Expo or React Native API, read https://docs.expo.dev/versions/v57.0.0/ (and https://docs.expo.dev/llms.txt). Don’t trust memory.
- React Native primitives only (`View`, `Text`, `Pressable`…), no DOM elements, so the winner ports to iOS and Android unchanged.
- Motion with Reanimated 4 on the UI thread; gestures with react-native-gesture-handler; respect reduced motion.
- Colors and fonts may be new (within the minimal brief), defined per design in its own folder. New font packages: `npx expo install @expo-google-fonts/<family>` only; no other new dependencies. List what you added.
- The web dev server is the review surface. Check every design and state at 390 × 844 in light and dark, and fix layout overflow and console errors.

## Done when

- `/design/approve` and `/1` … `/5` load on http://localhost:8113 with no console errors, every state reachable.
- `npx tsc --noEmit` and `npx expo lint` are clean for your files.
- Everything is committed on `design/approve`.
- Your report has, for each design: a name, the idea in one line, palette, type, the signature interaction, and a screenshot (light and dark). Then your pick and why, and any shared-code changes the winner would need.
