import { StyleSheet, View } from 'react-native';

import { TaskButton } from '@/components/mo/crew-list';
import { PersonRow } from '@/components/people/person-row';
import { TaskRow } from '@/components/task/task-row';
import { Button } from '@/components/ui/button';
import { AllClear, EmptyState } from '@/components/ui/empty-state';
import { haptic } from '@/components/ui/pressable';
import { Text } from '@/components/ui/text';
import { Spacing } from '@/constants/theme';
import { useCrew, useNeedsMe, useRepo, useRole, useSnapshot, useTeam, type NeedsItem } from '@/data/hooks';
import { NeedStatus, NeedsRow } from './needs-row';
import { needVerb, openNeed, openTaskSheet } from './open-sheet';
import { attempt } from './sheet';
import { TeamSection } from './team-list';

/** Height of the peek line itself: room for a two-line title next to the button. */
const PEEK_LINE = 72;

/**
 * Visible sheet height at rest in the team view, above the voice dock: the grabber (23) and the My task / Team switch
 * (50) over the peek line, with the next section kept below the fold.
 */
export const TEAM_PEEK = 160;

/** The screen's sheet stops with the lowest lowered to the peek. The other stops stay as they are. */
export function teamDetents({ detents, bottomInset }: { detents: number[]; bottomInset: number }) {
  return [Math.min(bottomInset + TEAM_PEEK, detents[detents.length - 1]), ...detents.slice(1)];
}

/**
 * The lead's view in the sheet. At rest it says one thing: what needs them most, with its one action.
 * Pulled up: the rest of what needs them, everyone's status, then what's still open. Mo's team is the whole crew.
 */
export function TeamSheet() {
  const { proposals } = useSnapshot();
  const needs = useNeedsMe();
  const everyone = useRole() === 'coordinator';
  const mine = useTeam();
  const crew = useCrew();
  const { members, openTasks } = everyone ? crew : mine;
  const onDuty = members.filter((m) => m.volunteer.duty === 'on_duty').length;

  return (
    <View>
      {needs[0] ? <PeekNeed need={needs[0]} more={needs.length - 1} /> : <AllClear onDuty={onDuty} style={styles.peek} />}

      {needs.length > 1 && (
        <TeamSection title="Needs you" count={needs.length}>
          {needs.slice(1).map((n) => <NeedsRow key={`${n.kind}-${n.kind === 'mobilization' ? n.mobilization.id : n.task.id}`} item={n} />)}
        </TeamSection>
      )}

      <TeamSection title="People" count={members.length}>
        {members.length === 0 ? (
          <EmptyState title="No one else on the team" divider />
        ) : (
          members.map((m) => {
            const on = m.task ?? m.helping;
            return <PersonRow key={m.volunteer.id} member={m} trailing={on && <TaskButton task={on} />} />;
          })
        )}
      </TeamSection>

      {openTasks.length > 0 && (
        <TeamSection title="Open tasks" count={openTasks.length}>
          {openTasks.map((t) => <TaskRow key={t.id} task={t} flat zone onPress={() => openTaskSheet(t, proposals)} />)}
        </TeamSection>
      )}
    </View>
  );
}

/** What needs the lead most: title, its status, how many more, and the one filled action. */
function PeekNeed({ need, more }: { need: NeedsItem; more: number }) {
  const repo = useRepo();
  const act = () => {
    if (need.kind !== 'handover') return openNeed(need);
    haptic('success');
    attempt(() => repo.arrived(need.task.id));
  };
  return (
    <View style={[styles.peek, styles.row]}>
      <View style={styles.peekText}>
        <Text variant="title" numberOfLines={2}>
          {need.kind === 'mobilization' ? need.mobilization.title : need.task.title}
        </Text>
        <View style={styles.inline}>
          <View style={styles.shrink}>
            <NeedStatus item={need} />
          </View>
          {more > 0 && <Text variant="footnote" tone="tertiary" tabular style={styles.more}>+{more}</Text>}
        </View>
      </View>
      <Button label={needVerb(need)} onPress={act} haptic={need.kind === 'handover' ? 'none' : 'light'} />
    </View>
  );
}

const styles = StyleSheet.create({
  peek: { minHeight: PEEK_LINE, justifyContent: 'center' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  peekText: { flex: 1, gap: Spacing.one },
  inline: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  shrink: { flexShrink: 1 },
  more: { fontWeight: '500' },
});
