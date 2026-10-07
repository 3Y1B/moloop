/** The other phone was heard: its signal strength in dBm, and when (ms since epoch). */
export type SignalEvent = { rssi: number; at: number };

export type MoloopBeaconModuleEvents = {
  onSignal: (event: SignalEvent) => void;
};
