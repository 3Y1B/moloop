import { isActive, isBusy } from './lifecycle';
import { TEAM_SLUGS, type Task, type TeamSlug, type Volunteer, type Zone } from './schema';
import { memberStatus, type Status } from './status';

type World = {
  volunteers: Record<string, Volunteer>;
  tasks: Record<string, Task>;
  zones?: Record<string, Zone>;
  now: number;
};

const byPriorityThenAge = (a: Task, b: Task) => a.priority.localeCompare(b.priority) || a.createdAt - b.createdAt;
const TONE_RANK: Record<Status['tone'], number> = { danger: 0, warning: 1, tint: 2, neutral: 3, success: 3 };

/** "On duty" is everyone on shift: on a task, free, or on break. */
export type TeamStat = { slug: TeamSlug; leadId: string | null; onDuty: number; onTask: number; free: number; onBreak: number };

/** Per team, for the pills and the team header. Teams nobody is rostered on are left out; I'm not counted. */
export function teamStats(s: World, meId: string | null): TeamStat[] {
  const crew = Object.values(s.volunteers).filter((v) => v.id !== meId);
  const tasks = Object.values(s.tasks);
  const busy = (v: Volunteer) => isBusy(tasks, v.id);
  return TEAM_SLUGS.flatMap((slug) => {
    const team = crew.filter((v) => v.teamSlug === slug);
    if (team.length === 0) return [];
    const onTask = team.filter((v) => v.duty !== 'off_shift' && busy(v)).length;
    const onBreak = team.filter((v) => v.duty === 'on_break' && !busy(v)).length;
    const free = team.filter((v) => v.duty === 'on_duty' && !busy(v)).length;
    return [{ slug, leadId: team.find((v) => v.role === 'team_lead')?.id ?? null, onDuty: onTask + free + onBreak, onTask, free, onBreak }];
  });
}

export type TeamMember = { volunteer: Volunteer; status: Status; task?: Task; helping?: Task };

/**
 * One team's people and open tasks, or everyone's (`null`), not counting me. People most urgent first, then by name,
 * off shift last; each with the task they own, else the one they're helping. Open tasks are unassigned and queued,
 * most urgent first. Mo's list and map both read this, so they always agree.
 */
export function crewFor(s: World, meId: string | null, team: TeamSlug | null): { members: TeamMember[]; openTasks: Task[] } {
  const all = Object.values(s.tasks);
  const inTeam = (slug: TeamSlug | null) => team === null || slug === team;
  const members: TeamMember[] = Object.values(s.volunteers)
    .filter((v) => v.id !== meId && inTeam(v.teamSlug))
    .map((v) => ({
      volunteer: v,
      status: memberStatus(v, all, s.now, s),
      task: all.filter((t) => t.assigneeId === v.id && isActive(t)).sort(byPriorityThenAge)[0],
      helping: all.find((t) => isActive(t) && t.helperIds.includes(v.id)),
    }))
    .sort((a, b) =>
      Number(a.volunteer.duty === 'off_shift') - Number(b.volunteer.duty === 'off_shift') ||
      TONE_RANK[a.status.tone] - TONE_RANK[b.status.tone] ||
      a.volunteer.name.localeCompare(b.volunteer.name));
  const openTasks = all.filter((t) => (t.status === 'open' || t.status === 'queued') && inTeam(t.teamSlug)).sort(byPriorityThenAge);
  return { members, openTasks };
}
