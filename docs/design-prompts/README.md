# Design exploration prompts

Five minimal, clean design directions for every screen, one worktree and one Claude session per screen, all running at once.

**Now** are the screens the field test runs on: getting in, a festival-goer asking and tracking help, a volunteer working a task, and a lead watching the team and handling escalations and approvals. **Later** are the supporting sheets (Inbox, Task detail, Reply, Directions, Person, Pick a volunteer), which should follow whichever directions win. Each prompt is self-contained: paste it as the first message of a session started in that screen’s worktree.

| # | Screen | Route | Branch | Port | Priority | Prompt |
| --- | --- | --- | --- | --- | --- | --- |
| 01 | Sign-in | `src/app/sign-in.tsx` | `design/sign-in` | 8101 | Now | [prompt](01-sign-in.md) |
| 02 | Festival-goer: Ask | `src/app/(guest)/index.tsx` | `design/guest-ask` | 8102 | Now | [prompt](02-guest-ask.md) |
| 03 | Festival-goer: Request | `src/app/(guest)/request/[id].tsx` | `design/guest-request` | 8103 | Now | [prompt](03-guest-request.md) |
| 04 | Volunteer: My task | `src/app/(staff)/index.tsx (My task)` | `design/volunteer-task` | 8104 | Now | [prompt](04-volunteer-task.md) |
| 05 | Team lead: Team view | `src/app/(staff)/index.tsx (Team)` | `design/team-view` | 8105 | Now | [prompt](05-team-view.md) |
| 06 | Inbox | `src/app/inbox.tsx (sheet)` | `design/inbox` | 8106 | Later | [prompt](06-inbox.md) |
| 07 | Task detail | `src/app/task/[id].tsx` | `design/task-detail` | 8107 | Later | [prompt](07-task-detail.md) |
| 08 | Reply sheet | `src/app/reply/[id].tsx (sheet)` | `design/reply` | 8108 | Later | [prompt](08-reply.md) |
| 09 | Walking directions | `src/app/navigate/[id].tsx` | `design/navigate` | 8109 | Later | [prompt](09-navigate.md) |
| 10 | Lead: Respond | `src/app/respond/[id].tsx (sheet)` | `design/respond` | 8110 | Now | [prompt](10-respond.md) |
| 11 | Lead: Person | `src/app/person/[id].tsx (sheet)` | `design/person` | 8111 | Later | [prompt](11-person.md) |
| 12 | Lead: Pick a volunteer | `src/app/assign/[id].tsx (sheet)` | `design/assign` | 8112 | Later | [prompt](12-assign.md) |
| 13 | Lead: Approve | `src/app/approve/[id].tsx (sheet)` | `design/approve` | 8113 | Now | [prompt](13-approve.md) |

Every session serves its designs at `http://localhost:<port>/design/<screen>` (contact sheet) and `/design/<screen>/1` … `/5`.

## 1. Commit first

Worktrees branch from a commit, not from your working tree. Anything uncommitted won’t be in them, so commit what the designers should start from and check nothing is left:

```bash
git -C ~/Documents/gh/moloop status --short
```

## 2. Create the worktrees

Run from the repo root. Each gets its own branch off the current HEAD, a copy-on-write clone of `node_modules` and the local env files. This creates the **Now** set; swap in `inbox task-detail reply navigate person assign` for the rest.

```bash
for s in sign-in guest-ask guest-request volunteer-task team-view respond approve; do git worktree add -b "design/$s" "../moloop-design-$s" HEAD && cp .env.local .env.production.local "../moloop-design-$s/" 2>/dev/null; (cd "../moloop-design-$s" && cp -cR ../moloop/node_modules .) & done; wait
```

## 3. Start one session per worktree

In the desktop app, start a new Code session with the worktree folder (`~/Documents/gh/moloop-design-<screen>`) as its working directory, and paste that screen’s prompt. Or from a terminal:

```bash
cd ../moloop-design-sign-in && claude "$(cat ../moloop/docs/design-prompts/01-sign-in.md)"
```

The prompts ask each session to use the `/frontend-design:frontend-design` skill.

## 4. Review

Open each contact sheet at its port, pick a winner per screen, then rebuild the winner on the real screen (real hooks, tokens folded into `src/constants/theme.ts`) on a normal branch. The design branches are never merged.

## 5. Clean up

```bash
for s in sign-in guest-ask guest-request volunteer-task team-view respond approve inbox task-detail reply navigate person assign; do git worktree remove --force "../moloop-design-$s"; git branch -D "design/$s"; done
```

Ports 8081–8083 are taken by the main checkout’s launch configs, so the design worktrees use 8101–8113.
