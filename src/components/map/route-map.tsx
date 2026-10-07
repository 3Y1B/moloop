import { useMyDot, useReporterPlace, useRouteTo } from '@/data/hooks';
import type { Task } from '@/lib/schema';
import { usePriorityColors } from '@/hooks/use-theme';
import type { VenueMapProps } from './map-model';
import { VenueMap } from './venue-map';

/**
 * The map's content for my way to a task: me, the walk, the spot in the task's priority colour, and the festival-goer
 * where they are. Without a task, the whole site with me on it. A hook, so a screen with one map can switch to it
 * without rebuilding.
 */
export function useRouteMap(task: Task | undefined): VenueMapProps {
  const me = useMyDot();
  const reporter = useReporterPlace(task);
  const route = useRouteTo(task);
  const accent = usePriorityColors()[task?.priority ?? 'P3'];
  return {
    route,
    me,
    target: task?.zoneSlug,
    targetColor: accent,
    markers: reporter ? [{ kind: 'person', id: 'reporter', at: reporter, color: accent }] : undefined,
    fit: task ? 'route' : 'site',
  };
}

/** My way to a task. Anything passed (fit, frame, teammates) goes on top. */
export function RouteMap({ task, ...rest }: Partial<VenueMapProps> & { task: Task | undefined }) {
  return <VenueMap {...useRouteMap(task)} {...rest} />;
}
