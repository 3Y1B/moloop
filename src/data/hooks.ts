import { useMemo, useSyncExternalStore } from 'react';

import { rankCandidates } from '@/lib/candidates';
import { isActive, isOnTask } from '@/lib/lifecycle';
import { needsFor, type NeedsItem } from '@/lib/needs';
import { meetingPoint, onSite, placeOf, PRESENCE, type Place } from '@/lib/presence';
import { routeBetween } from '@/lib/route';
import type { GuestRequest, Proposal, Task, Team, TeamSlug, Volunteer, VolunteerRole } from '@/lib/schema';
import { NODES, toPlan, VENUE_ZONES, type Point } from './venue';
import { getLatest, getPinned, subscribe as onFix } from './location';
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

/**
 * Where I am on the plan: my phone's GPS straight away, else what I last shared, else null (on the site, and
 * recent, or not at all). The map falls back to my zone.
 */
export function useMyPlace(): Point | null {
  const s = useSnapshot();
  const fix = useSyncExternalStore(onFix, getLatest);
  return useMemo(() => {
    // Set by hand: always where I am, however old the fix.
    if (fix && (getPinned() || s.now - fix.at <= PRESENCE.staleMs)) {
      const p = toPlan([fix.lng, fix.lat]);
      if (onSite(p)) return p;
    }
    const shared = placeOf(s.positions, s.meId, s.now);
    return shared && !shared.stale ? shared.at : null;
  }, [fix, s.now, s.positions, s.meId]);
}

/** Where to draw me: my live position, else my zone. */
export function useMyDot(): Point | null {
  const me = useMe();
  const here = useMyPlace();
  const zone = me?.zoneSlug ? VENUE_ZONES[me.zoneSlug] : undefined;
  return here ?? (zone ? NODES[zone.node] : null);
}

/** Someone else's live position, if any: `stale` once their phone has gone quiet for a minute. */
export function usePlaceOf(id: string | null | undefined): Place | null {
  const s = useSnapshot();
  return useMemo(() => placeOf(s.positions, id, s.now), [s.positions, id, s.now]);
}

/**
 * The festival-goer behind a task, where their phone says they are (they share it while someone's coming), when
 * that's where help is going: at or near what they reported (see meetingPoint).
 */
export function useReporterPlace(task: Task | undefined): Point | null {
  const s = useSnapshot();
  const guestId = task?.requestId ? s.requests[task.requestId]?.guestId : undefined;
  const zone = task?.zoneSlug ?? null;
  return useMemo(() => {
    const place = placeOf(s.positions, guestId, s.now);
    const meet = meetingPoint(place && !place.stale ? place.at : null, zone);
    return meet && typeof meet === 'object' ? meet : null;
  }, [s.positions, guestId, zone, s.now]);
}

/**
 * Walking route from where I am to a task: from my phone's position as I walk (else my zone), to the
 * festival-goer if their phone says where they are (else the task's zone). Null if either end is unknown.
 */
export function useRouteTo(task: Task | undefined) {
  const me = useMe();
  const here = useMyPlace();
  const there = useReporterPlace(task);
  const from = here ?? me?.zoneSlug ?? null;
  return useMemo(
    () => (task ? routeBetween(from, there ?? task.zoneSlug, task.locationHint) : null),
    [from, there, task?.zoneSlug, task?.locationHint], // eslint-disable-line react-hooks/exhaustive-deps
  );
}

// ── Leads and Mo ──

export type { NeedsItem, NeedsKind } from '@/lib/needs';

/** The lead's or Mo's "Needs you" list (lib/needs). */
export function useNeedsMe(): NeedsItem[] {
  const s = useSnapshot();
  return useMemo(() => needsFor(s, s.meId), [s.tasks, s.proposals, s.volunteers, s.meId]); // eslint-disable-line react-hooks/exhaustive-deps
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

/** Everyone on the crew but me, as team members, and every unassigned or queued task: Mo's map. */
export function useCrew() {
  const s = useSnapshot();
  return useMemo(() => {
    const all = Object.values(s.tasks);
    const members: TeamMember[] = Object.values(s.volunteers)
      .filter((v) => v.id !== s.meId)
      .map((v) => ({
        volunteer: v,
        status: memberStatus(v, all, s.now, s),
        task: all.filter((t) => t.assigneeId === v.id && isActive(t)).sort(byPriorityThenAge)[0],
        helping: all.find((t) => isActive(t) && t.helperIds.includes(v.id)),
      }));
    return { members, openTasks: all.filter((t) => t.status === 'open' || t.status === 'queued').sort(byPriorityThenAge) };
  }, [s]);
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
    return task
      ? rankCandidates(task, Object.values(s.volunteers), Object.values(s.tasks), { exclude: key ? key.split(',') : [], positions: s.positions, now: s.now })
      : [];
    // Positions move every few seconds: re-rank with them, not with every tick of the clock.
  }, [s.tasks, s.volunteers, s.positions, taskId, key]); // eslint-disable-line react-hooks/exhaustive-deps
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
