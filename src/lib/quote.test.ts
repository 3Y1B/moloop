import { describe, expect, it } from 'vitest';

import { unread, UNKNOWN_LANGUAGE } from './ai';
import { quoteFor } from './quote';
import type { Reporter } from './schema';

const reporter = (over: Partial<Reporter>): Reporter => ({ kind: 'festivalgoer', quote: 'hola', language: 'en', ...over });

describe('quoteFor', () => {
  it('shows the English first, says it was translated, and keeps the original a tap away', () => {
    expect(quoteFor(reporter({ quote: 'Mi hijo se perdió cerca del escenario', language: 'es', english: 'My son got lost near the stage' }))).toEqual({
      text: 'My son got lost near the stage',
      label: 'Translated from Spanish',
      original: { text: 'Mi hijo se perdió cerca del escenario', label: 'Original, Spanish' },
    });
  });

  it('shows English as said, with no label', () => {
    expect(quoteFor(reporter({ quote: 'guy collapsed by the food stalls', language: 'en', english: 'guy collapsed by the food stalls' }))).toEqual({
      text: 'guy collapsed by the food stalls',
    });
  });

  it('never labels a translation that isn\'t there', () => {
    expect(quoteFor(reporter({ quote: 'Mi hijo se perdió', language: 'es' }))).toEqual({ text: 'Mi hijo se perdió' });
    expect(quoteFor(reporter({ quote: 'Mi hijo se perdió', language: 'es', english: 'Mi hijo se perdió' }))).toEqual({ text: 'Mi hijo se perdió' });
  });

  it('marks a report read without the AI as not translated', () => {
    expect(quoteFor(reporter({ quote: 'หิวน้ำน้ำอยู่ที่ไหน', language: 'und' }))).toEqual({ text: 'หิวน้ำน้ำอยู่ที่ไหน', label: 'Not translated' });
  });
});

describe('a report read without the AI', () => {
  it("doesn't claim a report is English: its language is unknown, and nothing translated it", () => {
    const thai = unread('หิวน้ำน้ำอยู่ที่ไหน');
    expect(thai.language).toBe(UNKNOWN_LANGUAGE);
    expect(thai.english).toBeUndefined();
    expect(thai.speakerNeeded).toBeNull();
  });
});
