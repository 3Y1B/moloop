import { useLocalSearchParams } from 'expo-router';
import { useRef } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { ScreenHeader } from '@/components/screen-header';
import { ActiveTaskCard } from '@/components/task/active-task-card';
import { Timeline } from '@/components/task/timeline';
import { Card, Section } from '@/components/ui/card';
import { useLookups, useSnapshot, useTask, useTaskEvents } from '@/data/hooks';
import { Type } from '@/constants/theme';
import { initials, PRIORITY_LABEL } from '@/lib/format';
import { isActive } from '@/lib/lifecycle';
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
  const mineAndActive = task.assigneeId === meId && isActive(task);
  const team = task.teamSlug ? teams[task.teamSlug] : undefined;

  return (
    <View style={[styles.flex, { backgroundColor: theme.background }]}>
      <ScreenHeader title={`${task.priority} · ${PRIORITY_LABEL[task.priority]}`} back />
      <ScrollView ref={scroll} contentContainerStyle={styles.content}>

      <ActiveTaskCard task={task} showReplies={mineAndActive} showTimelineLink={false} defaultExpanded />

      <Section title="Assigned to">
        <Card style={styles.assignee}>
          <View style={[styles.avatar, { backgroundColor: assignee ? team?.color ?? theme.tint : theme.backgroundElement }]}>
            <Text style={styles.avatarText}>{assignee ? initials(assignee.name) : '?'}</Text>
          </View>
          <Text style={[styles.assigneeName, { color: theme.text }]}>
            {assignee ? (assignee.id === meId ? `${assignee.name} (you)` : assignee.name) : 'Nobody yet'}
          </Text>
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
  assignee: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12 },
  avatar: { width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
  avatarText: { color: '#fff', fontWeight: '600', fontSize: Type.caption },
  assigneeName: { fontSize: Type.body, fontWeight: '500' },
});
