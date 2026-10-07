import * as Haptics from 'expo-haptics';
import { Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { FadeInUp, FadeOutUp } from 'react-native-reanimated';

import { floating, MAP_BUTTON } from '@/components/map/map-button';
import { Avatar } from '@/components/ui/avatar';
import { Icon } from '@/components/ui/icon';
import { Radius, Type } from '@/constants/theme';
import { useLookups, useMe, useRepo } from '@/data/hooks';
import { clockTime } from '@/lib/format';
import { useTheme } from '@/hooks/use-theme';

export const DUTY_CHIP_HEIGHT = MAP_BUTTON;

/** Collapsed identity: avatar with a duty dot and first name. Tap to open the duty panel. */
export function DutyChip({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  const theme = useTheme();
  const me = useMe();
  const { teams } = useLookups();
  if (!me) return null;
  const team = me.teamSlug ? teams[me.teamSlug] : undefined;
  const onDuty = me.duty === 'on_duty';

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ expanded: open }}
      accessibilityLabel={`${me.name}, ${onDuty ? 'on duty' : 'on break'}. Shift details`}
      onPress={() => {
        Haptics.selectionAsync();
        onToggle();
      }}
      style={({ pressed }) => [styles.chip, { backgroundColor: theme.card, opacity: pressed ? 0.7 : 1 }]}>
      <Avatar name={me.name} color={team?.color} dot={onDuty ? theme.success : theme.warning} />
      <View>
        <Text style={[styles.chipName, { color: theme.text }]} numberOfLines={1}>{me.name.split(' ')[0]}</Text>
        <Text style={[styles.chipSub, { color: onDuty ? theme.success : theme.warning }]}>{onDuty ? 'On duty' : 'On break'}</Text>
      </View>
      <Icon sf={open ? 'chevron.up' : 'chevron.down'} md={open ? 'expand_less' : 'expand_more'} size={10} color={theme.textTertiary} weight="semibold" />
    </Pressable>
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
          <Text style={[styles.panelText, { color: theme.text }]}>{team?.name ?? 'Coordinator'}</Text>
          {me.shiftEndsAt && (
            <Text style={[styles.panelMeta, { color: theme.textSecondary }]}>until {clockTime(me.shiftEndsAt)}</Text>
          )}
        </View>
        <View style={styles.actions}>
          <Pressable
            accessibilityRole="switch"
            accessibilityState={{ checked: onDuty }}
            onPress={() => {
              Haptics.selectionAsync();
              repo.setDuty(onDuty ? 'on_break' : 'on_duty');
            }}
            style={({ pressed }) => [styles.pill, { backgroundColor: theme.backgroundElement, opacity: pressed ? 0.6 : 1 }]}>
            <Icon sf={onDuty ? 'cup.and.saucer.fill' : 'figure.walk'} md={onDuty ? 'coffee' : 'directions_walk'} size={13} color={onDuty ? theme.warning : theme.success} />
            <Text style={[styles.pillText, { color: theme.text }]}>
              {onDuty ? 'Take a break' : 'Back on duty'}
            </Text>
          </Pressable>
        </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  chip: {
    flexDirection: 'row', alignItems: 'center', gap: 8, height: DUTY_CHIP_HEIGHT, paddingLeft: 4, paddingRight: 12,
    borderRadius: Radius.pill, alignSelf: 'flex-start', ...floating,
  },
  chipName: { fontSize: Type.footnote, fontWeight: '600' },
  chipSub: { fontSize: Type.caption - 1, fontWeight: '500' },
  // Floats over the page under the chip rather than adding another card to the stack.
  panel: {
    padding: 12, gap: 10, borderRadius: Radius.card, borderCurve: 'continuous', ...floating,
  },
  panelRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  panelText: { fontSize: Type.callout, fontWeight: '600', flexShrink: 1 },
  panelMeta: { fontSize: Type.footnote, marginLeft: 'auto' },
  actions: { flexDirection: 'row', gap: 8 },
  pill: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, height: 34, borderRadius: Radius.control },
  pillText: { fontSize: Type.footnote, fontWeight: '500' },
});
