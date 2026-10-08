import { useLocalSearchParams } from 'expo-router';
import { Fragment } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';

import { ScreenHeader } from '@/components/screen-header';
import { TaskMap } from '@/components/lead/task-map';
import { SummaryCard } from '@/components/mo/summary-card';
import { openCrewMessage, openGuestReply, ReplyBar } from '@/components/task/reply-bar';
import { TaskSheet } from '@/components/task/task-sheet';
import { Avatar } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Card, Section, Separator } from '@/components/ui/card';
import { ListRow } from '@/components/ui/list-row';
import { Text } from '@/components/ui/text';
import { useLookups, useRole, useSnapshot, useTask } from '@/data/hooks';
import { PRIORITY_LABEL } from '@/lib/format';
import { isActive, isOnTask } from '@/lib/lifecycle';
import type { Volunteer } from '@/lib/schema';
import { useTheme } from '@/hooks/use-theme';

/** A person row's hairline starts under the name: padding, avatar, gap. */
const PERSON_INSET = 56;

/**
 * A task for anyone who opens it: the same head and log the volunteer reads on their sheet, all of it, then where it
 * is and who's on it. Leads and Mo get the AI summary above.
 */
export default function TaskDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const theme = useTheme();
  const task = useTask(id);
  const { meId } = useSnapshot();
  const { volunteers } = useLookups();
  const role = useRole();
  // The summary route is for leads and Mo.
  const lead = role === 'team_lead' || role === 'coordinator';

  if (!task) {
    return (
      <View style={[styles.flex, { backgroundColor: theme.background }]}>
        <ScreenHeader title="Task" back />
        <View style={styles.missing}>
          <Text tone="secondary">This task no longer exists.</Text>
        </View>
      </View>
    );
  }

  const assignee = task.assigneeId ? volunteers[task.assigneeId] : undefined;
  // Owner or backup: both can reply (a helper only gets Done).
  const onIt = !!meId && isOnTask(task, meId);
  const helpers = task.helpers.map((h) => volunteers[h.volunteerId]).filter((v): v is Volunteer => !!v);
  const nameOf = (v: Volunteer) => (v.id === meId ? `${v.name} (you)` : v.name);
  // A lead or Mo, not on it themselves: words for the crew on it, or for the festival-goer behind it.
  const toCrew = lead && !onIt && !!assignee && isActive(task);
  const toGuest = lead && !onIt && !!task.requestId;

  return (
    <View style={[styles.flex, { backgroundColor: theme.background }]}>
      <ScreenHeader title={`${task.priority} · ${PRIORITY_LABEL[task.priority]}`} back />
      <ScrollView contentContainerStyle={styles.content}>
        {lead && <SummaryCard taskId={task.id} />}

        <Card style={styles.log}>
          <TaskSheet task={task} expanded />
        </Card>

        {onIt && <ReplyBar task={task} helperEntry={task.helpers.find((h) => h.volunteerId === meId)} />}

        {(toCrew || toGuest) && (
          <Section title="Message">
            <View style={styles.message}>
              {toCrew && (
                <Button
                  variant="tinted"
                  size="small"
                  label={`${assignee?.name.split(' ')[0]}${helpers.length ? ` +${helpers.length}` : ''}`}
                  sf="bubble.left.fill"
                  onPress={() => openCrewMessage(task)}
                  style={styles.flex}
                />
              )}
              {toGuest && (
                <Button
                  variant="tinted"
                  size="small"
                  label="Festival-goer"
                  sf="arrowshape.turn.up.left.fill"
                  onPress={() => openGuestReply(task)}
                  style={styles.flex}
                />
              )}
            </View>
          </Section>
        )}

        {/* Where it is, and who's there. Nothing without a zone. */}
        {task.zoneSlug && (
          <Section title="Where">
            <TaskMap task={task} />
          </Section>
        )}

        <Section title="Assigned to">
          <Card>
            <ListRow
              leading={<Avatar name={assignee?.name} face={assignee?.avatar} placeholder={!assignee} />}
              title={assignee ? nameOf(assignee) : 'Nobody yet'}
            />
            {helpers.map((v) => (
              <Fragment key={v.id}>
                <Separator inset={PERSON_INSET} />
                <ListRow
                  leading={<Avatar name={v.name} face={v.avatar} />}
                  title={nameOf(v)}
                  trailing={<Text variant="footnote" tone="tertiary">Backup</Text>}
                />
              </Fragment>
            ))}
          </Card>
        </Section>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: { padding: 16, gap: 18, paddingBottom: 40 },
  // As the sheet's own padding, so its hairline runs edge to edge.
  log: { padding: 20 },
  missing: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  message: { flexDirection: 'row', gap: 8 },
});
