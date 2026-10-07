import { useLocalSearchParams } from 'expo-router';
import { Fragment } from 'react';
import { StyleSheet } from 'react-native';

import { CandidateRow } from '@/components/lead/candidate-row';
import { attempt, Sheet, SheetTitle } from '@/components/lead/sheet';
import { TaskLine } from '@/components/lead/task-head';
import { Button } from '@/components/ui/button';
import { Card, Separator } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { Text } from '@/components/ui/text';
import { useCandidates, useLookups, useMe, useRepo, useSnapshot, useTask } from '@/data/hooks';
import { isBusy, isHeld } from '@/lib/lifecycle';
import { goBack } from '@/lib/navigation';

type Mode = 'assign' | 'backup' | 'reassign';

const TITLE: Record<Mode, string> = { assign: 'Assign', backup: 'Send backup', reassign: 'Reassign' };

/**
 * Pick a volunteer for task `id`: suggested first (free, near, same team, right skills), busy people
 * lower and greyed. One tap does it. `mode` says what the pick means: assign, backup or reassign.
 * A task the AI escalated shows why first, and a lead can pass it to Mo instead.
 */
export default function AssignSheet() {
  const { id, mode: rawMode } = useLocalSearchParams<{ id: string; mode?: Mode }>();
  const mode: Mode = rawMode === 'backup' || rawMode === 'reassign' ? rawMode : 'assign';
  const repo = useRepo();
  const me = useMe();
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
  const held = mode === 'assign' && isHeld(task) ? task.escalation : null;
  const canPass = !!held && held.level === 'lead' && me?.role === 'team_lead';

  const choose = async (volunteerId: string) => {
    const ok = await attempt(() =>
      mode === 'assign' ? repo.assign(task.id, volunteerId) : repo.respond(task.id, { kind: mode, volunteerId }));
    // Backup and reassign come from the Respond sheet, which closes itself once it's answered.
    if (ok) goBack({ pathname: '/task/[id]', params: { id: task.id } });
  };

  return (
    <Sheet>
      <SheetTitle title={TITLE[mode]} />
      <TaskLine task={task} />
      {held?.reason && (
        <Card style={styles.reason}>
          <Text variant="label">Why the AI escalated it</Text>
          <Text>{held.reason}</Text>
        </Card>
      )}
      {ranked.length === 0 ? (
        <EmptyState title="No one on duty" variant="card" />
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
      {canPass && (
        <Button label="Pass to Mo" sf="arrow.up.circle" variant="plain" onPress={async () => {
          if (await attempt(() => repo.passToCoordinator(task.id))) goBack({ pathname: '/task/[id]', params: { id: task.id } });
        }} />
      )}
    </Sheet>
  );
}

const styles = StyleSheet.create({
  reason: { padding: 14, gap: 4 },
});
