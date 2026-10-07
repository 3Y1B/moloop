import type { VolunteerRole } from '@/lib/schema/domain';

/** The route group each kind of user lives in. */
export type Home = '(mo)' | '(staff)' | '(guest)';

/** Where a signed-in user belongs: Mo has a console, leads and volunteers the map and sheet. Null until the role loads. */
export function homeFor(role: 'guest' | VolunteerRole | null): Home | null {
  if (!role) return null;
  if (role === 'guest') return '(guest)';
  return role === 'coordinator' ? '(mo)' : '(staff)';
}
