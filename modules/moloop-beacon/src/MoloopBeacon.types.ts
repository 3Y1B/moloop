/** The other phone was heard: its signal strength in dBm, and when (ms since epoch). */
export type SignalEvent = { rssi: number; at: number };

/**
 * iPhone to iPhone only: UWB ranging. `distance` in metres, `azimuth` in radians (positive to the right); either is
 * missing until the phone has it (no direction yet, or the other phone is behind you).
 */
export type NearbyEvent = { distance?: number; azimuth?: number; at: number };

export type MoloopBeaconModuleEvents = {
  onSignal: (event: SignalEvent) => void;
  onNearby: (event: NearbyEvent) => void;
};
