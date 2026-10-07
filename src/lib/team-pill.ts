import type { TeamSlug } from './schema';

/*
 * Which team Mo is looking at: All (`null`) or one team. One choice for the Crew list, the Map tab and the laptop
 * map, so they always show the same people. Kept for the session, not saved.
 */

let chosen: TeamSlug | null = null;
const listeners = new Set<() => void>();

export function chosenTeam(): TeamSlug | null {
  return chosen;
}

export function chooseTeam(team: TeamSlug | null) {
  if (team === chosen) return;
  chosen = team;
  listeners.forEach((l) => l());
}

/** For `useSyncExternalStore`: returns the unsubscribe. */
export function onTeamChange(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
