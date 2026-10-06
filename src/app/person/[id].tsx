import * as Haptics from 'expo-haptics';
import { Link, useLocalSearchParams } from 'expo-router';
import { Fragment, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { EmptyCard, Group } from '@/components/lead/group';
import { OpenTaskRow } from '@/components/lead/open-task-row';
import { attempt, callNumber, Sheet } from '@/components/lead/sheet';
import { TaskHead, TaskProgress } from '@/components/lead/task-head';
import { TeamChip } from '@/components/task/badges';
import { TaskRow } from '@/components/task/task-row';
import { Avatar } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Card, Separator } from '@/components/ui/card';
import { Icon } from '@/components/ui/icon';
import { StatusLine } from '@/components/ui/status-line';
import { Radius, Type } from '@/constants/theme';
import { useLookups, usePerson, useRepo, useTeam } from '@/data/hooks';
import { languageName } from '@/lib/format';
import type { Task, Volunteer } from '@/lib/schema';
import { useTheme } from '@/hooks/use-theme';

type Panel = 'message' | 'assign' | null;

/** A teammate, for a lead: status, what they're on, what's queued, where, what they can do; Call, Message, Assign. */
export default function PersonSheet() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const theme = useTheme();
  const person = usePerson(id);
  const [panel, setPanel] = useState<Panel>(null);
  if (!person) return null;
  const { volunteer, team, status, active, helping, queue } = person;
  const current = active ?? helping;
  const toggle = (p: Panel) => setPanel((open) => (open === p ? null : p));

  return (
    <Sheet>
      <View style={styles.head}>
        <Avatar name={volunteer.name} color={volunteer.duty === 'on_duty' ? team?.color : theme.textTertiary} size={52} />
        <View style={styles.flex}>
          <Text style={[styles.name, { color: theme.text }]} numberOfLines={1}>{volunteer.name}</Text>
          <TeamChip team={team} />
        </View>
      </View>
      <StatusLine status={status} size="callout" />

      <View style={styles.actions}>
        <Button
          label="Call"
          sf="phone.fill"
          variant="tinted"
          color={theme.success}
          disabled={!volunteer.phone}
          onPress={() => volunteer.phone && callNumber(volunteer.phone)}
          style={styles.flex}
        />
        <Button label="Message" sf="bubble.left.fill" variant={panel === 'message' ? 'filled' : 'tinted'} onPress={() => toggle('message')} style={styles.flex} />
        <Button label="Assign" sf="plus" variant={panel === 'assign' ? 'filled' : 'tinted'} onPress={() => toggle('assign')} style={styles.flex} />
      </View>

      {panel === 'message' && <Message volunteer={volunteer} onSent={() => setPanel(null)} />}
      {panel === 'assign' && <AssignTask volunteer={volunteer} onAssigned={() => setPanel(null)} />}

      {current && <CurrentTask task={current} />}

      {queue.length > 0 && (
        <Group title="Up next" count={queue.length}>
          <Card>
            {queue.map((t, i) => (
              <Fragment key={t.id}>
                {i > 0 && <Separator inset={39} />}
                <TaskRow task={t} />
              </Fragment>
            ))}
          </Card>
        </Group>
      )}

      <Details volunteer={volunteer} />
    </Sheet>
  );
}

/** What they're on (or backing up): the card, how far through, and the way to its timeline. */
function CurrentTask({ task }: { task: Task }) {
  const theme = useTheme();
  return (
    <Card style={styles.card}>
      <TaskHead task={task} />
      <TaskProgress task={task} />
      <Link href={{ pathname: '/task/[id]', params: { id: task.id, focus: 'timeline' } }} asChild>
        <Pressable hitSlop={8} style={styles.link}>
          <Text style={[styles.linkText, { color: theme.tint }]}>Timeline</Text>
          <Icon sf="chevron.right" md="chevron_right" size={11} color={theme.tint} weight="bold" />
        </Pressable>
      </Link>
    </Card>
  );
}

function Message({ volunteer, onSent }: { volunteer: Volunteer; onSent: () => void }) {
  const theme = useTheme();
  const repo = useRepo();
  const [text, setText] = useState('');
  const send = async () => {
    if (!text.trim()) return;
    if (await attempt(() => repo.sendDirect(volunteer.id, text.trim()))) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setText('');
      onSent();
    }
  };
  return (
    <View style={[styles.compose, { backgroundColor: theme.card, borderColor: theme.border }]}>
      <TextInput
        autoFocus
        value={text}
        onChangeText={setText}
        placeholder={`Message ${volunteer.name.split(' ')[0]}`}
        placeholderTextColor={theme.textTertiary}
        returnKeyType="send"
        onSubmitEditing={send}
        style={[styles.input, { color: theme.text }]}
      />
      <Button label="Send" size="small" haptic="none" disabled={!text.trim()} onPress={send} />
    </View>
  );
}

/** The team's unassigned tasks; one tap gives it to them (queued if they're busy). */
function AssignTask({ volunteer, onAssigned }: { volunteer: Volunteer; onAssigned: () => void }) {
  const repo = useRepo();
  const { openTasks } = useTeam(volunteer.teamSlug);
  const open = openTasks.filter((t) => t.status === 'open');
  if (open.length === 0) return <EmptyCard text="No open tasks" />;
  return (
    <Card>
      {open.map((t, i) => (
        <Fragment key={t.id}>
          {i > 0 && <Separator inset={39} />}
          <OpenTaskRow
            task={t}
            onPress={async () => {
              if (await attempt(() => repo.assign(t.id, volunteer.id))) {
                Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
                onAssigned();
              }
            }}
          />
        </Fragment>
      ))}
    </Card>
  );
}

const skillName = (s: string) => (s === 'wwcc' ? 'WWCC' : s === 'rsa' ? 'RSA' : s.replace(/-/g, ' '));

function Details({ volunteer }: { volunteer: Volunteer }) {
  const theme = useTheme();
  const { zones } = useLookups();
  const rows = [
    { label: 'Zone', value: volunteer.zoneSlug ? zones[volunteer.zoneSlug]?.name ?? volunteer.zoneSlug : '—' },
    { label: 'Skills', value: volunteer.skills.length ? volunteer.skills.map(skillName).join(', ') : '—' },
    { label: 'Languages', value: volunteer.languages.map(languageName).join(', ') || '—' },
  ];
  return (
    <Card>
      {rows.map((r, i) => (
        <Fragment key={r.label}>
          {i > 0 && <Separator inset={14} />}
          <View style={styles.detail}>
            <Text style={[styles.detailLabel, { color: theme.textSecondary }]}>{r.label}</Text>
            <Text style={[styles.detailValue, { color: theme.text }]}>{r.value}</Text>
          </View>
        </Fragment>
      ))}
    </Card>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  name: { fontSize: Type.hero, fontWeight: '600', letterSpacing: -0.3, marginBottom: 2 },
  actions: { flexDirection: 'row', gap: 8 },
  card: { padding: 14, gap: 10 },
  link: { flexDirection: 'row', alignItems: 'center', gap: 3, alignSelf: 'flex-end', paddingVertical: 2 },
  linkText: { fontSize: Type.footnote, fontWeight: '500' },
  compose: {
    flexDirection: 'row', alignItems: 'center', gap: 8, paddingLeft: 14, paddingRight: 6, height: 50,
    borderRadius: Radius.control, borderCurve: 'continuous', borderWidth: StyleSheet.hairlineWidth * 2,
  },
  input: { flex: 1, fontSize: Type.body, padding: 0 },
  detail: { flexDirection: 'row', gap: 12, paddingHorizontal: 14, paddingVertical: 11 },
  detailLabel: { width: 84, fontSize: Type.callout },
  detailValue: { flex: 1, fontSize: Type.callout, fontWeight: '500' },
});
