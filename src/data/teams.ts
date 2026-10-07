import type { Team } from '@/lib/schema';

/** Each team's colour and icons. The database has the names; these are how the app draws them. */
export const TEAMS: Team[] = [
  { slug: 'first-aid', name: 'First Aid & Heat', color: '#FF3B30', sf: 'cross.case.fill', md: 'medical_services' },
  { slug: 'welfare', name: 'Welfare & Lost Kids', color: '#FF9500', sf: 'figure.and.child.holdinghands', md: 'family_restroom' },
  { slug: 'crowd', name: 'Crowd & Gates', color: '#AF52DE', sf: 'person.3.fill', md: 'groups' },
  { slug: 'security', name: 'Security Liaison', color: '#34C759', sf: 'shield.lefthalf.filled', md: 'shield' },
  { slug: 'info', name: 'Access & Info', color: '#30B0C7', sf: 'info.circle.fill', md: 'info' },
  { slug: 'artist', name: 'Artist Liaison', color: '#FF2D55', sf: 'music.mic', md: 'mic' },
  { slug: 'vendors', name: 'Food & Vendors', color: '#A2845E', sf: 'fork.knife', md: 'restaurant' },
  { slug: 'ops', name: 'Tech & Logistics', color: '#5856D6', sf: 'wrench.and.screwdriver.fill', md: 'build' },
];
