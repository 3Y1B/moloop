import { isHeld, isQuiet, needsResponse, quietSince } from './lifecycle';
import type { Mobilization, Proposal, Task, TeamSlug, Volunteer } from './schema';

export type NeedsKind = 'help' | 'escalated' | 'mobilization' | 'quiet' | 'approval' | 'handover' | 'unassigned';
export type NeedsItem =
  | {
      kind: Exclude<NeedsKind, 'mobilization'>;
      task: Task;
      /** For approvals. */
      proposal?: Proposal;
      /** When it started needing someone (help asked, went quiet, proposed, handover sent, reported). */
      since: number;
    }
  | { kind: 'mobilization'; mobilization: Mobilization; since: number };

const NEEDS_ORDER: NeedsKind[] = ['help', 'escalated', 'mobilization', 'quiet', 'approval', 'handover', 'unassigned'];
const priorityOf = (item: NeedsItem) => (item.kind === 'mobilization' ? item.mobilization.urgency : item.task.priority);

type World = {
  tasks: Record<string, Task>;
  proposals: Record<string, Proposal>;
  volunteers: Record<string, Volunteer>;
  mobilizations: Record<string, Mobilization>;
};

/**
 * The lead's or Mo's "Needs you" list. Lead: their team's help requests and AI escalations (still shown after a
 * bump), quiet tasks, pending approvals, handovers waiting on "Arrived", unassigned tasks.
 * Mo: what was bumped or escalated to Mo (or has no lead), P1 approvals, unassigned P1/P2, and proposed or active
 * mobilizations (venue-wide, so leads don't see these). Volunteers get nothing.
 */
export function needsFor(s: World, meId: string | null): NeedsItem[] {
  const me = meId ? s.volunteers[meId] : undefined;
  if (!me || me.role === 'volunteer') return [];
  const lead = me.role === 'team_lead';
  const hasLead = (team: TeamSlug | null) => Object.values(s.volunteers).some((v) => v.role === 'team_lead' && v.teamSlug === team);
  const mine = (t: Task) => (lead ? t.teamSlug === me.teamSlug : !hasLead(t.teamSlug));
  const pending = new Map(Object.values(s.proposals).filter((p) => p.status === 'pending').map((p) => [p.taskId, p]));
  const items: NeedsItem[] = [];

  if (!lead) {
    for (const m of Object.values(s.mobilizations)) {
      if (m.status === 'proposed' || m.status === 'active') items.push({ kind: 'mobilization', mobilization: m, since: m.createdAt });
    }
  }

  for (const t of Object.values(s.tasks)) {
    const e = t.escalation;
    if (needsResponse(t) && (lead ? mine(t) : e?.level === 'coordinator')) {
      items.push({ kind: 'help', task: t, since: e?.at ?? t.lastActivityAt });
    } else if (isHeld(t)) {
      if (lead ? mine(t) : e?.level === 'coordinator') items.push({ kind: 'escalated', task: t, since: e?.at ?? t.createdAt });
    } else if (t.status === 'escalated' && e?.response?.kind === 'handover' && (lead ? mine(t) : e.response.byId === me.id)) {
      items.push({ kind: 'handover', task: t, since: e.response.at });
    } else if (isQuiet(t) && mine(t)) {
      items.push({ kind: 'quiet', task: t, since: quietSince(t) });
    } else if (t.status === 'open') {
      const p = pending.get(t.id);
      if (p && (lead ? mine(t) : t.priority === 'P1' || mine(t))) items.push({ kind: 'approval', task: t, proposal: p, since: p.createdAt });
      else if (!p && (lead ? mine(t) : t.priority !== 'P3')) items.push({ kind: 'unassigned', task: t, since: t.createdAt });
    }
  }
  return items.sort((a, b) =>
    NEEDS_ORDER.indexOf(a.kind) - NEEDS_ORDER.indexOf(b.kind) || priorityOf(a).localeCompare(priorityOf(b)) || a.since - b.since);
}
