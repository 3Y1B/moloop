import * as Haptics from 'expo-haptics';
import { router } from 'expo-router';
import { Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { FadeInUp, FadeOutUp } from 'react-native-reanimated';

import { Icon } from '@/components/ui/icon';
import { Radius, Type } from '@/constants/theme';
import { useLookups, useMe, useRepo } from '@/data/hooks';
import { clockTime, initials } from '@/lib/format';
import { useTheme } from '@/hooks/use-theme';

export const DUTY_CHIP_HEIGHT = 40;

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
      style={({ pressed }) => [styles.chip, { backgroundColor: theme.card, borderColor: theme.border, opacity: pressed ? 0.7 : 1 }]}>
      <View style={[styles.avatar, { backgroundColor: team?.color ?? theme.tint }]}>
        <Text style={styles.avatarText}>{initials(me.name)}</Text>
        <View style={[styles.dot, { backgroundColor: onDuty ? theme.success : theme.warning, borderColor: theme.card }]} />
      </View>
      <View>
        <Text style={[styles.chipName, { color: theme.text }]} numberOfLines={1}>{me.name.split(' ')[0]}</Text>
        <Text style={[styles.chipSub, { color: onDuty ? theme.success : theme.warning }]}>{onDuty ? 'On duty' : 'On break'}</Text>
      </View>
      <Icon sf={open ? 'chevron.up' : 'chevron.down'} md={open ? 'expand_less' : 'expand_more'} size={10} color={theme.textTertiary} weight="semibold" />
    </Pressable>
  );
}

/** Expanded shift details: team, shift end, break toggle, demo controls. */
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
      style={[styles.panel, { backgroundColor: theme.card, borderColor: theme.border }, style]}>
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
            style={({ pressed }) => [
              styles.pill,
              { backgroundColor: `${onDuty ? theme.warning : theme.success}14`, opacity: pressed ? 0.6 : 1 },
            ]}>
            <Icon sf={onDuty ? 'cup.and.saucer.fill' : 'figure.walk'} md={onDuty ? 'coffee' : 'directions_walk'} size={13} color={onDuty ? theme.warning : theme.success} />
            <Text style={[styles.pillText, { color: onDuty ? theme.warning : theme.success }]}>
              {onDuty ? 'Take a break' : 'Back on duty'}
            </Text>
          </Pressable>
          {repo.dev && (
            <Pressable
              onPress={() => router.push('/dev')}
              style={({ pressed }) => [styles.pill, { backgroundColor: theme.backgroundElement, opacity: pressed ? 0.6 : 1 }]}>
              <Icon sf="slider.horizontal.3" md="tune" size={13} color={theme.textSecondary} />
              <Text style={[styles.pillText, { color: theme.textSecondary }]}>Demo</Text>
            </Pressable>
          )}
        </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  chip: {
    flexDirection: 'row', alignItems: 'center', gap: 8, height: DUTY_CHIP_HEIGHT, paddingLeft: 4, paddingRight: 12,
    borderRadius: Radius.pill, alignSelf: 'flex-start', borderWidth: StyleSheet.hairlineWidth * 2,
  },
  avatar: { width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
  avatarText: { color: '#fff', fontWeight: '600', fontSize: Type.caption },
  dot: { position: 'absolute', right: -1, bottom: -1, width: 10, height: 10, borderRadius: 5, borderWidth: 2 },
  chipName: { fontSize: Type.footnote, fontWeight: '600' },
  chipSub: { fontSize: Type.caption - 1, fontWeight: '500' },
  // Floats over the page under the chip rather than adding another card to the stack.
  panel: {
    padding: 12, gap: 10, borderRadius: Radius.card, borderCurve: 'continuous', borderWidth: StyleSheet.hairlineWidth * 2,
  },
  panelRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  panelText: { fontSize: Type.callout, fontWeight: '600', flexShrink: 1 },
  panelMeta: { fontSize: Type.footnote, marginLeft: 'auto' },
  actions: { flexDirection: 'row', gap: 8 },
  pill: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, height: 34, borderRadius: Radius.control },
  pillText: { fontSize: Type.footnote, fontWeight: '500' },
});
