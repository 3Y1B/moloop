import { router, useLocalSearchParams } from 'expo-router';
import { Fragment } from 'react';

import { CandidateRow } from '@/components/lead/candidate-row';
import { EmptyCard } from '@/components/lead/group';
import { attempt, Sheet, SheetTitle } from '@/components/lead/sheet';
import { TaskLine } from '@/components/lead/task-head';
import { Card, Separator } from '@/components/ui/card';
import { useCandidates, useLookups, useRepo, useSnapshot, useTask } from '@/data/hooks';
import { isBusy } from '@/lib/lifecycle';

type Mode = 'assign' | 'backup' | 'reassign';

const TITLE: Record<Mode, string> = { assign: 'Assign', backup: 'Send backup', reassign: 'Reassign' };

/**
 * Pick a volunteer for task `id`: suggested first (free, near, same team, right skills), busy people
 * lower and greyed. One tap does it. `mode` says what the pick means: assign, backup or reassign.
 */
export default function AssignSheet() {
  const { id, mode: rawMode } = useLocalSearchParams<{ id: string; mode?: Mode }>();
  const mode: Mode = rawMode === 'backup' || rawMode === 'reassign' ? rawMode : 'assign';
  const repo = useRepo();
  const task = useTask(id);
  const { tasks } = useSnapshot();
  const { volunteers, teams } = useLookups();
  const candidates = useCandidates(id);
  if (!task) return null;

  const all = Object.values(tasks);
  const ranked = candidates
    .map((c) => ({ c, busy: isBusy(all, c.volunteerId) }))
    .sort((a, b) => Number(a.busy) - Number(b.busy));
  const suggested = ranked.find((r) => !r.busy)?.c.volunteerId;

  const choose = async (volunteerId: string) => {
    const ok = await attempt(() =>
      mode === 'assign' ? repo.assign(task.id, volunteerId) : repo.respond(task.id, { kind: mode, volunteerId }));
    // Backup and reassign come from the Respond sheet, which closes itself once it's answered.
    if (ok) router.back();
  };

  return (
    <Sheet>
      <SheetTitle title={TITLE[mode]} />
      <TaskLine task={task} />
      {ranked.length === 0 ? (
        <EmptyCard text="No one on duty" />
      ) : (
        <Card>
          {ranked.map(({ c, busy }, i) => {
            const v = volunteers[c.volunteerId];
            if (!v) return null;
            return (
              <Fragment key={c.volunteerId}>
                {i > 0 && <Separator inset={58} />}
                <CandidateRow
                  candidate={c}
                  volunteer={v}
                  team={v.teamSlug ? teams[v.teamSlug] : undefined}
                  busy={busy}
                  suggested={c.volunteerId === suggested}
                  onPress={() => choose(c.volunteerId)}
                />
              </Fragment>
            );
          })}
        </Card>
      )}
    </Sheet>
  );
}
