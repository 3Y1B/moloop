import type { PlanningSnapshot } from '@/lib/mobilization-contracts';
import { compactPlanningInput } from './input-projection';

/** Model-input projection only. The complete saved snapshot and server allocation are unchanged. */
export function focusedPlanningInput(snapshot: PlanningSnapshot) {
  const input = compactPlanningInput(snapshot, { playbookMode: 'index_only' });
  return {
    ...input,
    routes: {
      kind: 'ordinary_walking_routes_kept_server_side' as const,
      allocation: 'server_only' as const,
      note: 'Ordinary walking distances and individual travel ranking remain server-side. No ETA or '
        + 'walking distance is supplied here; do not invent either. This metadata is not an emergency '
        + 'movement approval. Actual supplied route observations and their approval facts remain in '
        + 'scenario/evidence unchanged.',
    },
    inputAvailability: Object.fromEntries(Object.entries(input.inputAvailability)
      .filter(([, value]) => value.available === true)),
    inputAvailabilityScope: {
      included: 'available_entries_only' as const,
      note: 'Absent keys mean unknown or unsupplied, never zero, false, safe, not-applicable or approved. '
        + 'Partial completeness and canonical aliases retain their original meaning. Available does '
        + 'not mean safe or sufficient. Exact unavailable required inputs for each selected SOP come '
        + 'from the audited get_playbooks result requiredInputChecks[].unavailableRequiredInputs; '
        + 'do not infer an applicability verdict from an omitted dictionary entry.',
    },
  };
}
