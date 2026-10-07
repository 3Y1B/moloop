import { NativeModule, registerWebModule } from 'expo';

import type { MoloopBeaconModuleEvents } from './MoloopBeacon.types';

/** No Bluetooth beacon on the web: the finder just keeps searching. */
class MoloopBeaconModule extends NativeModule<MoloopBeaconModuleEvents> {
  async requestPermissions() {
    return false;
  }
  start(_uuid: string) {}
  stop() {}
}

export default registerWebModule(MoloopBeaconModule, 'MoloopBeacon');
