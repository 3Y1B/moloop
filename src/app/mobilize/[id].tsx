import { useLocalSearchParams } from 'expo-router';
import { Fragment, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { openTaskSheet } from '@/components/lead/open-sheet';
import { Sheet, SheetTitle } from '@/components/lead/sheet';
import { causeLines, fromPlaces, shortfall } from '@/components/mobilization/review';
import { Button } from '@/components/ui/button';
import { Card, Separator } from '@/components/ui/card';
import { Icon } from '@/components/ui/icon';
import { Type } from '@/constants/theme';
import { useLookups, useMe, useMobilization, useMobilizationStatus, useNow, useRepo, useSnapshot } from '@/data/hooks';
import { useTheme } from '@/hooks/use-theme';
import type { MobilizationStepStatus } from '@/lib/status';

const people = (n: number) => `${n} ${n === 1 ? 'person' : 'people'}`;

/** Mo's review: what set it off, one row per task, any shortfall, then Approve or Dismiss. */
export default function MobilizeSheet() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const theme = useTheme();
  const repo = useRepo();
  const me = useMe();
  const snapshot = useSnapshot();
  const now = useNow();
  const { volunteers, teams, zones } = useLookups();
  const mobilization = useMobilization(id);
  const status = useMobilizationStatus(mobilization);
  const [open, setOpen] = useState<number | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const place = (slug: string | null | undefined) => (slug ? (zones[slug]?.name ?? null) : null);

  if (!mobilization || !status)
    return (
      <Sheet>
        <SheetTitle title="Mobilization" />
        <Text style={[styles.line, { color: theme.textSecondary }]}>
          {snapshot.status === 'loading' ? 'Loading…' : snapshot.status === 'error' ? "Couldn't load." : 'No longer available.'}
        </Text>
      </Sheet>
    );

  const mo = me?.role === 'coordinator';
  const pending = mobilization.status === 'proposed';
  const active = mobilization.status === 'active';
  const permitted =
    mo || (me?.role === 'team_lead' && !pending && mobilization.steps.some((step) => step.teamSlug === me.teamSlug));
  if (!permitted)
    return (
      <Sheet>
        <SheetTitle title="Mobilization" />
        <Text style={[styles.line, { color: theme.textSecondary }]}>Mo and the teams on it only.</Text>
      </Sheet>
    );

  const allTasks = Object.values(snapshot.tasks);
  const causes = causeLines(mobilization.causes ?? [], now, place);
  const short = pending ? shortfall(mobilization, volunteers, allTasks, now) : active ? status.summary.missingCount : 0;
  const controls = mo ? repo.mobilizations : undefined;
  const steps = mobilization.steps
    .map((step, index) => ({ step, index, live: stepStatus(status.steps, step.stepKey, index) }))
    .filter(({ step }) => mo || step.teamSlug === me?.teamSlug);

  const run = async (action: () => Promise<void>, failed: string) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await action();
      setConfirming(false);
    } catch (cause) {
      setError(cause instanceof Error && cause.message ? cause.message : failed);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet>
      <SheetTitle eyebrow={status.label} title={mobilization.title} />
      <View style={styles.causes}>
        {causes.length > 0 ? (
          causes.map((line) => (
            <Text key={line} style={[styles.line, { color: theme.textSecondary }]}>
              {line}
            </Text>
          ))
        ) : (
          <Text style={[styles.line, { color: theme.textSecondary }]} numberOfLines={3}>
            {mobilization.rationale}
          </Text>
        )}
      </View>

      <Card>
        {steps.map(({ step, index, live }, row) => {
          const team = teams[step.teamSlug];
          const expanded = open === index;
          const task = live?.taskId ? snapshot.tasks[live.taskId] : undefined;
          const from = pending ? fromPlaces(step, volunteers, allTasks, now, place) : null;
          const staffing = pending
            ? [people(step.peopleNeeded), from && `from ${from}`].filter(Boolean).join(' · ')
            : live?.terminal
              ? live.taskStatus === 'resolved' ? 'Done' : 'Closed'
              : `${live?.confirmedCount ?? 0} of ${live?.requiredCount ?? step.peopleNeeded} confirmed`;
          const at = place(step.zoneSlug);
          return (
            <Fragment key={step.stepKey ?? index}>
              {row > 0 && <Separator inset={46} />}
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={step.title ?? team?.name ?? step.reason}
                accessibilityState={{ expanded }}
                onPress={() => setOpen(expanded ? null : index)}
                style={({ pressed }) => [styles.step, pressed && { backgroundColor: theme.backgroundSelected }]}>
                <View style={styles.teamIcon}>
                  {team && <Icon sf={team.sf} md={team.md} size={18} color={team.color} weight="medium" />}
                </View>
                <View style={styles.body}>
                  <Text style={[styles.what, { color: theme.text }]} numberOfLines={expanded ? undefined : 2}>
                    {step.title ?? team?.name ?? step.reason}
                  </Text>
                  <Text style={[styles.sub, { color: theme.textSecondary }]} numberOfLines={1}>
                    {[team?.short, staffing].filter(Boolean).join(' · ')}
                  </Text>
                  {expanded && (
                    <View style={styles.detail}>
                      <Text style={[styles.line, { color: theme.text }]}>{step.instructions ?? step.reason}</Text>
                      {at && at !== place(mobilization.zoneSlug) && (
                        <Text style={[styles.sub, { color: theme.textSecondary }]}>At {at}</Text>
                      )}
                      {task && (
                        <Button
                          label="Open task"
                          variant="tinted"
                          size="small"
                          onPress={() => openTaskSheet(task, snapshot.proposals)}
                          style={styles.openTask}
                        />
                      )}
                    </View>
                  )}
                </View>
                <Icon
                  sf={expanded ? 'chevron.up' : 'chevron.down'}
                  md={expanded ? 'expand_less' : 'expand_more'}
                  size={12}
                  color={theme.textTertiary}
                  weight="medium"
                />
              </Pressable>
            </Fragment>
          );
        })}
      </Card>

      {short > 0 && (pending || active) && (
        <Text style={[styles.line, { color: theme.warning }]}>{short} short. Will keep trying.</Text>
      )}
      {error && (
        <Text accessibilityRole="alert" style={[styles.line, { color: theme.danger }]}>
          {error}
        </Text>
      )}

      {controls && (pending || active) && (
        <View style={styles.actions}>
          {confirming ? (
            <>
              <Button
                label="Keep"
                variant="tinted"
                color={theme.text}
                size="large"
                disabled={busy}
                onPress={() => setConfirming(false)}
                style={styles.flex}
              />
              <Button
                label={pending ? 'Confirm dismiss' : 'Confirm stand down'}
                variant="tinted"
                color={theme.danger}
                size="large"
                haptic="warning"
                disabled={busy}
                onPress={() =>
                  void run(
                    () => (pending ? controls.reject(mobilization.id) : controls.standDown(mobilization.id, 'stood_down')),
                    pending ? "Couldn't dismiss." : "Couldn't stand down.",
                  )
                }
                style={styles.flex}
              />
            </>
          ) : (
            <>
              <Button
                label={pending ? 'Dismiss' : 'Stand down'}
                variant="tinted"
                color={theme.text}
                size="large"
                disabled={busy}
                onPress={() => setConfirming(true)}
                style={styles.flex}
              />
              {pending && (
                <Button
                  label="Approve"
                  sf="checkmark"
                  size="large"
                  haptic="success"
                  disabled={busy}
                  onPress={() =>
                    void run(
                      () =>
                        controls.approve(mobilization.id, {
                          reviewedRunId: mobilization.analysisRunId ?? undefined,
                        }),
                      "Couldn't approve.",
                    )
                  }
                  style={styles.flex}
                />
              )}
            </>
          )}
        </View>
      )}
    </Sheet>
  );
}

/** A step's live status by its key; older plans without keys line up by position. */
function stepStatus(steps: MobilizationStepStatus[], stepKey: string | undefined, index: number) {
  return stepKey ? steps.find((item) => item.stepKey === stepKey) : steps[index];
}

const styles = StyleSheet.create({
  causes: { gap: 4 },
  line: { fontSize: Type.callout, lineHeight: 20 },
  step: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, paddingHorizontal: 14, paddingVertical: 12, minHeight: 56 },
  teamIcon: { width: 20, alignItems: 'center', paddingTop: 1 },
  body: { flex: 1, gap: 2 },
  what: { fontSize: Type.body - 1, fontWeight: '500', lineHeight: 20 },
  sub: { fontSize: Type.footnote - 1 },
  detail: { gap: 6, paddingTop: 6 },
  openTask: { alignSelf: 'flex-start', marginTop: 2 },
  actions: { flexDirection: 'row', gap: 10, marginTop: 4 },
  flex: { flex: 1 },
});
