import * as Haptics from 'expo-haptics';
import { StyleSheet, Text, View } from 'react-native';

import { Button } from '@/components/ui/button';
import { Spacing, Type } from '@/constants/theme';
import { useCrew, useNeedsMe, useRepo, useRole, useSnapshot, useTaskStatus, useTeam, type NeedsItem } from '@/data/hooks';
import type { Task } from '@/lib/schema';
import { toneColor, useTheme } from '@/hooks/use-theme';
import { MemberRow } from './member-row';
import { NeedStatus, NeedsRow } from './needs-row';
import { needVerb, openNeed, openTaskSheet } from './open-sheet';
import { attempt } from './sheet';
import { TeamRow, TeamSection } from './team-list';

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
      {needs[0] ? <PeekNeed need={needs[0]} more={needs.length - 1} /> : <PeekClear onDuty={onDuty} />}

      {needs.length > 1 && (
        <TeamSection title="Needs you" count={needs.length}>
          {needs.slice(1).map((n) => <NeedsRow key={`${n.kind}-${n.kind === 'mobilization' ? n.mobilization.id : n.task.id}`} item={n} />)}
        </TeamSection>
      )}

      <TeamSection title="People" count={members.length}>
        {members.length === 0 ? (
          <EmptyRow text="No one else on the team" />
        ) : (
          members.map((m) => <MemberRow key={m.volunteer.id} member={m} />)
        )}
      </TeamSection>

      {openTasks.length > 0 && (
        <TeamSection title="Open tasks" count={openTasks.length}>
          {openTasks.map((t) => <OpenRow key={t.id} task={t} onPress={() => openTaskSheet(t, proposals)} />)}
        </TeamSection>
      )}
    </View>
  );
}

/** What needs the lead most: title, its status, how many more, and the one filled action. */
function PeekNeed({ need, more }: { need: NeedsItem; more: number }) {
  const theme = useTheme();
  const repo = useRepo();
  const act = () => {
    if (need.kind !== 'handover') return openNeed(need);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    attempt(() => repo.arrived(need.task.id));
  };
  return (
    <View style={styles.peek}>
      <View style={styles.peekText}>
        <Text style={[styles.peekTitle, { color: theme.text }]} numberOfLines={2}>
          {need.kind === 'mobilization' ? need.mobilization.title : need.task.title}
        </Text>
        <View style={styles.inline}>
          <View style={styles.shrink}>
            <NeedStatus item={need} />
          </View>
          {more > 0 && <Text style={[styles.more, { color: theme.textTertiary }]}>+{more}</Text>}
        </View>
      </View>
      <Button label={needVerb(need)} onPress={act} haptic={need.kind === 'handover' ? 'none' : 'light'} />
    </View>
  );
}

function PeekClear({ onDuty }: { onDuty: number }) {
  const theme = useTheme();
  return (
    <View style={styles.peek}>
      <View style={styles.peekText}>
        <Text style={[styles.peekTitle, { color: theme.text }]}>All clear</Text>
        <Text style={[styles.small, { color: theme.textSecondary }]}>{onDuty} on duty</Text>
      </View>
    </View>
  );
}

/** Unassigned or queued: what, and its status ("Unassigned", "Up next for Tom") in its tone. */
function OpenRow({ task, onPress }: { task: Task; onPress: () => void }) {
  const theme = useTheme();
  const status = useTaskStatus(task);
  return (
    <TeamRow label={task.title} onPress={onPress}>
      <View style={styles.body}>
        <Text style={[styles.rowTitle, { color: theme.text }]} numberOfLines={1}>{task.title}</Text>
        {status && (
          <Text style={[styles.small, { color: toneColor(theme, status.tone) }]} numberOfLines={1}>{status.label}</Text>
        )}
      </View>
    </TeamRow>
  );
}

function EmptyRow({ text }: { text: string }) {
  const theme = useTheme();
  return (
    <TeamRow>
      <Text style={[styles.small, { color: theme.textTertiary }]}>{text}</Text>
    </TeamRow>
  );
}

const styles = StyleSheet.create({
  peek: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: PEEK_LINE },
  peekText: { flex: 1, gap: Spacing.one },
  peekTitle: { fontSize: Type.title, lineHeight: 23, fontWeight: '600', letterSpacing: -0.2 },
  inline: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  shrink: { flexShrink: 1 },
  more: { fontSize: Type.footnote, fontWeight: '500', fontVariant: ['tabular-nums'] },
  body: { flex: 1, gap: 2 },
  rowTitle: { fontSize: Type.body, fontWeight: '500' },
  small: { fontSize: Type.footnote },
});
