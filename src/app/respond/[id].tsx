import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { Fragment, useCallback, useRef, useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';

import { ACTION_INSET, ActionRow, attempt, callNumber, Sheet } from '@/components/lead/sheet';
import { TaskHead } from '@/components/lead/task-head';
import { TaskMap } from '@/components/lead/task-map';
import { Avatar } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Card, Separator } from '@/components/ui/card';
import { Radius, Type } from '@/constants/theme';
import { useLookups, useMe, useRepo, useTask } from '@/data/hooks';
import { availableResponses, isQuiet, needsResponse } from '@/lib/lifecycle';
import type { EscalationResponseKind, HandoverTarget, Task } from '@/lib/schema';
import { useTheme } from '@/hooks/use-theme';

type Step = 'main' | 'handover' | 'emergency' | 'close';

/**
 * Respond to "need help" or "went quiet" on task `id`: the volunteer, their reason, the spot, then the
 * responses that fit (docs/SCREENS.md, Escalation). Closes itself once the task no longer needs an answer,
 * including when it comes back from the picker.
 */
export default function RespondSheet() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const theme = useTheme();
  const repo = useRepo();
  const me = useMe();
  const task = useTask(id);
  const { volunteers, teams } = useLookups();
  const [step, setStep] = useState<Step>('main');
  const [called, setCalled] = useState(false);
  const [note, setNote] = useState('');

  const responses = task ? availableResponses(task) : [];
  const [wasOpen] = useState(responses.length > 0);
  const settled = wasOpen && responses.length === 0;
  const closed = useRef(false);
  useFocusEffect(
    useCallback(() => {
      if (!settled || closed.current) return;
      closed.current = true;
      router.back();
    }, [settled]),
  );

  if (!task) return null;
  const owner = task.assigneeId ? volunteers[task.assigneeId] : undefined;
  const first = owner?.name.split(' ')[0] ?? 'them';
  const quiet = isQuiet(task);
  const handingOver = task.status === 'escalated' && task.escalation?.response?.kind === 'handover';
  const canPass = me?.role === 'team_lead' && needsResponse(task) && task.escalation?.level === 'lead';

  const respond = (kind: EscalationResponseKind, extra: { target?: HandoverTarget; note?: string } = {}) =>
    attempt(() => repo.respond(task.id, { kind, ...extra }));

  const call = async () => {
    await respond('call');
    setCalled(true);
    if (owner?.phone) callNumber(owner.phone);
  };

  const pick = (mode: 'backup' | 'reassign') => router.push({ pathname: '/assign/[id]', params: { id: task.id, mode } });

  const ROW: Record<EscalationResponseKind, () => { label: string; sf: string; md: string; color?: string; onPress: () => void }> = {
    backup: () => ({ label: 'Send backup', sf: 'person.badge.plus', md: 'person_add', onPress: () => pick('backup') }),
    handover: () => ({ label: 'Hand over', sf: 'cross.case', md: 'medical_services', onPress: () => setStep('handover') }),
    reassign: () => ({ label: 'Reassign', sf: 'arrow.triangle.2.circlepath', md: 'swap_horiz', onPress: () => pick('reassign') }),
    call: () => ({ label: `Call ${first}`, sf: 'phone.fill', md: 'call', color: theme.success, onPress: call }),
    close: () => ({ label: 'Close', sf: 'xmark', md: 'close', color: theme.textSecondary, onPress: () => setStep('close') }),
    carry_on: () => ({ label: quiet ? 'They’re fine' : 'Carry on', sf: 'checkmark', md: 'check', color: theme.success, onPress: () => respond('carry_on') }),
  };

  // After a call, the follow-up that ends it goes first.
  const afterCall = called || task.escalation?.response?.kind === 'call';
  const order = afterCall ? [...responses].sort((a, b) => Number(b === 'carry_on') - Number(a === 'carry_on')) : responses;

  return (
    <Sheet>
      <TaskHead task={task} />

      {owner && (
        <View style={styles.person}>
          <Avatar name={owner.name} color={(task.teamSlug && teams[task.teamSlug]?.color) || undefined} size={36} />
          <View style={styles.flex}>
            <Text style={[styles.name, { color: theme.text }]} numberOfLines={1}>{owner.name}</Text>
            {!!task.escalation?.reason && <Text style={[styles.reason, { color: theme.text }]}>“{task.escalation.reason}”</Text>}
          </View>
        </View>
      )}

      <TaskMap task={task} />

      {step === 'main' && order.length > 0 && (
        <Card>
          {order.map((kind, i) => (
            <Fragment key={kind}>
              {i > 0 && <Separator inset={ACTION_INSET} />}
              <ActionRow {...ROW[kind]()} chevron={kind === 'backup' || kind === 'reassign' || kind === 'handover' || kind === 'close'} />
            </Fragment>
          ))}
        </Card>
      )}

      {step === 'main' && canPass && (
        <Button label="Pass to Mo" sf="arrow.up.circle" variant="plain" onPress={async () => {
          if (await attempt(() => repo.passToCoordinator(task.id))) router.back();
        }} />
      )}

      {step === 'main' && handingOver && <Arrived task={task} />}

      {step === 'handover' && (
        <>
          <Card>
            <ActionRow label="First Aid Post medics" sf="cross.case.fill" md="medical_services" chevron={false} onPress={() => respond('handover', { target: 'medics' })} />
            <Separator inset={ACTION_INSET} />
            <ActionRow label="Security" sf="shield.fill" md="shield" chevron={false} onPress={() => respond('handover', { target: 'security' })} />
            <Separator inset={ACTION_INSET} />
            <ActionRow label="Emergency services" sf="staroflife.fill" md="emergency" color={theme.danger} onPress={() => setStep('emergency')} />
          </Card>
          <Button label="Back" variant="plain" color={theme.textSecondary} onPress={() => setStep('main')} />
        </>
      )}

      {step === 'emergency' && <Emergency task={task} onBack={() => setStep('handover')} onCalled={() => respond('handover', { target: 'emergency', note: 'Called 000' })} />}

      {step === 'close' && (
        <>
          <View style={[styles.input, { backgroundColor: theme.card, borderColor: theme.border }]}>
            <TextInput
              value={note}
              onChangeText={setNote}
              placeholder="Reason (optional)"
              placeholderTextColor={theme.textTertiary}
              returnKeyType="done"
              style={[styles.inputText, { color: theme.text }]}
            />
          </View>
          <Button label="Close task" sf="xmark" color={theme.danger} haptic="warning" onPress={() => respond('close', { note: note.trim() || undefined })} />
          <Button label="Back" variant="plain" color={theme.textSecondary} onPress={() => setStep('main')} />
        </>
      )}
    </Sheet>
  );
}

/** Emergency services are human-only: the lead calls 000 themselves, then records it here. */
function Emergency({ task, onBack, onCalled }: { task: Task; onBack: () => void; onCalled: () => void }) {
  const theme = useTheme();
  const { zones } = useLookups();
  const where = [task.zoneSlug ? zones[task.zoneSlug]?.name : null, task.locationHint].filter(Boolean).join(' · ');
  return (
    <>
      <Card style={styles.emergency}>
        <Text style={[styles.emergencyTitle, { color: theme.danger }]}>Call 000</Text>
        {!!where && <Text style={[styles.sub, { color: theme.textSecondary }]}>{where}</Text>}
      </Card>
      <Button label="Called 000" sf="checkmark" size="large" color={theme.danger} haptic="warning" onPress={onCalled} />
      <Button label="Back" variant="plain" color={theme.textSecondary} onPress={onBack} />
    </>
  );
}

/** A handover is on its way: the lead taps Arrived and the volunteer is freed. */
function Arrived({ task }: { task: Task }) {
  const repo = useRepo();
  return (
    <Button label="Arrived" sf="checkmark.circle.fill" size="large" haptic="success" onPress={async () => {
      if (await attempt(() => repo.arrived(task.id))) router.back();
    }} />
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  person: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  name: { fontSize: Type.body, fontWeight: '600' },
  reason: { fontSize: Type.callout, lineHeight: 20, marginTop: 2 },
  sub: { fontSize: Type.footnote, marginTop: 1 },
  input: { borderRadius: Radius.control, borderCurve: 'continuous', borderWidth: StyleSheet.hairlineWidth * 2, paddingHorizontal: 14, height: 46, justifyContent: 'center' },
  inputText: { fontSize: Type.body, padding: 0 },
  emergency: { padding: 16, gap: 4, alignItems: 'center' },
  emergencyTitle: { fontSize: Type.hero + 6, fontWeight: '700', letterSpacing: -0.4 },
});
