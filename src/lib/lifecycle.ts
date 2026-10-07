import type {
  EscalationResponse,
  EscalationResponseKind,
  HandoverTarget,
  HelperAssignment,
  IncidentCategory,
  Priority,
  Proposal,
  ReplyKind,
  Task,
  TaskStatus,
  Volunteer,
} from "@/lib/schema";

/**
 * The task state machine from docs/ARCHITECTURE.md as pure functions. Deterministic, no I/O:
 * the server's route handlers and reminder scheduler run it; tests inject the clock and policy.
 */

const MIN = 60_000;

export type Policy = {
  /** How long a volunteer has to accept a fresh assignment before we nudge. */
  ackTimeoutMs: number;
  /** Gap between first nudge and alerting the lead. */
  nudgeGapMs: number;
  /** Expected time to reach the scene / finish, by priority. */
  etaMs: Record<Priority, number>;
  delayExtendMs: number;
  /** An unanswered "need help" goes from the lead up to Mo after this long. */
  bumpToCoordinatorMs: Record<Priority, number>;
  /** P1/P2 guest reports: nobody approves the AI's pick in this long, the top pick is assigned. */
  autoAssignMs: number;
};

/** The shipped timings. */
export const DEFAULT_POLICY: Readonly<Policy> = {
  ackTimeoutMs: 2 * MIN,
  nudgeGapMs: 3 * MIN,
  etaMs: { P1: 4 * MIN, P2: 10 * MIN, P3: 20 * MIN },
  delayExtendMs: 5 * MIN,
  bumpToCoordinatorMs: { P1: 1 * MIN, P2: 2 * MIN, P3: 3 * MIN },
  autoAssignMs: 30_000,
};

/** The timings in force. */
export const POLICY: Readonly<Policy> = {
  ...DEFAULT_POLICY,
  etaMs: { ...DEFAULT_POLICY.etaMs },
  bumpToCoordinatorMs: { ...DEFAULT_POLICY.bumpToCoordinatorMs },
};

/** Override timings in place (the server reads them from env, so tests run fast). Everything reads POLICY at call time. */
export function setPolicy(overrides: Partial<Policy>) {
  Object.assign(POLICY as Policy, overrides);
}

/** Statuses where the volunteer is "busy" with this task. One per volunteer. */
export const ACTIVE: readonly TaskStatus[] = ["assigned", "accepted", "in_progress", "escalated"];
export const isActive = (t: Task) => ACTIVE.includes(t.status);

/** On this task as the owner or as backup. */
export const isOnTask = (t: Task, volunteerId: string) =>
  isActive(t) &&
  (t.assigneeId === volunteerId || t.helpers.some((h) => h.volunteerId === volunteerId));

/** A helper counts as busy, same as the owner. */
export const isBusy = (tasks: Task[], volunteerId: string) =>
  tasks.some((t) => isOnTask(t, volunteerId));

/** Who can go along as a helper: on duty and in shift, on the task's team, qualified, and free. assign() enforces it. */
export const canHelp = (task: Task, v: Volunteer, tasks: Task[], now: number) =>
  v.role === "volunteer" &&
  v.duty === "on_duty" &&
  (v.shiftEndsAt == null || v.shiftEndsAt > now) &&
  v.teamSlug === task.teamSlug &&
  (task.requiredSkills ?? []).every((skill) => v.skills.includes(skill)) &&
  !isBusy(tasks.filter((t) => t.id !== task.id), v.id);

/** Just the ids, for call sites that only need "who's on this task". */
export const helperIdsOf = (t: Task): string[] => t.helpers.map((h) => h.volunteerId);

/** People who have explicitly committed: an accepted owner plus accepted helpers. */
export const confirmedPeopleCount = (t: Task): number =>
  (t.status === "accepted" || t.status === "in_progress" || t.status === "escalated" ? 1 : 0) +
  t.helpers.filter((h) => h.status === "accepted").length;

/** Asked for help and nobody has settled it yet (a call still needs a follow-up). */
export const needsResponse = (t: Task) =>
  t.status === "escalated" &&
  (t.escalation?.response == null || t.escalation.response.kind === "call");

/** Went quiet: the scheduler alerted the lead. Not a status; the task keeps its own. */
export const isQuiet = (t: Task) =>
  isActive(t) && t.status !== "escalated" && t.leadAlertedAt != null;
/** Quiet since we first asked and got nothing back. */
export const quietSince = (t: Task) => t.lastNudgeAt ?? t.leadAlertedAt ?? t.lastActivityAt;

/** Categories about a person, where "Stay with them" makes sense. Never for restocking and the like. */
export const PERSON_CATEGORIES: readonly IncidentCategory[] = [
  "medical",
  "heat",
  "lost_child",
  "security",
  "accessibility",
];
export const isAboutPerson = (t: Task) => PERSON_CATEGORIES.includes(t.category);

/** P1/P2 guest reports get a proposal a human can approve; P3 assigns straight away. */
export const needsApproval = (p: Priority) => p !== "P3";

/**
 * Which replies are valid right now. `primary` is the one big button. Assignment is automatic,
 * so a fresh task is accept-or-decline; after that it's just done or need help. "Still on it"
 * is valid whenever you're on a task, but the UI only offers it once the scheduler has nudged.
 */
export function availableReplies(status: TaskStatus): {
  primary: ReplyKind | null;
  secondary: ReplyKind[];
} {
  switch (status) {
    case "assigned":
      return { primary: "accept", secondary: ["decline"] };
    case "accepted":
    case "in_progress":
      return { primary: "done", secondary: ["need_help", "still_on_it"] };
    case "escalated":
      return { primary: "done", secondary: ["still_on_it"] };
    default:
      return { primary: null, secondary: [] };
  }
}

/** Which replies make sense for a recruited helper's own slot, keyed on their status, not the task's. */
export function availableHelperReplies(status: HelperAssignment["status"]): {
  primary: ReplyKind | null;
  secondary: ReplyKind[];
} {
  return status === "accepted"
    ? { primary: "done", secondary: [] }
    : { primary: "accept", secondary: ["decline"] };
}

export type Transition = { task: Task; text: string };

/** Who a new "need help" goes to: the team lead, or Mo when the team has no lead. */
export type EscalationOwners = { leadId: string | null; coordinatorId: string | null };

/**
 * Apply a volunteer reply. Returns null if the reply is not valid in the current status.
 * `note` is kept as the escalation reason for need_help. `done` from the owner or a helper resolves it for everyone.
 */
export function applyReply(
  task: Task,
  reply: ReplyKind,
  now: number,
  note?: string,
  owners: EscalationOwners = { leadId: null, coordinatorId: null },
): Transition | null {
  const { primary, secondary } = availableReplies(task.status);
  if (reply !== primary && !secondary.includes(reply)) return null;

  // Any reply is a sign of life: clears nudges.
  const base: Task = {
    ...task,
    lastActivityAt: now,
    nudgeCount: 0,
    lastNudgeAt: null,
    leadAlertedAt: null,
  };
  const eta = now + POLICY.etaMs[task.priority];

  switch (reply) {
    case "accept":
      return { task: { ...base, status: "accepted", etaAt: eta }, text: "Accepted" };
    case "still_on_it":
      return {
        task: { ...base, etaAt: Math.max(task.etaAt ?? now, now) + POLICY.delayExtendMs },
        text: "Still on it, +5 min",
      };
    case "done":
      return {
        task: { ...base, status: "resolved", resolution: "done", resolvedAt: now, etaAt: null },
        text: "Done",
      };
    case "need_help": {
      const level = owners.leadId ? "lead" : "coordinator";
      const escalation = {
        at: now,
        reason: note?.trim() || null,
        level,
        ownerId: owners.leadId ?? owners.coordinatorId,
        bumpedAt: null,
        response: null,
      } as const;
      return {
        task: { ...base, status: "escalated", escalation },
        text:
          level === "lead" ? "Needs help, escalated to team lead" : "Needs help, escalated to Mo",
      };
    }
    case "decline":
      return {
        task: { ...base, status: "open", assigneeId: null, etaAt: null },
        text: "Declined, back to the pool",
      };
  }
}

/**
 * A recruited helper accepting or declining their own slot. Independent of `applyReply`: it never
 * touches the task's own `status`, only this one helper's entry. A decline removes the entry outright.
 */
export function applyHelperReply(
  task: Task,
  volunteerId: string,
  reply: "accept" | "decline",
  now: number,
): Transition | null {
  const i = task.helpers.findIndex((h) => h.volunteerId === volunteerId);
  if (i < 0 || task.helpers[i].status !== "notified") return null;
  if (reply === "decline") {
    return {
      task: { ...task, helpers: task.helpers.filter((_, idx) => idx !== i) },
      text: "Declined",
    };
  }
  const helpers = [...task.helpers];
  helpers[i] = { ...helpers[i], status: "accepted", respondedAt: now };
  return { task: { ...task, helpers }, text: "Accepted" };
}

export type Alert =
  | { kind: "nudge"; taskId: string; volunteerId: string; body: string }
  | { kind: "lead_alert"; taskId: string; volunteerId: string; body: string }
  | { kind: "bump"; taskId: string; volunteerId: string; body: string }
  | { kind: "remind"; taskId: string; body: string }
  | { kind: "helper_released"; taskId: string; volunteerId: string; body: string };

/** The intake agent escalated it: open, unassigned, waiting on a lead or Mo. The allocator never assigns it. */
export const isHeld = (t: Task) => t.status === 'open' && t.escalation?.source === 'intake';



/**
 * Scheduler step for one task. Not an LLM. Silence never closes a task:
 * nudge → (gap) → alert lead. P1 skips straight to the lead. An unanswered "need help" never
 * sits silent either: it moves from the lead up to Mo after POLICY.bumpToCoordinatorMs.
 */
export function tick(
  task: Task,
  now: number,
  coordinatorId: string | null = null,
): { task: Task; alerts: Alert[] } | null {
  const released = releaseSilentHelpers(task, now);
  const r = ownerTick(released?.task ?? task, now, coordinatorId);
  if (!released) return r;
  return { task: r?.task ?? released.task, alerts: [...released.alerts, ...(r?.alerts ?? [])] };
}

/**
 * A helper who never answers would count as busy forever. After the same window an owner gets before the lead hears
 * (ack timeout + nudge gap), they're let go and the lead is told.
 */
function releaseSilentHelpers(task: Task, now: number): { task: Task; alerts: Alert[] } | null {
  if (!isActive(task)) return null;
  const silent = task.helpers.filter(
    (h) => h.status === "notified" && now - h.assignedAt > POLICY.ackTimeoutMs + POLICY.nudgeGapMs,
  );
  if (!silent.length) return null;
  return {
    task: { ...task, helpers: task.helpers.filter((h) => !silent.includes(h)) },
    alerts: silent.map((h) => ({
      kind: "helper_released",
      taskId: task.id,
      volunteerId: h.volunteerId,
      body: `No answer from a helper on "${task.title}". Released.`,
    })),
  };
}

function ownerTick(
  task: Task,
  now: number,
  coordinatorId: string | null,
): { task: Task; alerts: Alert[] } | null {
  if (task.status === "escalated") return bump(task, now, coordinatorId);
  if (isHeld(task)) return holdTick(task, now, coordinatorId);
  if (!isActive(task) || !task.assigneeId || task.leadAlertedAt) return null;

  const overdue =
    task.status === "assigned"
      ? now - (task.assignedAt ?? task.createdAt) > POLICY.ackTimeoutMs
      : task.etaAt != null && now > task.etaAt;
  if (!overdue) return null;

  const who = task.assigneeId;
  const alertLead = (): { task: Task; alerts: Alert[] } => ({
    task: { ...task, leadAlertedAt: now },
    alerts: [
      {
        kind: "lead_alert",
        taskId: task.id,
        volunteerId: who,
        body: `No update on "${task.title}". Lead alerted.`,
      },
    ],
  });

  if (task.priority === "P1") return alertLead();
  if (task.nudgeCount === 0) {
    return {
      task: { ...task, nudgeCount: 1, lastNudgeAt: now },
      alerts: [{ kind: "nudge", taskId: task.id, volunteerId: who, body: nudgeCopy(task) }],
    };
  }
  if (task.lastNudgeAt != null && now - task.lastNudgeAt > POLICY.nudgeGapMs) return alertLead();
  return null;
}

function bump(
  task: Task,
  now: number,
  coordinatorId: string | null,
): { task: Task; alerts: Alert[] } | null {
  const e = task.escalation;
  if (
    !e ||
    e.level !== "lead" ||
    e.response ||
    now - e.at <= POLICY.bumpToCoordinatorMs[task.priority]
  )
    return null;
  return {
    task: {
      ...task,
      escalation: { ...e, level: "coordinator", ownerId: coordinatorId, bumpedAt: now },
    },
    alerts: [
      {
        kind: "bump",
        taskId: task.id,
        volunteerId: task.assigneeId ?? "",
        body: `No response from the lead on "${task.title}". Passed to Mo.`,
      },
    ],
  };
}

/** A held escalation never sits silent: a lead's moves up to Mo like "need help"; Mo's is re-sent every nudge gap. */
function holdTick(task: Task, now: number, coordinatorId: string | null): { task: Task; alerts: Alert[] } | null {
  const e = task.escalation!;
  if (e.level === 'lead') return bump(task, now, coordinatorId);
  const since = Math.max(task.lastNudgeAt ?? 0, e.bumpedAt ?? e.at);
  if (now - since <= POLICY.nudgeGapMs) return null;
  return {
    task: { ...task, nudgeCount: task.nudgeCount + 1, lastNudgeAt: now },
    alerts: [{ kind: 'remind', taskId: task.id, body: `Still waiting for your call: ${task.title}.` }],
  };
}

/** "Pass to Mo" by hand. */
export function passUp(task: Task, coordinatorId: string | null, now: number): Transition | null {
  const e = task.escalation;
  if ((task.status !== "escalated" && !isHeld(task)) || !e || e.level !== "lead") return null;
  return {
    task: {
      ...task,
      escalation: { ...e, level: "coordinator", ownerId: coordinatorId, bumpedAt: now },
    },
    text: "Passed to Mo",
  };
}

/** What a lead or Mo picked on the Respond sheet. The repo fills in `etaAt` (route time) before applying it. */
export type RespondInput = {
  kind: EscalationResponseKind;
  /** Backup or reassign target. */
  volunteerId?: string;
  target?: HandoverTarget;
  etaAt?: number;
  note?: string;
};

/** Which responses make sense right now. "Went quiet" only gets Call, Reassign and Carry on ("They're fine"). */
export function availableResponses(task: Task): EscalationResponseKind[] {
  if (task.status === "escalated") {
    if (task.escalation?.response?.kind === "handover") return [];
    const after = task.escalation?.response?.kind === "call" ? ["carry_on" as const] : [];
    return ["backup", "handover", "reassign", "call", "close", ...after];
  }
  return isQuiet(task) ? ["call", "reassign", "carry_on"] : [];
}

/**
 * Apply a lead's or Mo's response to "need help" or "went quiet". Returns null if it doesn't fit.
 * Reassign needs to know if the new volunteer is busy (assign vs queue); the caller promotes the
 * original volunteer's next queued task.
 */
export function respondToEscalation(
  task: Task,
  input: RespondInput,
  byId: string,
  now: number,
  targetBusy = false,
): Transition | null {
  if (!availableResponses(task).includes(input.kind)) return null;
  const response: EscalationResponse = { kind: input.kind, byId, at: now, ...pick(input) };
  const escalation = task.escalation ? { ...task.escalation, response } : null;
  // A response is a human taking charge: nudges start over.
  const calm = { lastActivityAt: now, nudgeCount: 0, lastNudgeAt: null, leadAlertedAt: null };

  switch (input.kind) {
    case "backup": {
      const v = input.volunteerId;
      if (!v || v === task.assigneeId || task.helpers.some((h) => h.volunteerId === v)) return null;
      // A lead hand-picking someone is already a human decision: immediately accepted, no own accept/decline step.
      const helper: HelperAssignment = {
        volunteerId: v,
        status: "accepted",
        assignedAt: now,
        respondedAt: now,
      };
      return {
        task: {
          ...task,
          ...calm,
          status: "accepted",
          escalation,
          helpers: [...task.helpers, helper],
          etaAt: now + POLICY.etaMs[task.priority],
        },
        text: "Backup sent",
      };
    }
    case "handover":
      if (!input.target) return null;
      return {
        task: { ...task, ...calm, escalation },
        text: `Handing over to ${HANDOVER_NAME[input.target]}`,
      };
    case "reassign": {
      if (!input.volunteerId || input.volunteerId === task.assigneeId) return null;
      const fresh: Task = {
        ...task,
        ...calm,
        escalation: null,
        helpers: [],
        etaAt: null,
        status: "open",
        assigneeId: null,
      };
      return { task: assignOrQueue(fresh, input.volunteerId, targetBusy, now), text: "Reassigned" };
    }
    case "call":
      // Stays escalated until the follow-up. For "went quiet" it's only a note on the timeline.
      return { task: escalation ? { ...task, escalation } : task, text: "Called" };
    case "close":
      return {
        task: {
          ...task,
          ...calm,
          status: "cancelled",
          resolution: "cancelled",
          resolvedAt: now,
          etaAt: null,
          escalation,
        },
        text: input.note ? `Closed: ${input.note}` : "Closed, not needed",
      };
    case "carry_on":
      return {
        task: {
          ...task,
          ...calm,
          escalation: null,
          status: task.status === "escalated" ? "accepted" : task.status,
          etaAt: Math.max(task.etaAt ?? now, now) + POLICY.delayExtendMs,
        },
        text: "Carry on",
      };
  }
}

const pick = ({ volunteerId, target, etaAt, note }: RespondInput) =>
  Object.fromEntries(
    Object.entries({ volunteerId, target, etaAt, note }).filter(([, v]) => v != null),
  ) as Partial<EscalationResponse>;

export const HANDOVER_NAME: Record<HandoverTarget, string> = {
  medics: "medics",
  security: "security",
  emergency: "emergency services",
};

/** The lead taps "Arrived" after a handover: the volunteer is freed and the task is done. */
export function handoverArrived(task: Task, now: number): Transition | null {
  const r = task.escalation?.response;
  if (task.status !== "escalated" || r?.kind !== "handover" || !r.target) return null;
  return {
    task: {
      ...task,
      status: "resolved",
      resolution: "handed_over",
      resolvedAt: now,
      etaAt: null,
      lastActivityAt: now,
    },
    text: `Handed to ${HANDOVER_NAME[r.target]}`,
  };
}

/** Nobody approved or changed the AI's pick in time. */
export const proposalDue = (p: Proposal, now: number) =>
  p.status === "pending" && now >= p.autoAssignAt;

function nudgeCopy(task: Task) {
  return task.status === "assigned"
    ? `New task waiting: "${task.title}". Can you take it?`
    : `Still on "${task.title}"? Send a quick update.`;
}

/** One active task per volunteer: busy → queue, free → assign. */
export function assignOrQueue(
  task: Task,
  volunteerId: string,
  volunteerBusy: boolean,
  now: number,
): Task {
  return volunteerBusy
    ? { ...task, assigneeId: volunteerId, status: "queued" }
    : {
        ...task,
        assigneeId: volunteerId,
        status: "assigned",
        assignedAt: now,
        lastActivityAt: now,
      };
}

/** When a volunteer frees up, their oldest highest-priority queued task becomes active. */
export function nextQueued(tasks: Task[], volunteerId: string): Task | undefined {
  return tasks
    .filter((t) => t.status === "queued" && t.assigneeId === volunteerId)
    .sort((a, b) => a.priority.localeCompare(b.priority) || a.createdAt - b.createdAt)[0];
}
