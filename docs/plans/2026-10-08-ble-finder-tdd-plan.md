# Bluetooth finder (hackathon): TDD plan

## Context

In a crowd, the volunteer sent to a festival-goer gets close on the map and then can't spot them. GPS is 5 to 15 m
off in a crowd and worse indoors, and the demo is indoors with one iPhone and one Android, so UWB (iPhone↔iPhone
only) is out. Bluetooth works iPhone↔Android and indoors, but it gives signal strength (RSSI), not direction.

So the finder is Apple's Precision Finding "Nearby" state, driven by Bluetooth: a cloud of dots that tightens as
the two phones get closer, a plain step ("Nearby", "Getting closer", "Very close", "Here"), and warmer/colder.
Both people open it: the volunteer on their task, the festival-goer on their request. Each phone shows the other.

Out of scope (hackathon): direction arrow, GPS stage, UWB, background scanning, beacon flash/ping.

## Names

`src/lib/nearby.ts` already means "open tasks near a report", so this feature is the **finder**:
`src/lib/finder.ts` (pure logic), `modules/moloop-beacon/` (native Bluetooth), `src/app/find/[id].tsx` (screen).

## How it works

1. Both phones know the task id (volunteer: `task.id`; festival-goer: `request.taskId`).
2. `beaconUuid(taskId)` turns it into a 128-bit Bluetooth service UUID, the same on both phones and different per task.
3. The native module **advertises** that UUID and **scans** for it, emitting `onSignal({ rssi, at })` each time it
   hears the other phone. Service UUIDs are the only payload iOS lets a foreground app advertise, and Android can
   scan for them, so this is the one format that works both ways.
4. The screen keeps the last few seconds of samples and calls `readSignal(samples, now, previous)` on every sample
   and on a 500 ms tick, which gives `{ step, trend }` to draw.

## Seams under test (vitest, `src/lib/finder.test.ts`)

Both are pure functions in `src/lib/finder.ts`, the module's public interface. No mocks.

### S1. `beaconUuid(taskId: string): string`

- is a well-formed 128-bit UUID string (8-4-4-4-12 lowercase hex)
- is the same for the same task id (both phones agree), as a known literal for a fixed id
- differs for two different task ids (two finders in one crowd don't hear each other)

### S2. `readSignal(samples: Sample[], now: number, previous?: Step): Reading`

`Sample = { rssi: number; at: number }`, `Reading = { step: Step; trend: Trend; rssi: number | null }`,
`Step = 'searching' | 'nearby' | 'closer' | 'very_close' | 'here'`, `Trend = 'warmer' | 'colder' | 'steady' | null`.

Behaviours, one test each, in this order (each a tracer bullet):

1. no samples → `searching`
2. a steady strong signal → `here`; a steady weak one → `nearby` (the step ladder, known literals from `FINDER`)
3. nothing heard for `FINDER.lostMs` → back to `searching` (the other phone left or closed the app)
4. one spike doesn't jump the step: smoothing over the last `FINDER.windowMs`
5. hovering within `FINDER.hysteresisDb` of a boundary keeps the previous step (no flicker)
6. trend: smoothed RSSI rising by `FINDER.trendDb` over `FINDER.trendMs` → `warmer`; falling → `colder`; else
   `steady`; not enough history → `null`

Thresholds start at: here ≥ −55 dBm, very close ≥ −65, getting closer ≥ −75, nearby otherwise. They live in one
`FINDER` object so they can be tuned with both phones in the demo room. Tests read the boundaries from
`FINDER` but assert known literal steps for known literal inputs.

## Not unit-tested (verified by hand)

- **Native module** `modules/moloop-beacon/`: created with `npx create-expo-module@latest --local`.
  - Swift: `CBPeripheralManager` advertises `[CBAdvertisementDataServiceUUIDsKey: [uuid]]`; `CBCentralManager`
    scans for `[uuid]` with `allowDuplicates: true` and sends `onSignal` per discovery.
  - Kotlin: `BluetoothLeAdvertiser` (low latency, high power, service UUID only, no device name) and
    `BluetoothLeScanner` with a service UUID `ScanFilter`, `SCAN_MODE_LOW_LATENCY`.
  - JS API: `start(uuid): Promise<void>`, `stop(): void`, `requestPermissions(): Promise<boolean>`, event `onSignal`.
- **Permissions** (no config plugin needed, so `ios/`/`android/` stay generated): iOS
  `NSBluetoothAlwaysUsageDescription` in `app.json` → `ios.infoPlist`; Android `BLUETOOTH_SCAN`, `BLUETOOTH_ADVERTISE`
  and legacy `BLUETOOTH`/`BLUETOOTH_ADMIN` (capped at SDK 30) in the module's own `AndroidManifest.xml`, which merges
  into the app. No `neverForLocation`: it can filter scan results, and the app already holds fine location.
  Check with `npx expo config --type introspect`.
- **Screen** `src/app/find/[id].tsx`: Apple-style full-screen "Nearby": the other person's name, an animated dot
  cloud (reanimated) that tightens with the step, the step as the big line, warmer/colder underneath, the screen
  turning green at `here`, a haptic tick on each step change (`expo-haptics`). Starts the beacon on focus, stops on blur.
- **Entry points**: a "Find" button on the volunteer's active task card, and on the festival-goer's request screen
  once someone is coming (`coming` / `with_you`).

## Build and devices

- **iPhone**: the Simulator has no Bluetooth, so `npx expo run:ios --device` on the physical iPhone (free Apple ID).
- **Android**: no Android SDK on this Mac. Either install Android Studio and `npx expo run:android --device`, or
  `npx eas-cli@latest build --profile development --platform android` (EAS cloud, needs an Expo login).

## Verification

1. `npx vitest run src/lib/finder.test.ts`, then the full `npm test`.
2. `npx tsc --noEmit` and `npx expo lint`.
3. `npx expo config --type introspect` shows the Bluetooth permissions on both platforms.
4. On devices: assign a task to the volunteer, open Find on both phones, walk from ~15 m to touching. Expect
   Nearby → Getting closer → Very close → Here, green at the end, Searching when one phone closes the app.
   Tune `FINDER` thresholds in the room.

## Addendum: the UWB arrow, iPhone ↔ iPhone

Two iPhones (11 or newer) get Apple's arrow on the same screen; every other pair keeps the Bluetooth dots.

- **Token swap over Bluetooth, no server.** Each iPhone starts an `NISession` and serves its archived discovery token
  as a readable characteristic (`6d6f6c6f-6f70-4000-8000-746f6b656e00`) under the task's service. On hearing a
  *connectable* advertiser for the task (only iPhones; Android's beacon isn't connectable), it connects, reads the
  token, disconnects and runs `NINearbyPeerConfiguration`, with camera assistance where supported (iPhone 14+ needs
  it for direction). Peer gone (`didRemove`): read their token again when next heard.
- **Event** `onNearby({ distance?, azimuth?, at })`: metres, radians positive to the right (`horizontalAngle`, else
  `asin(direction.x)`). Verify the sign on two devices.
- **Seam S3** `readPeer({ distance, azimuth })`, tested: null without a distance; `here` under 0.5 m; `sweep` (distance
  only, "Move your iPhone around"); `arrow` with angle in degrees, `ahead` and green within ±15°, else left/right;
  "3.2 m" under 10 m, whole metres from there.
- **Screen**: arrow springs to the angle, an arc from the "straight ahead" dot round to them, distance big, "to your
  right" under it. The arrow drops back to the dots after 1.5 s without UWB.
- **Permissions**: `NSNearbyInteractionUsageDescription`, `NSCameraUsageDescription` in `app.json`.
- **Verify**: two iPhone 11+ on one task, both on Find: the arrow should track as one walks round the other; turning
  to face them turns the screen green.
