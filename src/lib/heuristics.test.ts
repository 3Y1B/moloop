import { describe, expect, it } from 'vitest';

import { authorityFor, heuristicTriage, soundsCritical, soundsUrgent } from './heuristics';

describe('authorityFor: who decides before a volunteer is sent', () => {
  it.each([
    ['the crowd at the barrier is crushing, evacuate the oval', 'coordinator'],
    ['PA is sparking, stop the set', 'coordinator'],
    ['someone needs an ambulance at Gate B', 'coordinator'],
    ['the oval is over capacity, close gate A for a while', 'coordinator'],
    ['unattended backpack under the bench', 'coordinator'],
    ['I want a refund for my ticket', 'lead'],
    ['the drummer wants to swap set times', 'lead'],
    ['there is a journalist backstage', 'lead'],
  ])('“%s” → %s', (text, level) => {
    expect(authorityFor(text)?.level).toBe(level);
  });

  it.each(['bin overflowing at Food Alley', 'where are the toilets?', 'guy collapsed near the burger truck'])('“%s” → a volunteer', (text) => {
    expect(authorityFor(text)).toBeNull();
  });

  it('rides along on keyword triage, so the mock and a model outage escalate too', () => {
    expect(heuristicTriage('please announcement for a lost child').escalate).toMatchObject({ level: 'coordinator' });
  });
});

describe('soundsUrgent', () => {
  it.each(['help', 'HELP!!', 'please help', 'help me', 'sos'])('treats a bare plea “%s” as urgent', (text) => {
    expect(soundsUrgent(text)).toBe(true);
  });

  it('not a question that mentions help', () => {
    expect(soundsUrgent('where can I get help finding the toilets?')).toBe(false);
  });
});

describe('soundsCritical', () => {
  it.each([
    'my friend ate something with peanuts and her lips are swelling',
    'his throat is closing up',
    'she needs her epipen',
    'I think it is anaphylaxis',
  ])('treats a possible anaphylaxis as P1: “%s”', (text) => {
    expect(soundsCritical(text)).toBe(true);
    expect(heuristicTriage(text).team).toBe('first-aid');
  });

  it('not a swollen ankle', () => {
    expect(soundsCritical('I twisted my ankle and it is swollen')).toBe(false);
  });
});

