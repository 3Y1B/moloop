import { PipelineOutcome, type ReportInput } from '@/lib/schema';
import { llm, classifier } from '../models';
import { store } from '../store';
import { routeReport } from './route';
import { respondP3 } from './p3-responder';
import { triage } from './triage';
import { proposeAssignment } from './assign';

// Confidence floor: below this on team or priority, flag for human review.
const REVIEW_BELOW = 0.6;

/** The whole loop from the flow diagram: input -> route -> (P3 reply | triage -> assignment) -> task row. */
export async function handleReport(input: ReportInput): Promise<PipelineOutcome> {
  const t0 = Date.now();
  const models = { router: llm.id, classifier: classifier.id, rewrite: llm.id };
  const route = await routeReport(input);
  const reportId = await store.insertReport(input, route);

  // Branch 1: AI can handle it. Safety net: the P3 agent can itself bail to triage.
  if (route.decision === 'ai_resolved') {
    const reply = await respondP3(input, route);
    if (!reply.escalate) {
      const triageRunId = await store.insertTriageRun({ reportId, route, models, latencyMs: Date.now() - t0 });
      const taskId = await store.insertTask({
        reportId, triageRunId, handledBy: 'ai', priority: 'P3', teamSlug: null,
        rewrite: { title: input.rawText.slice(0, 55), summary: input.rawText.slice(0, 270), category: reply.category, zoneSlug: input.zoneSlug ?? null, locationHint: input.locationHint ?? null, requiredSkills: [], peopleInvolved: null },
        aiResponse: reply.reply, responseLang: reply.language, needsHumanReview: false,
      });
      return PipelineOutcome.parse({ reportId, taskId, handledBy: 'ai', reporterReply: reply.reply, priority: 'P3' });
    }
  }

  // Branch 2: triage -> assignment -> task.
  const { team, priority, rewrite } = await triage(input, route);
  const assignment = await proposeAssignment({ team, priority, rewrite });
  const triageRunId = await store.insertTriageRun({ reportId, route, team, priority, rewrite, assignment, models, latencyMs: Date.now() - t0 });
  const taskId = await store.insertTask({
    reportId, triageRunId, rewrite, priority: priority.priority, teamSlug: team.team, handledBy: 'human',
    needsHumanReview: Math.min(team.confidence, priority.confidence) < REVIEW_BELOW || priority.priority === 'P1',
  });
  await store.insertProposal(taskId, assignment);

  return PipelineOutcome.parse({
    reportId, taskId, handledBy: 'human', priority: priority.priority,
    // TODO: localise via llm using route.detectedLanguage. P1 copy should tell the reporter to stay put and that help is coming.
    reporterReply: 'Thanks, we have alerted the team. Please stay where you are; someone is on the way.',
  });
}
