import { useMemo } from 'react';

import { rankCandidates } from '@/lib/candidates';
import { isActive, isHeld, isOnTask, isQuiet, needsResponse, quietSince } from '@/lib/lifecycle';
import { routeBetween } from '@/lib/route';
import type { GuestRequest, Proposal, Task, Team, TeamSlug, Volunteer, VolunteerRole } from '@/lib/schema';
import { guestStage, memberStatus, taskStatusFor, type GuestStatus, type Status } from '@/lib/status';
import { useSnapshot } from './provider';

export { useRepo, useSnapshot } from './provider';

const byPriorityThenAge = (a: Task, b: Task) => a.priority.localeCompare(b.priority) || a.createdAt - b.createdAt;

export function useNow() {
  return useSnapshot().now;
}

export function useMe() {
  const s = useSnapshot();
  return s.meId ? s.volunteers[s.meId] : undefined;
}

/** Which app to show: the festival-goer's, or the volunteer app (leads and Mo get the Team tab too). */
export function useRole(): 'guest' | VolunteerRole | null {
  const s = useSnapshot();
  if (!s.meId) return null;
  if (s.meId === s.guestId) return 'guest';
  return s.volunteers[s.meId]?.role ?? null;
}

/**
 * Everything the volunteer home screen needs, derived once per snapshot. `active` is the task I own
 * or the one I'm backing someone up on (`helping` says which).
 */
export function useMyWork() {
  const s = useSnapshot();
  return useMemo(() => {
    const all = Object.values(s.tasks);
    const mine = all.filter((t) => t.assigneeId === s.meId);
    const active = s.meId ? all.filter((t) => isOnTask(t, s.meId!)).sort(byPriorityThenAge)[0] : undefined;
    return {
      active,
      helping: !!active && active.assigneeId !== s.meId,
      queue: mine.filter((t) => t.status === 'queued').sort(byPriorityThenAge),
      done: all
        .filter((t) => t.status === 'resolved' && (t.assigneeId === s.meId || (!!s.meId && t.helperIds.includes(s.meId))))
        .sort((a, b) => (b.resolvedAt ?? 0) - (a.resolvedAt ?? 0)),
    };
  }, [s.tasks, s.meId]);
}

/** The status line for a task, as I see it (owner, helper, or a lead watching). */
export function useTaskStatus(task: Task | undefined): Status | undefined {
  const s = useSnapshot();
  return task ? taskStatusFor(s.meId, task, s, s.now) : undefined;
}

export function useTask(id: string | undefined) {
  const s = useSnapshot();
  return id ? s.tasks[id] : undefined;
}

export function useTaskEvents(taskId: string | undefined) {
  const s = useSnapshot();
  return useMemo(() => s.events.filter((e) => e.taskId === taskId).sort((a, b) => a.at - b.at), [s.events, taskId]);
}

export function useInbox() {
  const s = useSnapshot();
  return useMemo(() => {
    const messages = s.messages.filter((m) => m.recipientId === s.meId).sort((a, b) => b.at - a.at);
    return { messages, unread: messages.filter((m) => !m.read).length };
  }, [s.messages, s.meId]);
}

export function useLookups() {
  const s = useSnapshot();
  return { teams: s.teams, zones: s.zones, volunteers: s.volunteers };
}

/** Walking route from where I am to a task's location. Null if either end is unknown. */
export function useRouteTo(task: Task | undefined) {
  const me = useMe();
  const from = me?.zoneSlug ?? null;
  return useMemo(
    () => (task ? routeBetween(from, task.zoneSlug, task.locationHint) : null),
    [from, task?.zoneSlug, task?.locationHint], // eslint-disable-line react-hooks/exhaustive-deps
  );
}

// ── Leads and Mo ──

export type NeedsKind = 'help' | 'escalated' | 'quiet' | 'approval' | 'handover' | 'unassigned';
export type NeedsItem = {
  kind: NeedsKind;
  task: Task;
  /** For approvals. */
  proposal?: Proposal;
  /** When it started needing someone (help asked, went quiet, proposed, handover sent, reported). */
  since: number;
};

const NEEDS_ORDER: NeedsKind[] = ['help', 'escalated', 'quiet', 'approval', 'handover', 'unassigned'];

/**
 * The lead's or Mo's "Needs you" list. Lead: their team's help requests and AI escalations (still shown after a
 * bump), quiet tasks, pending approvals, handovers waiting on "Arrived", unassigned tasks.
 * Mo: what was bumped or escalated to Mo (or has no lead), P1 approvals, unassigned P1/P2. Volunteers get nothing.
 */
export function useNeedsMe(): NeedsItem[] {
  const s = useSnapshot();
  return useMemo(() => {
    const me = s.meId ? s.volunteers[s.meId] : undefined;
    if (!me || me.role === 'volunteer') return [];
    const lead = me.role === 'team_lead';
    const hasLead = (team: TeamSlug | null) => Object.values(s.volunteers).some((v) => v.role === 'team_lead' && v.teamSlug === team);
    const mine = (t: Task) => (lead ? t.teamSlug === me.teamSlug : !hasLead(t.teamSlug));
    const pending = new Map(Object.values(s.proposals).filter((p) => p.status === 'pending').map((p) => [p.taskId, p]));
    const items: NeedsItem[] = [];

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
      NEEDS_ORDER.indexOf(a.kind) - NEEDS_ORDER.indexOf(b.kind) || a.task.priority.localeCompare(b.task.priority) || a.since - b.since);
  }, [s.tasks, s.proposals, s.volunteers, s.meId]);
}

export type TeamMember = { volunteer: Volunteer; status: Status; task?: Task; helping?: Task };

const TONE_RANK: Record<Status['tone'], number> = { danger: 0, warning: 1, tint: 2, neutral: 3, success: 3 };

/** A team at a glance: members (most urgent first, not me), their tasks, and the team's open and active tasks. Defaults to my team. */
export function useTeam(teamSlug?: TeamSlug | null) {
  const s = useSnapshot();
  const slug = teamSlug === undefined ? (s.meId ? s.volunteers[s.meId]?.teamSlug ?? null : null) : teamSlug;
  return useMemo(() => {
    const all = Object.values(s.tasks);
    const teamTasks = all.filter((t) => t.teamSlug === slug);
    const members: TeamMember[] = Object.values(s.volunteers)
      .filter((v) => v.teamSlug === slug && v.id !== s.meId)
      .map((v) => ({
        volunteer: v,
        status: memberStatus(v, all, s.now, s),
        task: all.filter((t) => t.assigneeId === v.id && isActive(t)).sort(byPriorityThenAge)[0],
        helping: all.find((t) => isActive(t) && t.helperIds.includes(v.id)),
      }))
      .sort((a, b) => TONE_RANK[a.status.tone] - TONE_RANK[b.status.tone] || a.volunteer.name.localeCompare(b.volunteer.name));
    return {
      team: slug ? (s.teams[slug] as Team | undefined) : undefined,
      members,
      /** Unassigned and queued, most urgent first. */
      openTasks: teamTasks.filter((t) => t.status === 'open' || t.status === 'queued').sort(byPriorityThenAge),
      activeTasks: teamTasks.filter(isActive).sort(byPriorityThenAge),
    };
  }, [s, slug]);
}

/** The whole event, for Mo and the map: every active task, every unassigned one, everyone on duty. */
export function useAllActive() {
  const s = useSnapshot();
  return useMemo(() => {
    const all = Object.values(s.tasks);
    return {
      active: all.filter(isActive).sort(byPriorityThenAge),
      open: all.filter((t) => t.status === 'open').sort(byPriorityThenAge),
      onDuty: Object.values(s.volunteers).filter((v) => v.duty === 'on_duty'),
    };
  }, [s.tasks, s.volunteers]);
}

/** One person for the Person sheet: status line, what they're on, what's queued, what they finished. */
export function usePerson(id: string | undefined) {
  const s = useSnapshot();
  return useMemo(() => {
    const volunteer = id ? s.volunteers[id] : undefined;
    if (!volunteer) return undefined;
    const all = Object.values(s.tasks);
    return {
      volunteer,
      team: volunteer.teamSlug ? s.teams[volunteer.teamSlug] : undefined,
      status: memberStatus(volunteer, all, s.now, s),
      active: all.filter((t) => t.assigneeId === id && isActive(t)).sort(byPriorityThenAge)[0],
      helping: all.find((t) => isActive(t) && t.helperIds.includes(volunteer.id)),
      queue: all.filter((t) => t.assigneeId === id && t.status === 'queued').sort(byPriorityThenAge),
      done: all.filter((t) => t.assigneeId === id && t.status === 'resolved').sort((a, b) => (b.resolvedAt ?? 0) - (a.resolvedAt ?? 0)),
    };
  }, [s, id]);
}

/** Who should take a task, best first, with why. For the Assign and Backup pickers. */
export function useCandidates(taskId: string | undefined, exclude: string[] = []) {
  const s = useSnapshot();
  const key = exclude.join(',');
  return useMemo(() => {
    const task = taskId ? s.tasks[taskId] : undefined;
    return task ? rankCandidates(task, Object.values(s.volunteers), Object.values(s.tasks), { exclude: key ? key.split(',') : [] }) : [];
  }, [s.tasks, s.volunteers, taskId, key]);
}

export function useProposal(id: string | undefined): Proposal | undefined {
  const s = useSnapshot();
  return id ? s.proposals[id] : undefined;
}

/** The pending proposal for a task, if any. */
export function useProposalForTask(taskId: string | undefined): Proposal | undefined {
  const s = useSnapshot();
  return useMemo(
    () => Object.values(s.proposals).find((p) => p.taskId === taskId && p.status === 'pending'),
    [s.proposals, taskId],
  );
}

// ── Festival-goer ──

export type RequestView = { request: GuestRequest; task?: Task; status: GuestStatus; volunteer?: Volunteer };

function requestView(s: ReturnType<typeof useSnapshot>, request: GuestRequest): RequestView {
  const task = request.taskId ? s.tasks[request.taskId] : undefined;
  const status = guestStage(request, task, s, s.now);
  return { request, task, status, volunteer: status.volunteerId ? s.volunteers[status.volunteerId] : undefined };
}

/** One request with its live stage ("Priya is coming · 3 min") and who's coming. */
export function useRequest(id: string | undefined): RequestView | undefined {
  const s = useSnapshot();
  return useMemo(() => {
    const r = id ? s.requests[id] : undefined;
    return r ? requestView(s, r) : undefined;
  }, [s, id]);
}

/** The festival-goer's requests, newest first. The snapshot only ever holds their own. */
export function useMyRequests(): RequestView[] {
  const s = useSnapshot();
  return useMemo(
    () => Object.values(s.requests).sort((a, b) => b.createdAt - a.createdAt).map((r) => requestView(s, r)),
    [s],
  );
}
