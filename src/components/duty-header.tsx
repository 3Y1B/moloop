import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { FadeInUp, FadeOutUp } from 'react-native-reanimated';

import { Avatar } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { PressableOpacity } from '@/components/ui/pressable';
import { Text } from '@/components/ui/text';
import { TOP_BAR_CONTROL } from '@/components/ui/top-bar';
import { Radius, Shadow, Type } from '@/constants/theme';
import { useLookups, useMe, useRepo } from '@/data/hooks';
import { clockTime } from '@/lib/format';
import { useTheme } from '@/hooks/use-theme';

export const DUTY_CHIP_HEIGHT = TOP_BAR_CONTROL;

/** Collapsed identity: avatar with a duty dot and first name. Tap to open the duty panel. `flat` on a plain page. */
export function DutyChip({ open, onToggle, flat = false }: { open: boolean; onToggle: () => void; flat?: boolean }) {
  const theme = useTheme();
  const me = useMe();
  const { teams } = useLookups();
  if (!me) return null;
  const team = me.teamSlug ? teams[me.teamSlug] : undefined;
  const onDuty = me.duty === 'on_duty';

  return (
    <PressableOpacity
      accessibilityRole="button"
      accessibilityState={{ expanded: open }}
      accessibilityLabel={`${me.name}, ${onDuty ? 'on duty' : 'on break'}. Shift details`}
      haptic="selection"
      onPress={onToggle}
      style={[
        styles.chip,
        flat ? { borderWidth: StyleSheet.hairlineWidth, borderColor: theme.border } : Shadow.floating,
        { backgroundColor: theme.card },
      ]}>
      <Avatar name={me.name} face={me.avatar} color={team?.color} dot={onDuty ? theme.success : theme.warning} />
      <View>
        <Text variant="label" tone="primary" numberOfLines={1}>{me.name.split(' ')[0]}</Text>
        <Text tone={onDuty ? 'success' : 'warning'} style={styles.chipSub}>{onDuty ? 'On duty' : 'On break'}</Text>
      </View>
      <Icon sf={open ? 'chevron.up' : 'chevron.down'} md={open ? 'expand_less' : 'expand_more'} size={10} color={theme.textTertiary} weight="semibold" />
    </PressableOpacity>
  );
}

/** Expanded shift details: team, shift end, break toggle. */
export function DutyPanel({ style }: { style?: StyleProp<ViewStyle> }) {
  const theme = useTheme();
  const repo = useRepo();
  const me = useMe();
  const { teams } = useLookups();
  if (!me) return null;
  const team = me.teamSlug ? teams[me.teamSlug] : undefined;
  const onDuty = me.duty === 'on_duty';

  return (
    <Animated.View
      entering={FadeInUp.duration(180)}
      exiting={FadeOutUp.duration(140)}
      style={[styles.panel, { backgroundColor: theme.card }, style]}>
        <View style={styles.panelRow}>
          {team && <Icon sf={team.sf} md={team.md} size={14} color={team.color} />}
          <Text variant="callout" style={styles.panelText}>{team?.name ?? 'Coordinator'}</Text>
          {me.shiftEndsAt && (
            <Text variant="footnote" tone="secondary" style={styles.panelMeta}>until {clockTime(me.shiftEndsAt)}</Text>
          )}
        </View>
        <View style={styles.actions}>
          <Button
            variant="secondary"
            size="small"
            label={onDuty ? 'Take a break' : 'Back on duty'}
            sf={onDuty ? 'cup.and.saucer.fill' : 'figure.walk'}
            md={onDuty ? 'coffee' : 'directions_walk'}
            onPress={() => repo.setDuty(onDuty ? 'on_break' : 'on_duty')}
          />
        </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  chip: {
    flexDirection: 'row', alignItems: 'center', gap: 8, height: DUTY_CHIP_HEIGHT, paddingLeft: 4, paddingRight: 12,
    borderRadius: Radius.pill, alignSelf: 'flex-start',
  },
  chipSub: { fontSize: Type.caption - 1, fontWeight: '500' },
  // Floats over the page under the chip rather than adding another card to the stack.
  panel: {
    padding: 12, gap: 10, borderRadius: Radius.card, borderCurve: 'continuous', ...Shadow.floating,
  },
  panelRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  panelText: { fontWeight: '600', flexShrink: 1 },
  panelMeta: { marginLeft: 'auto' },
  actions: { flexDirection: 'row', gap: 8 },
});
