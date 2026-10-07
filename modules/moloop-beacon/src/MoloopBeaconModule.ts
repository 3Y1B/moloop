import { NativeModule, requireOptionalNativeModule } from 'expo';

import type { MoloopBeaconModuleEvents } from './MoloopBeacon.types';

declare class MoloopBeaconModule extends NativeModule<MoloopBeaconModuleEvents> {
  /** Android: asks for the Bluetooth (and location) permissions. iOS asks on `start`; this says if it was refused. */
  requestPermissions(): Promise<boolean>;
  /** Advertise `uuid` and scan for it; each time the other phone is heard, `onSignal` fires. Replaces any running beacon. */
  start(uuid: string): void;
  stop(): void;
}

/** Null in a build made before the module existed (or Expo Go): the finder says to update instead of crashing the app. */
export default requireOptionalNativeModule<MoloopBeaconModule>('MoloopBeacon');
