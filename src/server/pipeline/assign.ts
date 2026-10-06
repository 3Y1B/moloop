import type { AssignmentProposal, PriorityResult, RewriteResult, TeamResult } from '@/lib/schema';
import { store, type Candidate } from '../store';

/**
 * Assignment Agent. Design: candidate selection and ranking are DETERMINISTIC (auditable, fast, testable);
 * the LLM only writes the human-readable rationale. It never picks people alone and never notifies anyone:
 * it emits a proposal that lands in agent_actions for Mo/team lead to approve.
 */
export async function proposeAssignment(args: {
  team: TeamResult; priority: PriorityResult; rewrite: RewriteResult;
}): Promise<AssignmentProposal> {
  const { team, priority, rewrite } = args;
  const candidates = await store.findCandidates({
    teamSlug: team.team, zoneSlug: rewrite.zoneSlug, requiredSkills: rewrite.requiredSkills,
  });
  const ranked = [...candidates].sort(rank).slice(0, 3);
  return {
    candidates: ranked.map((c) => ({
      volunteerId: c.volunteerId,
      distanceM: c.distanceM,
      rationale: `${c.name}: ${c.distanceM ?? '?'}m away, ${c.activeTasks} active task(s), skills: ${c.skills.join(', ') || 'none'}`,
    })),
    requiresApproval: priority.priority !== 'P3', // P3 is only ever AI-resolved, so in practice always true here
  };
}

// nearest first, then least loaded
const rank = (a: Candidate, b: Candidate) =>
  (a.distanceM ?? 1e9) - (b.distanceM ?? 1e9) || a.activeTasks - b.activeTasks;
