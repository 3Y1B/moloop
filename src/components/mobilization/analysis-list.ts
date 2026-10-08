import type { MobilizationAnalysisJob } from '@/data/mobilization-analysis';
import type { Mobilization } from '@/lib/schema';

/** A completed proposal replaces its waiting row only once all real objects are available. */
export function visibleAnalysisJobs(
  jobs: readonly MobilizationAnalysisJob[],
  mobilizations: Record<string, Mobilization>,
): MobilizationAnalysisJob[] {
  return jobs.filter((job) => {
    const result = job.result;
    if (job.status !== 'completed' || result?.decision !== 'propose' || !result.mobilizationIds.length) return true;
    return !result.mobilizationIds.every((id) => mobilizations[id]?.analysisRunId === result.runId);
  }).sort((a, b) => b.startedAt - a.startedAt);
}
