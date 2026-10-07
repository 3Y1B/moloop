import { describe, expect, it } from 'vitest';

import { readRespondWords, soundsEmergency } from './respond-words';
import type { EscalationResponseKind } from './schema';

const people = [{ id: 'tom', name: 'Tom Nguyen' }, { id: 'kai', name: 'Kai Smith' }];
const HELP: EscalationResponseKind[] = ['backup', 'handover', 'reassign', 'call', 'close'];
const QUIET: EscalationResponseKind[] = ['call', 'reassign', 'carry_on'];

const read = (said: string, available = HELP, canPass = false) => readRespondWords(said, { available, canPass, people });

describe('readRespondWords: what a lead said, as a response on the Respond screen', () => {
  it('sends a named teammate as backup', () => {
    expect(read('send Tom to help her')).toEqual({ kind: 'backup', volunteerId: 'tom' });
  });

  it('asks for backup without a name: the picker opens', () => {
    expect(read('send backup')).toEqual({ kind: 'backup', volunteerId: undefined });
  });

  it('reassigns to a named teammate', () => {
    expect(read('give it to Kai instead')).toEqual({ kind: 'reassign', volunteerId: 'kai' });
  });

  it('hands over to medics or security', () => {
    expect(read('hand it over to the medics')).toEqual({ kind: 'handover', target: 'medics' });
    expect(read('get security down there')).toEqual({ kind: 'handover', target: 'security' });
  });

  it('reads 000 and ambulances as the emergency handover', () => {
    expect(read('call an ambulance')).toEqual({ kind: 'handover', target: 'emergency' });
    expect(read('triple zero now')).toEqual({ kind: 'handover', target: 'emergency' });
    expect(soundsEmergency('Call 000')).toBe(true);
    expect(soundsEmergency('send Tom')).toBe(false);
  });

  it('calls the volunteer, unless a teammate is named', () => {
    expect(read('give her a call')).toEqual({ kind: 'call' });
    expect(read('call Tom over')).toEqual({ kind: 'backup', volunteerId: 'tom' });
  });

  it('closes with what was said as the note', () => {
    expect(read('  false alarm, close it ')).toEqual({ kind: 'close', note: 'false alarm, close it' });
  });

  it('they’re fine, only when it went quiet', () => {
    expect(read('they’re fine, leave it', QUIET)).toEqual({ kind: 'carry_on' });
    expect(read('they’re fine', HELP)).toBeNull();
  });

  it('a name alone gives it to them when there is no backup (went quiet)', () => {
    expect(read('Kai', QUIET)).toEqual({ kind: 'reassign', volunteerId: 'kai' });
    expect(read('Kai')).toEqual({ kind: 'backup', volunteerId: 'kai' });
  });

  it('passes to Mo only when it can', () => {
    expect(read('pass this up to Mo', HELP, true)).toEqual({ kind: 'pass' });
    expect(read('pass this up to Mo', HELP, false)).not.toEqual({ kind: 'pass' });
  });

  it('offers nothing that does not fit right now', () => {
    expect(read('hand it to medics', QUIET)).toBeNull();
    expect(read('what is going on over there')).toBeNull();
  });
});
