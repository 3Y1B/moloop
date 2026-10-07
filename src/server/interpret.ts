import { interpretHeuristic } from '@/lib/commands';
import type { Task } from '@/lib/schema';
import type { Interpretation } from '@/data/repo';

/**
 * Speech or text → intent, decided before anything happens ("Heard: …"). A keyword heuristic for now;
 * phase 3 puts the classifier on Spark behind this one function. Nothing is executed here.
 */
export async function interpret(tasks: Task[], meId: string, text: string): Promise<Interpretation> {
  return interpretHeuristic(tasks, meId, text);
}
