import type { Priority, ReplyKind, TaskStatus } from '@/lib/schema';

export const REPLY_LABEL: Record<ReplyKind, string> = {
  accept: 'Accept',
  decline: 'Decline',
  done: 'Done',
  need_help: 'Need help',
  still_on_it: 'Still on it',
};

/** SF Symbol per reply, used on buttons and in the timeline. */
export const REPLY_SF: Record<ReplyKind, string> = {
  accept: 'checkmark',
  decline: 'xmark',
  done: 'checkmark.circle.fill',
  need_help: 'exclamationmark.bubble.fill',
  still_on_it: 'clock.arrow.circlepath',
};

export const STATUS_LABEL: Record<TaskStatus, string> = {
  open: 'Unassigned',
  queued: 'Up next',
  assigned: 'New',
  accepted: 'On it',
  in_progress: 'On it',
  escalated: 'Help coming',
  resolved: 'Done',
  cancelled: 'Cancelled',
};

export const PRIORITY_LABEL: Record<Priority, string> = { P1: 'Critical', P2: 'Urgent', P3: 'Routine' };

export function ago(at: number, now: number) {
  const s = Math.max(0, Math.round((now - at) / 1000));
  if (s < 45) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60 ? `${m % 60}m ` : ''}ago`;
}

/** "Due in 4 min" / "3 min overdue". */
export function due(etaAt: number, now: number) {
  const m = Math.round((etaAt - now) / 60_000);
  if (m > 0) return { text: `Due in ${m} min`, overdue: false };
  if (m === 0) return { text: 'Due now', overdue: false };
  return { text: `${-m} min overdue`, overdue: true };
}

export function clockTime(at: number) {
  const d = new Date(at);
  const h = d.getHours();
  const m = d.getMinutes().toString().padStart(2, '0');
  return `${h % 12 || 12}:${m}${h < 12 ? 'am' : 'pm'}`;
}

export const initials = (name: string) =>
  name.split(/\s+/).map((p) => p[0]).slice(0, 2).join('').toUpperCase();

const LANGUAGE_NAME: Record<string, string> = {
  vi: 'Vietnamese', hi: 'Hindi', es: 'Spanish', ko: 'Korean', zh: 'Chinese', ar: 'Arabic', en: 'English',
};
export const languageName = (code: string) => LANGUAGE_NAME[code] ?? code;
