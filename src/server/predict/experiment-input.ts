import type { PlanningSnapshot } from '@/lib/mobilization-contracts';
import { compactPlanningInput } from './input-projection';

/** Experimental lossless tables only; never edits the immutable audit snapshot. */
export function compactExperimentInput(snapshot: PlanningSnapshot, playbookMode: 'all_full' | 'index_only') {
  const input = compactPlanningInput(snapshot, { playbookMode });
  const zoneSlugs = [...new Set(snapshot.zones.map((zone) => zone.slug))];
  const index = new Map(zoneSlugs.map((slug, i) => [slug, i]));
  const knownEndpoints = snapshot.routes.every((route) => index.has(route.from) && index.has(route.to));
  return {
    ...input,
    routes: knownEndpoints ? {
      kind: input.routes.kind, zoneSlugs,
      columns: ['fromZoneIndex', 'toZoneIndex', 'minutes', 'meters'] as const,
      values: snapshot.routes.map((route) => [index.get(route.from)!, index.get(route.to)!, route.minutes, route.meters]),
      note: 'Zone indices are zero-based into zoneSlugs. Ordinary walking distances only, not emergency movement authorizations.',
    } : input.routes,
    inputAvailability: {
      columns: ['key', 'source', 'available', 'completeness', 'canonicalKey'] as const,
      values: Object.entries(input.inputAvailability).map(([key, value]) =>
        [key, value.source, value.available, value.completeness, value.canonicalKey ?? key]),
      note: 'Each row retains the exact availability and canonical alias. Unknown/partial remain unknown/partial.',
    },
  };
}
