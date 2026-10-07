import { VENUE_ZONES } from '@/data/venue';
import { HANDOVER_NAME, isAboutPerson, isActive, isHeld, isQuiet, needsResponse, quietSince } from '@/lib/lifecycle';
import { routeBetween } from '@/lib/route';
import { meetingPoint, walkFrom } from '@/lib/presence';
import type { GuestRequest, GuestRequestStage, HandoverTarget, Position, Task, Volunteer, Zone } from '@/lib/schema';

/**
 * Every status line in the app comes from here, so every screen says the same thing.
 * Copy rule: state the action only. No narrating hints.
 * Tables: docs/SCREENS.md, "What the volunteer sees" and "What a lead or Mo sees about a team member".
 */

export type Tone = 'neutral' | 'tint' | 'warning' | 'danger' | 'success';

export type StatusAction =
  /** Opens the reply sheet for a check-in ("Still on it"). */
  | { kind: 'update'; taskId: string }
  /** Opens the dialer. */
  | { kind: 'call'; phone: string; name: string };

export type Status = { label: string; detail?: string; tone: Tone; action?: StatusAction };

export type StatusLookups = {
  volunteers: Record<string, Volunteer>;
  zones?: Record<string, Zone>;
  /** Live GPS, and the festival-goer on this device: "coming" counts down from where the volunteer really is. */
  positions?: Record<string, Position>;
  guestId?: string | null;
};

const MIN = 60_000;
const STAY = 'Stay with them';

const mins = (from: number, now: number) => `${Math.max(1, Math.round((now - from) / MIN))} min`;
const first = (v: Volunteer | undefined) => v?.name.split(' ')[0];
const leadOf = (task: Task, volunteers: Record<string, Volunteer>) =>
  Object.values(volunteers).find((v) => v.role === 'team_lead' && v.teamSlug === task.teamSlug);
const coordinatorOf = (volunteers: Record<string, Volunteer>) => Object.values(volunteers).find((v) => v.role === 'coordinator');
const zoneLabel = (slug: string | null, zones?: Record<string, Zone>) =>
  slug ? VENUE_ZONES[slug]?.label ?? zones?.[slug]?.name ?? null : null;
const stay = (task: Task) => (isAboutPerson(task) ? STAY : undefined);

const ON_THE_WAY: Record<HandoverTarget, string> = {
  medics: 'Medics on the way',
  security: 'Security on the way',
  emergency: 'Emergency services on the way',
};

/**
 * The top line of a task card, for whoever is looking: the owner, a helper, or a lead/Mo watching.
 * `viewerId` is the person looking (usually meId).
 */
export function taskStatusFor(viewerId: string | null, task: Task, { volunteers }: StatusLookups, now: number): Status {
  const e = task.escalation;
  const r = e?.response;

  if (task.status === 'resolved') {
    return task.resolution === 'handed_over' && r?.target
      ? { label: `Handed to ${HANDOVER_NAME[r.target]}`, tone: 'neutral' }
      : { label: 'Done', tone: 'success' };
  }
  if (task.status === 'cancelled') return { label: 'Closed', tone: 'neutral' };

  if (viewerId && task.helperIds.includes(viewerId) && isActive(task)) {
    return { label: `Helping ${first(volunteers[task.assigneeId ?? '']) ?? 'a teammate'}`, detail: stay(task), tone: 'tint' };
  }

  const owner = task.assigneeId ? volunteers[task.assigneeId] : undefined;
  const mine = !!viewerId && task.assigneeId === viewerId;

  switch (task.status) {
    case 'open':
      if (isHeld(task) && e) return { label: e.level === 'coordinator' ? 'Needs Mo’s call' : 'Needs a lead’s call', detail: e.reason ?? undefined, tone: 'warning' };
      return { label: 'Unassigned', tone: 'warning' };
    case 'queued':
      return { label: mine ? 'Up next' : `Up next for ${first(owner)}`, tone: 'neutral' };
    case 'assigned':
      return mine
        ? { label: 'New task', tone: 'tint' }
        : { label: `Sent to ${first(owner)} · ${mins(task.assignedAt ?? task.createdAt, now)}`, tone: 'neutral' };
    case 'escalated': {
      if (r?.kind === 'handover' && r.target) return { label: ON_THE_WAY[r.target], detail: mine ? stay(task) : undefined, tone: 'tint' };
      if (mine && r?.kind === 'call') {
        const caller = volunteers[r.byId];
        return {
          label: `${first(caller) ?? 'Your lead'} is calling you`,
          tone: 'tint',
          action: caller?.phone ? { kind: 'call', phone: caller.phone, name: caller.name } : undefined,
        };
      }
      if (mine) {
        const to = (e?.ownerId ? volunteers[e.ownerId] : undefined)
          ?? (e?.level === 'coordinator' ? coordinatorOf(volunteers) : leadOf(task, volunteers));
        const name = first(to);
        return { label: `Asked ${name ? `${name} ` : ''}for help · ${mins(e?.at ?? task.lastActivityAt, now)}`, tone: 'danger' };
      }
      return {
        label: `Asked for help · ${mins(e?.at ?? task.lastActivityAt, now)}`,
        detail: r?.kind === 'call' ? `${first(volunteers[r.byId])} called` : e?.level === 'coordinator' ? 'Passed to Mo' : undefined,
        tone: 'danger',
      };
    }
    default: {
      // accepted / in_progress. A check-in outranks backup news: it asks the volunteer to do something.
      if (mine && task.leadAlertedAt) {
        return { label: `${first(leadOf(task, volunteers)) ?? 'Your lead'} asked for an update`, tone: 'warning', action: { kind: 'update', taskId: task.id } };
      }
      if (mine && task.nudgeCount > 0) return { label: 'Send an update', tone: 'warning', action: { kind: 'update', taskId: task.id } };
      if (!mine && isQuiet(task)) return { label: `Quiet · ${mins(quietSince(task), now)}`, tone: 'warning' };
      if (r?.kind === 'backup' && r.volunteerId) {
        const left = r.etaAt != null && r.etaAt > now ? ` · ~${Math.ceil((r.etaAt - now) / MIN)} min` : '';
        return { label: `${first(volunteers[r.volunteerId]) ?? 'Backup'} joining${left}`, detail: mine ? stay(task) : undefined, tone: 'tint' };
      }
      const since = mins(task.assignedAt ?? task.createdAt, now);
      return { label: mine ? `On it · ${since}` : `${first(owner)} on it · ${since}`, tone: 'neutral' };
    }
  }
}

/** One line about a team member, for a lead or Mo. */
export function memberStatus(volunteer: Volunteer, tasks: Task[], now: number, { volunteers, zones }: StatusLookups): Status {
  const own = tasks
    .filter((t) => t.assigneeId === volunteer.id && isActive(t))
    .sort((a, b) => a.priority.localeCompare(b.priority) || a.createdAt - b.createdAt)[0];
  const helping = tasks.find((t) => isActive(t) && t.helperIds.includes(volunteer.id));

  if (own && needsResponse(own)) return { label: `Asked for help · ${mins(own.escalation?.at ?? own.lastActivityAt, now)}`, tone: 'danger' };
  if (own && isQuiet(own)) return { label: `Quiet · ${mins(quietSince(own), now)}`, tone: 'warning' };
  if (helping) {
    const where = zoneLabel(helping.zoneSlug, zones);
    return { label: `Helping ${first(volunteers[helping.assigneeId ?? '']) ?? 'a teammate'}${where ? ` · ${where}` : ''}`, tone: 'tint' };
  }
  if (own) return { label: `${own.title} · ${mins(own.assignedAt ?? own.createdAt, now)}`, tone: 'neutral' };
  if (volunteer.duty === 'on_break') return { label: 'On break', tone: 'neutral' };
  if (volunteer.duty === 'off_shift') return { label: 'Off shift', tone: 'neutral' };
  const where = zoneLabel(volunteer.zoneSlug, zones);
  return { label: where ? `Free · ${where}` : 'Free', tone: 'success' };
}

export type GuestStatus = Status & {
  stage: GuestRequestStage;
  /** Who is coming, or who they're matched with while still `finding`. */
  volunteerId?: string;
  /** When they should be with the festival-goer: the walk left from where their phone is, else from where they were when assigned. */
  arriveAt?: number;
  /** `arriveAt` comes from where they really are, not from the clock. */
  live?: boolean;
};

/** What the festival-goer sees. Derived from the task once there is one; the stored stage covers the steps before. */
export function guestStage(request: GuestRequest, task: Task | undefined, { volunteers, positions, guestId }: StatusLookups, now: number): GuestStatus {
  if (request.stage === 'cancelled') return { stage: 'cancelled', label: 'Cancelled', tone: 'neutral' };
  if (!task) {
    // Answered isn't done: it's sorted once they say the answer solved it.
    if (request.stage === 'answered') return { stage: 'answered', label: 'Answered', tone: 'tint' };
    if (request.stage === 'sorted') return { stage: 'sorted', label: 'Sorted', tone: 'success' };
    if (request.stage === 'understanding') return { stage: 'understanding', label: 'Understanding', tone: 'neutral' };
    return { stage: 'finding', label: 'Finding someone', tone: 'tint' };
  }

  if (task.status === 'cancelled') return { stage: 'cancelled', label: 'Closed', tone: 'neutral' };
  if (task.status === 'resolved') return { stage: 'sorted', label: 'Sorted', tone: 'success' };
  const v = task.assigneeId ? volunteers[task.assigneeId] : undefined;
  // Matched but not moving yet: queued behind their current task, or sent and waiting for them to accept.
  if ((task.status === 'queued' || task.status === 'assigned') && v) {
    return {
      stage: 'finding',
      label: `Matched with ${first(v)}`,
      detail: task.status === 'queued' ? 'Finishing a task' : undefined,
      tone: 'tint',
      volunteerId: v.id,
    };
  }
  if (task.status === 'open' || task.status === 'queued' || task.status === 'assigned') {
    return { stage: 'finding', label: 'Finding someone', tone: 'tint' };
  }

  const r = task.escalation?.response;
  if (r?.kind === 'handover' && r.target) return { stage: 'coming', label: ON_THE_WAY[r.target], tone: 'tint', volunteerId: v?.id };

  // Their phone says where they are: count down the walk that's left, and say so when they're here.
  const from = v ? walkFrom(positions, v.id, null, now) : null;
  if (v && from) {
    const guest = walkFrom(positions, guestId, null, now);
    const left = routeBetween(from, meetingPoint(typeof guest === 'object' ? guest : null, task.zoneSlug));
    if (left?.here) return { stage: 'with_you', label: `${first(v)} is here`, tone: 'tint', volunteerId: v.id, arriveAt: now, live: true };
    if (left) {
      return { stage: 'coming', label: `${first(v)} is coming · ${left.minutes} min`, tone: 'tint', volunteerId: v.id, arriveAt: now + left.minutes * MIN, live: true };
    }
  }

  const walk = routeBetween(v?.zoneSlug ?? null, task.zoneSlug);
  const arriveAt = (task.assignedAt ?? task.createdAt) + (walk?.minutes ?? 0) * MIN;
  if (now < arriveAt) {
    return { stage: 'coming', label: `${first(v) ?? 'Someone'} is coming · ${Math.ceil((arriveAt - now) / MIN)} min`, tone: 'tint', volunteerId: v?.id, arriveAt };
  }
  return { stage: 'with_you', label: `${first(v) ?? 'Someone'} should be with you`, tone: 'tint', volunteerId: v?.id, arriveAt };
}
