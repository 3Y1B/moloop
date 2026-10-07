import { afterEach, describe, expect, it, vi } from 'vitest';

import { chooseTeam, chosenTeam, onTeamChange } from './team-pill';

afterEach(() => chooseTeam(null));

describe('the chosen team pill', () => {
  it('starts on All, and tells the list and the map when Mo picks a team', () => {
    const list = vi.fn();
    const map = vi.fn();
    onTeamChange(list);
    onTeamChange(map);
    expect(chosenTeam()).toBeNull();

    chooseTeam('welfare');
    expect(chosenTeam()).toBe('welfare');
    expect(list).toHaveBeenCalledTimes(1);
    expect(map).toHaveBeenCalledTimes(1);
  });

  it('stays quiet when the same pill is tapped again, and stops telling a screen that has gone', () => {
    const screen = vi.fn();
    const stop = onTeamChange(screen);
    chooseTeam('crowd');
    chooseTeam('crowd');
    expect(screen).toHaveBeenCalledTimes(1);

    stop();
    chooseTeam(null);
    expect(screen).toHaveBeenCalledTimes(1);
  });
});
