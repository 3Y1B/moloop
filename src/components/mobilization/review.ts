import { ago } from '@/lib/format';
import { freeForSteps, isFree } from '@/lib/lifecycle';
import { observationDefinition } from '@/lib/mobilization-observations';
import type { Mobilization, MobilizationCause, ReadingValue, Task, Volunteer } from '@/lib/schema';

type PlaceName = (slug: string | null | undefined) => string | null;
type Reading = Extract<MobilizationCause, { kind: 'reading' }>;
type Report = Extract<MobilizationCause, { kind: 'report' }>;

/** Plainer words than the catalog's for the readings a playbook fires on. */
const SHORT_LABEL: Record<string, string> = {
  'weather.windSpeed': 'Wind',
  'weather.lightningDistance': 'Lightning',
  'water.tankLevels': 'Water tank',
};
const TIGHT_UNITS = new Set(['°C', '%']);

function readingValue(key: string, value: ReadingValue): string {
  const definition = observationDefinition(key);
  const label = SHORT_LABEL[key] ?? definition?.label ?? key;
  if (typeof value === 'boolean') return value ? label : `${label}: no`;
  if (typeof value === 'string') return `${label}: ${value.replaceAll('_', ' ')}`;
  const unit = definition?.unit;
  if (!unit) return `${label} ${value}`;
  return `${label} ${value}${TIGHT_UNITS.has(unit) ? '' : ' '}${unit}`;
}

/**
 * One plain line per thing that set the plan off: "Wind 72 km/h at Oval Stage (limit 60 km/h), 2 min ago",
 * "3 reports at Oval Stage in 8 min". A reading shows only its latest value per place.
 */
export function causeLines(causes: readonly MobilizationCause[], now: number, place: PlaceName): string[] {
  const readings = new Map<string, Reading>();
  const reports = new Map<string, Report[]>();
  const order: string[] = [];
  for (const cause of causes) {
    if (cause.kind === 'reading') {
      const key = `reading|${cause.key}|${cause.zoneSlug ?? ''}`;
      const seen = readings.get(key);
      if (!seen) order.push(key);
      if (!seen || cause.at >= seen.at) readings.set(key, cause);
    } else {
      const key = `report|${cause.zoneSlug ?? ''}`;
      const group = reports.get(key);
      if (group) group.push(cause);
      else {
        order.push(key);
        reports.set(key, [cause]);
      }
    }
  }
  return order.map((key) => {
    const reading = readings.get(key);
    if (reading) {
      const where = place(reading.zoneSlug);
      return [
        readingValue(reading.key, reading.value),
        where ? ` at ${where}` : '',
        reading.line ? ` (${reading.line})` : '',
        `, ${ago(reading.at, now)}`,
      ].join('');
    }
    const group = reports.get(key)!;
    const where = place(group[0].zoneSlug);
    if (group.length === 1) {
      const [report] = group;
      return [report.title, where, ago(report.at, now)].filter(Boolean).join(', ');
    }
    const times = group.map((report) => report.at);
    const span = Math.max(1, Math.round((Math.max(...times) - Math.min(...times)) / 60_000));
    return `${group.length} reports${where ? ` at ${where}` : ''} in ${span} min`;
  });
}

/**
 * People a proposed plan can't fill right now: per step, its team's free people on shift with the skills it needs,
 * each counted once. Approval staffs what it can and keeps trying for the rest.
 */
export function shortfall(mobilization: Mobilization, volunteers: Record<string, Volunteer>, tasks: Task[], now: number) {
  const got = freeForSteps(mobilization.steps, Object.values(volunteers), tasks, now);
  return mobilization.steps.reduce((short, step, i) => short + step.peopleNeeded - got[i], 0);
}

/** Where a proposed step's people would come from: the places of its suggested crew who are still free. */
export function fromPlaces(
  step: Mobilization['steps'][number],
  volunteers: Record<string, Volunteer>,
  tasks: Task[],
  now: number,
  place: PlaceName,
): string | null {
  const names: string[] = [];
  let taken = 0;
  for (const candidate of step.candidates) {
    if (taken >= step.peopleNeeded) break;
    const volunteer = volunteers[candidate.volunteerId];
    if (!volunteer || volunteer.teamSlug !== step.teamSlug || !isFree(volunteer, step.requiredSkills ?? [], tasks, now))
      continue;
    taken += 1;
    const name = place(volunteer.zoneSlug);
    if (name && !names.includes(name)) names.push(name);
  }
  if (!names.length) return null;
  return names.length <= 2 ? names.join(', ') : `${names.slice(0, 2).join(', ')} +${names.length - 2}`;
}
