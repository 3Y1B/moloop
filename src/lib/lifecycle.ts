import type { Priority, ReplyKind, Task, TaskStatus } from '@/lib/schema';

/**
 * The task state machine from docs/ARCHITECTURE.md as pure functions. Deterministic, no I/O:
 * the mock repo runs it in-process today, the server (route handlers + nudge scheduler) runs it later.
 */

const MIN = 60_000;

export const POLICY = {
  /** How long a volunteer has to accept a fresh assignment before we nudge. */
  ackTimeoutMs: 2 * MIN,
  /** Gap between first nudge and alerting the lead. */
  nudgeGapMs: 3 * MIN,
  /** Expected time to reach the scene / finish, by priority. */
  etaMs: { P1: 4 * MIN, P2: 10 * MIN, P3: 20 * MIN } satisfies Record<Priority, number>,
  delayExtendMs: 5 * MIN,
} as const;

/** Statuses where the volunteer is "busy" with this task. One per volunteer. */
export const ACTIVE: readonly TaskStatus[] = ['assigned', 'accepted', 'in_progress', 'escalated'];
export const isActive = (t: Task) => ACTIVE.includes(t.status);

/**
 * Which replies are valid right now. `primary` is the one big button. Assignment is automatic,
 * so a fresh task is accept-or-decline; after that it's just done or need help. "Still on it"
 * is valid whenever you're on a task, but the UI only offers it once the scheduler has nudged.
 */
export function availableReplies(status: TaskStatus): { primary: ReplyKind | null; secondary: ReplyKind[] } {
  switch (status) {
    case 'assigned':
      return { primary: 'accept', secondary: ['decline'] };
    case 'accepted':
    case 'in_progress':
      return { primary: 'done', secondary: ['need_help', 'still_on_it'] };
    case 'escalated':
      return { primary: 'done', secondary: ['still_on_it'] };
    default:
      return { primary: null, secondary: [] };
  }
}

export type Transition = { task: Task; text: string };

/** Apply a volunteer reply. Returns null if the reply is not valid in the current status. */
export function applyReply(task: Task, reply: ReplyKind, now: number): Transition | null {
  const { primary, secondary } = availableReplies(task.status);
  if (reply !== primary && !secondary.includes(reply)) return null;

  // Any reply is a sign of life: clears nudges.
  const base: Task = { ...task, lastActivityAt: now, nudgeCount: 0, lastNudgeAt: null, leadAlertedAt: null };
  const eta = now + POLICY.etaMs[task.priority];

  switch (reply) {
    case 'accept':
      return { task: { ...base, status: 'accepted', etaAt: eta }, text: 'Accepted' };
    case 'still_on_it':
      return {
        task: { ...base, etaAt: Math.max(task.etaAt ?? now, now) + POLICY.delayExtendMs },
        text: 'Still on it, +5 min',
      };
    case 'done':
      return { task: { ...base, status: 'resolved', resolvedAt: now, etaAt: null }, text: 'Done' };
    case 'need_help':
      return { task: { ...base, status: 'escalated' }, text: 'Needs help, escalated to team lead' };
    case 'decline':
      return { task: { ...base, status: 'open', assigneeId: null, etaAt: null }, text: 'Declined, back to the pool' };
  }
}

export type Alert =
  | { kind: 'nudge'; taskId: string; volunteerId: string; body: string }
  | { kind: 'lead_alert'; taskId: string; volunteerId: string; body: string };

/**
 * Scheduler step for one task. Not an LLM. Silence never closes a task:
 * nudge → (gap) → alert lead. P1 skips straight to the lead.
 */
export function tick(task: Task, now: number): { task: Task; alerts: Alert[] } | null {
  if (!isActive(task) || !task.assigneeId || task.leadAlertedAt) return null;
  if (task.status === 'escalated') return null; // a human already owns it

  const overdue =
    task.status === 'assigned'
      ? now - (task.assignedAt ?? task.createdAt) > POLICY.ackTimeoutMs
      : task.etaAt != null && now > task.etaAt;
  if (!overdue) return null;

  const who = task.assigneeId;
  const alertLead = (): { task: Task; alerts: Alert[] } => ({
    task: { ...task, leadAlertedAt: now },
    alerts: [{ kind: 'lead_alert', taskId: task.id, volunteerId: who, body: `No update on "${task.title}". Lead alerted.` }],
  });

  if (task.priority === 'P1') return alertLead();
  if (task.nudgeCount === 0) {
    return {
      task: { ...task, nudgeCount: 1, lastNudgeAt: now },
      alerts: [{ kind: 'nudge', taskId: task.id, volunteerId: who, body: nudgeCopy(task) }],
    };
  }
  if (task.lastNudgeAt != null && now - task.lastNudgeAt > POLICY.nudgeGapMs) return alertLead();
  return null;
}

function nudgeCopy(task: Task) {
  return task.status === 'assigned'
    ? `New task waiting: "${task.title}". Can you take it?`
    : `Still on "${task.title}"? Send a quick update.`;
}

/** One active task per volunteer: busy → queue, free → assign. */
export function assignOrQueue(task: Task, volunteerId: string, volunteerBusy: boolean, now: number): Task {
  return volunteerBusy
    ? { ...task, assigneeId: volunteerId, status: 'queued' }
    : { ...task, assigneeId: volunteerId, status: 'assigned', assignedAt: now, lastActivityAt: now };
}

/** When a volunteer frees up, their oldest highest-priority queued task becomes active. */
export function nextQueued(tasks: Task[], volunteerId: string): Task | undefined {
  return tasks
    .filter((t) => t.status === 'queued' && t.assigneeId === volunteerId)
    .sort((a, b) => a.priority.localeCompare(b.priority) || a.createdAt - b.createdAt)[0];
}
