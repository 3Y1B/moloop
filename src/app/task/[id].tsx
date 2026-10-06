import { useLocalSearchParams } from 'expo-router';
import { Fragment, useRef } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { ScreenHeader } from '@/components/screen-header';
import { ActiveTaskCard } from '@/components/task/active-task-card';
import { Timeline } from '@/components/task/timeline';
import { Avatar } from '@/components/ui/avatar';
import { Card, Section, Separator } from '@/components/ui/card';
import { useLookups, useSnapshot, useTask, useTaskEvents } from '@/data/hooks';
import { Type } from '@/constants/theme';
import { PRIORITY_LABEL } from '@/lib/format';
import { isOnTask } from '@/lib/lifecycle';
import type { Volunteer } from '@/lib/schema';
import { useTheme } from '@/hooks/use-theme';

export default function TaskDetailScreen() {
  // `focus=timeline` comes from the card's Timeline link: land on the history, not the top.
  const { id, focus } = useLocalSearchParams<{ id: string; focus?: string }>();
  const theme = useTheme();
  const scroll = useRef<ScrollView>(null);
  const focused = useRef(false);
  const task = useTask(id);
  const events = useTaskEvents(id);
  const { meId } = useSnapshot();
  const { volunteers, teams } = useLookups();

  if (!task) {
    return (
      <View style={[styles.flex, { backgroundColor: theme.background }]}>
        <ScreenHeader title="Task" back />
        <View style={styles.missing}>
          <Text style={{ color: theme.textSecondary, fontSize: Type.body }}>This task no longer exists.</Text>
        </View>
      </View>
    );
  }

  const assignee = task.assigneeId ? volunteers[task.assigneeId] : undefined;
  // Owner or backup: both can reply (a helper only gets Done).
  const onIt = !!meId && isOnTask(task, meId);
  const team = task.teamSlug ? teams[task.teamSlug] : undefined;
  const helpers = task.helperIds.map((h) => volunteers[h]).filter((v): v is Volunteer => !!v);
  const nameOf = (v: Volunteer) => (v.id === meId ? `${v.name} (you)` : v.name);

  return (
    <View style={[styles.flex, { backgroundColor: theme.background }]}>
      <ScreenHeader title={`${task.priority} · ${PRIORITY_LABEL[task.priority]}`} back />
      <ScrollView ref={scroll} contentContainerStyle={styles.content}>

      <ActiveTaskCard task={task} showReplies={onIt} showTimelineLink={false} defaultExpanded />

      <Section title="Assigned to">
        <Card>
          <View style={styles.person}>
            {assignee ? (
              <Avatar name={assignee.name} color={team?.color} />
            ) : (
              <View style={[styles.nobody, { backgroundColor: theme.backgroundElement }]}>
                <Text style={[styles.nobodyText, { color: theme.textTertiary }]}>?</Text>
              </View>
            )}
            <Text style={[styles.personName, { color: theme.text }]}>{assignee ? nameOf(assignee) : 'Nobody yet'}</Text>
          </View>
          {helpers.map((v) => (
            <Fragment key={v.id}>
              <Separator inset={52} />
              <View style={styles.person}>
                <Avatar name={v.name} color={v.teamSlug ? teams[v.teamSlug]?.color : undefined} />
                <Text style={[styles.personName, { color: theme.text }]}>{nameOf(v)}</Text>
                <Text style={[styles.role, { color: theme.textTertiary }]}>Backup</Text>
              </View>
            </Fragment>
          ))}
        </Card>
      </Section>

      <Section
        title="Timeline"
        onLayout={(e) => {
          if (focus !== 'timeline' || focused.current) return;
          focused.current = true;
          scroll.current?.scrollTo({ y: e.nativeEvent.layout.y - 12, animated: true });
        }}>
        <Card>
          <Timeline events={events} />
        </Card>
      </Section>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: { padding: 16, gap: 18, paddingBottom: 40 },
  missing: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  person: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12 },
  nobody: { width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
  nobodyText: { fontWeight: '600', fontSize: Type.caption },
  personName: { flex: 1, fontSize: Type.body, fontWeight: '500' },
  role: { fontSize: Type.footnote },
});
