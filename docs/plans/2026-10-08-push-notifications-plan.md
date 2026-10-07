# Push notifications: plan

## Context

Nothing reaches a phone unless the app is open. Messages arrive over realtime; spoken briefs are rendered after commit
(`server/voice.ts`) and played "if the app is open", and `expo-audio` has background playback off. There is no
`expo-notifications` in the app.

A volunteer on duty has the phone in a pocket, locked, most of the time. So today a new task, a nudge, a backup call,
a lead's escalation and the lost-child heads-up (2026-10-08-lost-child-playbook-plan.md) all wait until someone
happens to open the app. Background location keeps the app alive for positions, but the realtime socket and audio
don't help a locked phone.

Plan: every message the server already writes also goes out as a push, with a level that matches how urgent it is.
No new message kinds, no new screens: the push is a way for an existing message to get through.

## Shape

```
command → transact → commit
                      └─ afterCommit(sendPushes)     (next to speakBriefs, pickNewProposals)
                           b.messages → group by text → Expo push API → push_receipts
                                                                         └─ prune dead tokens
phone
  sign-in / on duty → permission → getExpoPushTokenAsync({ projectId }) → registerPush route → push_tokens
  tap → addNotificationResponseReceivedListener → router.push('/task/[id]')
  app in foreground → setNotificationHandler: no banner (realtime and the spoken brief already have it)
```

## What each message does

`interruptionLevel` is iOS; Android uses the matching channel.

| Message kind | Who | Level | Sound | Tap opens |
|---|---|---|---|---|
| `task` (new, next up) | owner | time sensitive | yes | the task |
| `alert` (lost-child heads-up) | everyone on duty | time sensitive | yes | the task, with [Found her] |
| `backup` | helper | time sensitive | yes | the task |
| `nudge` | owner | time sensitive | yes | the task |
| `escalation` (approve, needs your call, went quiet) | lead, Mo | time sensitive | yes | the task or the approve sheet |
| `broadcast` | everyone on duty / team / zone | active | yes | inbox |
| `direct`, `guest_reply` | recipient | active | yes | the task or inbox |
| `system`, `moved`, `closed`, `arrived` | recipient | passive | no | the task |

Festival-goers: their request screen changes (someone's on the way, "Problem solved?", "Is this her?") are request
updates, not messages. Second step: the same send for a request's status changes, to the guest who owns it.
"Is this her?" needs it most, since the parent's phone is probably in their pocket too.

Critical alerts (bypass silent mode) need Apple to grant an entitlement for the app. Not for a festival. Time
sensitive gets through Focus modes, which is enough.

## Changes

**App config**
- `npx expo install expo-notifications` (package-lock.json, so npx).
- `app.json` plugins: `["expo-notifications", { "icon": …96×96 white…, "color": "#2F6BF5", "defaultChannel": "tasks" }]`.
- `app.json` `ios.entitlements`: `com.apple.developer.usernotifications.time-sensitive: true`.
- Native module, so a new dev build: `npx eas-cli@latest build --profile development`. Same build as
  `expo-image-picker` for the lost-child photo; do both in one.
- Credentials: `npx eas-cli@latest credentials`. An APNs key for iOS (team 887A69S6QZ), an FCM v1 service account for
  Android. `extra.eas.projectId` is already set.

**Database**
- Migration `…_push_tokens.sql`:
  `push_tokens (token text primary key, person_id uuid references profiles on delete cascade, platform text,
  updated_at timestamptz)`, index on `person_id`. Clients have no grants on it; the server writes it.
- `message_deliveries.push_ticket text`, `pushed_at timestamptz`, so the inbox can show "Pushed" next to
  "Read aloud" / "Pinged", and receipts can be matched.

**Server**
- `src/server/push.ts`:
  - `sendPushes(b)`: for `b.messages`, look up tokens for the recipients, build one Expo message per token
    (`to`, `title`, `body`, `data: { messageId, taskId }`, `sound`, `interruptionLevel`, `channelId`,
    `categoryId`), send in chunks of 100 to `https://exp.host/--/api/v2/push/send`, store the ticket ids. Run after
    commit, fire and forget like `speakBriefs`; a failed push logs and never blocks a command.
  - `checkReceipts()`: on the scheduler, about 15 min after send, fetch receipts; `DeviceNotRegistered` deletes the
    token. Other errors log.
  - `EXPO_ACCESS_TOKEN` in env if push security is turned on in the Expo project.
- `src/server/main.ts`: `afterCommit(sendPushes)`.
- `src/server/http/commands.ts`: `registerPush { token, platform }` (any signed-in person; upserts, moves the token to
  the caller if it belonged to someone else on a shared phone) and `unregisterPush { token }` on sign-out.
- `brief()` in voice.ts: upload the audio once and point every delivery row at the same path. The lost-child heads-up
  goes to everyone, and one upload per recipient makes the last person hear it late.

**App**
- `src/lib/push.ts` (or `src/data/push.ts`): permission (read `ios.status`, not `status`), Android channels
  (`tasks` high, `updates` default) before asking for a token, `getExpoPushTokenAsync({ projectId })` with a retry,
  then `repo.registerPush`. Runs when a volunteer goes on duty and when a guest files a request, not at app launch:
  the permission prompt lands when the reason is obvious.
- `src/app/_layout.tsx`:
  - `setNotificationHandler` returning no banner or sound in the foreground, since the app already shows and speaks it.
  - `useLastNotificationResponse()` → `router.push` to `data.taskId`, or the inbox.
  - Mark the message read when its push is tapped.
- Sign-out (`data/supabase/client.ts` `signOut`): `unregisterPush` first.
- Inbox row: "Pushed" in the delivery line.

**Later, not now**
- Lock-screen actions (`setNotificationCategoryAsync`): Accept / Can't on a new task, [Found her] on the heads-up.
  Accept and Can't could run without opening the app; [Found her] opens it for the camera.
- The spoken brief as a notification sound. Push can't carry TTS; the body text is the brief.

## Tests

- `push.test.ts` (server, fake fetch):
  - one batch with a task, a heads-up to 150 and a `closed` gives the right level, sound and channel per message, and
    sends 150 heads-ups in 2 requests.
  - a recipient with no token is skipped; two devices for one person get two pushes.
  - a send that throws doesn't fail the command; a 4xx/5xx logs.
  - receipts: `DeviceNotRegistered` deletes the token, others don't.
- `registerPush` moves a token between people and is idempotent.
- On a dev build: lock the phone, assign a task from Mo's console, the banner arrives and the tap opens the task;
  same for a lead broadcast and the lost-child heads-up. Foreground: no banner, brief still plays.

## Order

1. Config, credentials, dev build (with `expo-image-picker`).
2. Tokens: migration, `registerPush`, app registration.
3. `sendPushes` for every message kind, tap routing.
4. Receipts and pruning.
5. Guest request pushes.
6. Lost-child heads-up rides on 3 with no extra work beyond the `alert` row in the table.
