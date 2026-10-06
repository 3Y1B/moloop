import { languageName } from '@/lib/format';
import { isBusy } from '@/lib/lifecycle';
import { formatMeters, routeBetween } from '@/lib/route';
import type { IncidentCategory, ProposalCandidate, Task, Volunteer } from '@/lib/schema';

/**
 * Who should take a task, best first, with a short why ("free · 120 m · first aid cert").
 * Stand-in for the assign agent: same team, then free, then the right skill, then nearest.
 * Used for P1/P2 proposals, the Assign picker and the backup picker.
 */

const SKILL_FOR: Partial<Record<IncidentCategory, string>> = {
  medical: 'first-aid-cert',
  heat: 'first-aid-cert',
  lost_child: 'wwcc',
  crowding: 'crowd-control',
};

const SKILL_LABEL: Record<string, string> = {
  'first-aid-cert': 'first aid cert',
  wwcc: 'WWCC',
  'crowd-control': 'crowd control',
  'radio-trained': 'radio',
  rsa: 'RSA',
};

export function rankCandidates(
  task: Task, volunteers: Volunteer[], tasks: Task[],
  { exclude = [], limit = 5 }: { exclude?: string[]; limit?: number } = {},
): ProposalCandidate[] {
  const skip = new Set([...exclude, ...task.helperIds, ...(task.assigneeId ? [task.assigneeId] : [])]);
  const skill = SKILL_FOR[task.category];
  const lang = task.reporter.language !== 'en' ? task.reporter.language : null;

  return volunteers
    .filter((v) => v.role === 'volunteer' && v.duty === 'on_duty' && !skip.has(v.id))
    .map((v) => {
      const route = routeBetween(v.zoneSlug, task.zoneSlug);
      const distanceM = route ? Math.round(route.meters) : null;
      const free = !isBusy(tasks, v.id);
      const hasSkill = !!skill && v.skills.includes(skill);
      const speaks = !!lang && v.languages.includes(lang);
      const why = [
        free ? 'free' : 'busy',
        distanceM == null ? null : distanceM === 0 ? 'here' : formatMeters(distanceM),
        hasSkill ? SKILL_LABEL[skill] ?? skill : null,
        speaks ? `speaks ${languageName(lang)}` : null,
      ].filter(Boolean);
      const score = [v.teamSlug === task.teamSlug ? 0 : 1, free ? 0 : 1, hasSkill || speaks ? 0 : 1, distanceM ?? 9_999];
      return { candidate: { volunteerId: v.id, rationale: why.join(' · '), distanceM }, score };
    })
    .sort((a, b) => a.score.reduce((d, x, i) => d || x - b.score[i], 0))
    .slice(0, limit)
    .map((x) => x.candidate);
}
