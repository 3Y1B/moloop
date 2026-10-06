import type { Classifier, Llm } from './types';
import { JevClassifier } from './jev';
import { LunaLlm } from './luna';
import { MockClassifier, MockLlm } from './mock';

const live = process.env.USE_LIVE_MODELS === '1';
export const classifier: Classifier = live ? new JevClassifier() : new MockClassifier();
export const llm: Llm = live ? new LunaLlm() : new MockLlm();
