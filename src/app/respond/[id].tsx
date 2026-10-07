import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { useAnimatedKeyboard, useAnimatedStyle } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { RespondCard } from '@/components/lead/respond-card';
import { RespondActions, type Slot } from '@/components/lead/respond-dock';
import { ArrivedStep, CloseStep, EmergencyStep, HandoverStep, PickStep, type Pickable } from '@/components/lead/respond-steps';
import { useRespondVoice } from '@/components/lead/respond-voice';
import { attempt, callNumber } from '@/components/lead/sheet';
import { TaskMap } from '@/components/lead/task-map';
import { useCandidates, useLookups, useMe, useRepo, useSnapshot, useTask } from '@/data/hooks';
import { availableResponses, isBusy, isQuiet, needsResponse } from '@/lib/lifecycle';
import { walkFrom } from '@/lib/presence';
import { routeBetween } from '@/lib/route';
import type { EscalationResponseKind, HandoverTarget } from '@/lib/schema';
import { useTheme } from '@/hooks/use-theme';

type Step = 'main' | 'pick-backup' | 'pick-reassign' | 'handover' | 'emergency' | 'close';

const ICON: Record<EscalationResponseKind, { sf: string; md: string }> = {
  backup: { sf: 'person.badge.plus', md: 'person_add' },
  handover: { sf: 'cross.case', md: 'medical_services' },
  reassign: { sf: 'arrow.triangle.2.circlepath', md: 'swap_horiz' },
  call: { sf: 'phone', md: 'call' },
  close: { sf: 'xmark', md: 'close' },
  carry_on: { sf: 'checkmark', md: 'check' },
};

/** Up to four teammates to pick from: free first. */
const PICKS = 4;

/**
 * Respond to "need help" or "went quiet" on task `id` (docs/SCREENS.md, Escalation). The map is the screen: what
 * they said floats on top, the responses sit in a row underneath. Hold goes through the AI, which does what was said
 * straight away; Backup turns the map into the picker. Closes itself once the task no longer needs an answer.
 */
export default function RespondSheet() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const repo = useRepo();
  const me = useMe();
  const task = useTask(id);
  const { tasks, positions, now } = useSnapshot();
  const { volunteers, zones } = useLookups();
  const candidates = useCandidates(id);
  const [step, setStep] = useState<Step>('main');
  const [picked, setPicked] = useState<string | null>(null);
  const [called, setCalled] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [size, setSize] = useState({ height: 0, card: 0, dock: 0 });

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

  const keyboard = useAnimatedKeyboard();
  const lift = useAnimatedStyle(() => ({ transform: [{ translateY: -Math.max(0, keyboard.height.get() - insets.bottom) }] }));

  const owner = task?.assigneeId ? volunteers[task.assigneeId] : undefined;
  const first = owner?.name.split(' ')[0] ?? 'them';
  const quiet = !!task && isQuiet(task);
  const canPass = !!task && me?.role === 'team_lead' && needsResponse(task) && task.escalation?.level === 'lead';
  const all = Object.values(tasks);

  const respond = (kind: EscalationResponseKind, extra: { volunteerId?: string; target?: HandoverTarget; note?: string } = {}) =>
    task ? attempt(() => repo.respond(task.id, { kind, ...extra })) : Promise.resolve(false);

  const call = async () => {
    const ok = await respond('call');
    setCalled(true);
    if (owner?.phone) callNumber(owner.phone);
    return ok;
  };

  const passToMo = async () => {
    if (!task) return false;
    const ok = await attempt(() => repo.passToCoordinator(task.id));
    if (ok) router.back();
    return ok;
  };

  const people: Pickable[] = task
    ? candidates
        .map((c) => {
          const v = volunteers[c.volunteerId];
          const route = v ? routeBetween(walkFrom(positions, v.id, v.zoneSlug, now), task.zoneSlug) : null;
          return v ? { volunteer: v, minutes: route ? Math.max(1, Math.round(route.minutes)) : null, busy: isBusy(all, v.id) } : null;
        })
        .filter((p): p is Pickable => !!p)
        .sort((a, b) => Number(a.busy) - Number(b.busy))
        .slice(0, PICKS)
    : [];

  const choose = (mode: 'pick-backup' | 'pick-reassign', volunteerId?: string) => {
    setPicked(volunteerId ?? people.find((p) => !p.busy)?.volunteer.id ?? null);
    setMoreOpen(false);
    setStep(mode);
  };

  // Hold: the AI reads it and does it on the server. What needs the screen opens here; 000 is still held to confirm.
  const voice = useRespondVoice({
    taskId: task?.id,
    onResult: (r) => {
      if (r.done) {
        if (r.kind === 'call') {
          setCalled(true);
          if (owner?.phone) callNumber(owner.phone);
        }
        if (r.kind === 'pass') router.back();
        return;
      }
      if (r.open === '000') setStep('emergency');
      else if (r.open) choose(r.open === 'backup' ? 'pick-backup' : 'pick-reassign');
    },
  });

  if (!task) return null;
  const handingOver = task.status === 'escalated' && task.escalation?.response?.kind === 'handover';
  const where = [task.zoneSlug ? zones[task.zoneSlug]?.name : null, task.locationHint].filter(Boolean).join(' · ');

  // Hold first, then three responses that fit, then More. After a call, the follow-up that ends it comes first.
  const afterCall = called || task.escalation?.response?.kind === 'call';
  const order = afterCall ? [...responses].sort((a, b) => Number(b === 'carry_on') - Number(a === 'carry_on')) : responses;
  const lead: EscalationResponseKind[] = quiet ? ['call', 'reassign', 'carry_on'] : afterCall ? ['carry_on', 'backup', 'handover'] : ['backup', 'call', 'handover'];
  const shown = lead.filter((k) => responses.includes(k));
  const hidden = order.filter((k) => !shown.includes(k));

  const ACT: Record<EscalationResponseKind, () => void> = {
    backup: () => choose('pick-backup'),
    reassign: () => choose('pick-reassign'),
    handover: () => setStep('handover'),
    call,
    close: () => setStep('close'),
    carry_on: () => respond('carry_on'),
  };
  const SHORT: Record<EscalationResponseKind, string> = {
    backup: 'Backup', handover: 'Hand over', reassign: 'Reassign', call: 'Call', close: 'Close', carry_on: quiet ? 'They’re fine' : 'Carry on',
  };
  const FULL: Record<EscalationResponseKind, string> = { ...SHORT, backup: 'Send backup', call: `Call ${first}` };
  const slot = (k: EscalationResponseKind, label: string): Slot => ({
    key: k, label, ...ICON[k], onPress: () => {
      voice.dismiss();
      ACT[k]();
    },
  });
  const slots = shown.map((k) => slot(k, SHORT[k]));
  const more = [
    ...hidden.map((k) => slot(k, FULL[k])),
    ...(canPass ? [{ key: 'pass', label: 'Pass to Mo', sf: 'arrow.up.circle', md: 'arrow_upward', onPress: passToMo }] : []),
  ];

  const picking = step === 'pick-backup' || step === 'pick-reassign';
  const frame = size.height > 0 ? { top: Math.min(0.6, (size.card + 8) / size.height), bottom: Math.min(0.6, size.dock / size.height) } : undefined;

  const dock = handingOver ? (
    <ArrivedStep onArrived={async () => {
      if (await attempt(() => repo.arrived(task.id))) router.back();
    }} />
  ) : responses.length === 0 ? null : picking ? (
    <PickStep
      people={people}
      picked={picked}
      onPick={setPicked}
      reassign={step === 'pick-reassign'}
      onConfirm={(vid) => respond(step === 'pick-reassign' ? 'reassign' : 'backup', { volunteerId: vid })}
      onBack={() => setStep('main')}
    />
  ) : step === 'handover' ? (
    <HandoverStep onPick={(target) => respond('handover', { target })} onEmergency={() => setStep('emergency')} onBack={() => setStep('main')} />
  ) : step === 'emergency' ? (
    <EmergencyStep where={where} onCalled={() => respond('handover', { target: 'emergency', note: 'Called 000' })} onBack={() => setStep('handover')} />
  ) : step === 'close' ? (
    <CloseStep onClose={(note) => respond('close', { note })} onBack={() => setStep('main')} />
  ) : (
    <RespondActions
      slots={slots}
      more={more}
      moreOpen={moreOpen}
      setMoreOpen={setMoreOpen}
      voice={voice}
    />
  );

  return (
    <View
      style={[styles.root, { backgroundColor: theme.mapGround }]}
      onLayout={(e) => {
        const height = e.nativeEvent.layout.height;
        setSize((s) => (s.height === height ? s : { ...s, height }));
      }}>
      <TaskMap
        task={task}
        fill
        frame={frame}
        candidates={picking ? people.map((p) => p.volunteer.id) : undefined}
        picked={picked}
        onPick={picking ? setPicked : undefined}
      />
      <RespondCard
        task={task}
        onLayout={(e) => {
          const { y, height } = e.nativeEvent.layout;
          setSize((s) => (s.card === y + height ? s : { ...s, card: y + height }));
        }}
      />
      {dock && (
        <Animated.View
          onLayout={(e) => {
            const height = e.nativeEvent.layout.height;
            setSize((s) => (s.dock === height ? s : { ...s, dock: height }));
          }}
          style={[
            styles.dock,
            { backgroundColor: theme.background, borderTopColor: theme.border, paddingBottom: Math.max(insets.bottom, 16) + 8 },
            lift,
          ]}>
          {dock}
        </Animated.View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, overflow: 'hidden' },
  dock: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: 16,
    paddingTop: 14,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
});
