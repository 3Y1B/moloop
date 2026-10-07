import { router, useLocalSearchParams } from 'expo-router';
import { Fragment, useState } from 'react';
import { StyleSheet, TextInput, View } from 'react-native';

import { attempt, callNumber, Sheet } from '@/components/lead/sheet';
import { TaskHead, TaskProgress } from '@/components/lead/task-head';
import { TeamChip } from '@/components/task/badges';
import { TaskRow } from '@/components/task/task-row';
import { Avatar } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Card, Section, Separator } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { haptic } from '@/components/ui/pressable';
import { StatusLine } from '@/components/ui/status-line';
import { Text, textStyle } from '@/components/ui/text';
import { Radius } from '@/constants/theme';
import { useLookups, usePerson, useRepo, useTeam } from '@/data/hooks';
import { languageName } from '@/lib/format';
import type { Task, Volunteer } from '@/lib/schema';
import { useTheme } from '@/hooks/use-theme';

type Panel = 'message' | 'assign' | null;

/** A task row's hairline starts under its title: padding, signal, gap. */
const ROW_INSET = 38;

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
        <Avatar name={volunteer.name} size={52} />
        <View style={styles.flex}>
          <Text variant="hero" style={styles.name} numberOfLines={1}>{volunteer.name}</Text>
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
        <Section title="Up next" count={queue.length}>
          <Card>
            {queue.map((t, i) => (
              <Fragment key={t.id}>
                {i > 0 && <Separator inset={ROW_INSET} />}
                <TaskRow task={t} zone />
              </Fragment>
            ))}
          </Card>
        </Section>
      )}

      <Details volunteer={volunteer} />
    </Sheet>
  );
}

/** What they're on (or backing up): the card, how far through, and the way to its timeline. */
function CurrentTask({ task }: { task: Task }) {
  return (
    <Card style={styles.card}>
      <TaskHead task={task} />
      <TaskProgress task={task} />
      <Button
        label="Timeline"
        size="inline"
        trailingSf="chevron.right"
        trailingMd="chevron_right"
        haptic="none"
        onPress={() => router.push({ pathname: '/task/[id]', params: { id: task.id } })}
        style={styles.link}
      />
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
      haptic('success');
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
        style={[textStyle('body'), styles.input, { color: theme.text }]}
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
  if (open.length === 0) return <EmptyState title="No open tasks" variant="card" />;
  return (
    <Card>
      {open.map((t, i) => (
        <Fragment key={t.id}>
          {i > 0 && <Separator inset={ROW_INSET} />}
          <TaskRow
            task={t}
            zone
            onPress={async () => {
              if (await attempt(() => repo.assign(t.id, volunteer.id))) {
                haptic('success');
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
            <Text variant="callout" tone="secondary" style={styles.detailLabel}>{r.label}</Text>
            <Text variant="callout" style={styles.detailValue}>{r.value}</Text>
          </View>
        </Fragment>
      ))}
    </Card>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  name: { marginBottom: 2 },
  actions: { flexDirection: 'row', gap: 8 },
  card: { padding: 14, gap: 10 },
  link: { alignSelf: 'flex-end' },
  compose: {
    flexDirection: 'row', alignItems: 'center', gap: 8, paddingLeft: 14, paddingRight: 6, height: 50,
    borderRadius: Radius.control, borderCurve: 'continuous', borderWidth: StyleSheet.hairlineWidth * 2,
  },
  input: { flex: 1, padding: 0 },
  detail: { flexDirection: 'row', gap: 12, paddingHorizontal: 14, paddingVertical: 11 },
  detailLabel: { width: 84 },
  detailValue: { flex: 1, fontWeight: '500' },
});
