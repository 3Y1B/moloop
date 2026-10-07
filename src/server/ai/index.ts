import { KeywordBrain, SparkBrain, type Brain } from './brain';

export type { Brain, Judged, Run } from './brain';

/**
 * USE_LIVE_MODELS=1 puts the models behind every decision (needs TYPESAFE_BASE_URL and TYPESAFE_API_KEY).
 * Anything else keeps the keyword stand-ins, so the server runs with no keys.
 */
export const live = process.env.USE_LIVE_MODELS === '1';
export const brain: Brain = live ? new SparkBrain() : new KeywordBrain();
