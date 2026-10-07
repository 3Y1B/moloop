import { languageName } from './format';
import { UNKNOWN_LANGUAGE } from './ai';
import type { Reporter } from './schema';

/** What a staff screen shows of a reporter's words: the text, a small label over it, and the original behind a tap. */
export type Quote = { text: string; label?: string; original?: { text: string; label: string } };

/**
 * English first for every staff role. "Translated from Spanish" sits only over a real translation, with the
 * Spanish a tap away; English, or words nobody translated, show as said. Read without the AI (language unknown):
 * as said, marked "Not translated".
 */
export function quoteFor(r: Reporter): Quote {
  if (r.language === UNKNOWN_LANGUAGE) return { text: r.quote, label: 'Not translated' };
  const english = r.english?.trim();
  if (r.language === 'en' || !english || english === r.quote.trim()) return { text: r.quote };
  const name = languageName(r.language);
  return { text: english, label: `Translated from ${name}`, original: { text: r.quote, label: `Original, ${name}` } };
}
