import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import Animated, { FadeIn, FadeOut, SlideInDown, SlideOutDown } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { haptic, PressableOpacity } from '@/components/ui/pressable';
import { Text } from '@/components/ui/text';
import { TOP_BAR_CONTROL } from '@/components/ui/top-bar';
import { Radius, Shadow } from '@/constants/theme';
import { VENUE_ZONES } from '@/data/venue';
import { useTheme } from '@/hooks/use-theme';

/** The places a festival-goer would say they're at, in the order they'd look for them. */
const PICKABLE = [
  'lawn-stage', 'river-stage', 'grove-stage', 'the-grove', 'pavilion', 'playground', 'food-alley', 'bar', 'market', 'water-1', 'water-2', 'water-3',
  'toilets-west', 'toilets-east', 'first-aid-hq', 'info-tent', 'gate-b', 'gate-a', 'merch-lounge', 'ticket-office',
].filter((s) => VENUE_ZONES[s]);

/**
 * Where the request is from. `picked` is a zone they chose by hand; without one it's the zone nearest the phone (`near`),
 * or nothing when there's no fix on site.
 */
export function PlaceChip({ picked, near, located, onPress }: {
  picked: string | null;
  near: string | null;
  /** The phone has a fix. */
  located: boolean;
  onPress: () => void;
}) {
  const theme = useTheme();
  const zone = picked ? VENUE_ZONES[picked]?.label : null;
  const nearLabel = near ? VENUE_ZONES[near]?.label : null;
  const set = !!zone || located;
  return (
    <PressableOpacity
      accessibilityRole="button"
      accessibilityLabel={zone ?? (located ? `Near me${nearLabel ? `, ${nearLabel}` : ''}` : 'Set location')}
      haptic="selection"
      onPress={onPress}
      style={[styles.chip, { backgroundColor: theme.card }]}>
      <Icon sf={set ? 'location.fill' : 'location'} md={set ? 'near_me' : 'location_searching'} size={16} color={theme.text} />
      <Text style={styles.chipText} numberOfLines={1}>
        {zone ?? (located ? 'Near me' : 'Set location')}
        {!zone && located && nearLabel && <Text tone="secondary" style={styles.detail}>{`  ${nearLabel}`}</Text>}
      </Text>
    </PressableOpacity>
  );
}

/** "Near me" first, then the zones by name. `null` is "Near me". */
export function PlacePicker({ picked, onPick, onClose }: {
  picked: string | null;
  onPick: (zone: string | null) => void;
  onClose: () => void;
}) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <View style={StyleSheet.absoluteFill}>
      <Animated.View entering={FadeIn.duration(160)} exiting={FadeOut.duration(140)} style={[StyleSheet.absoluteFill, { backgroundColor: theme.scrim }]}>
        <Pressable accessibilityLabel="Close" style={StyleSheet.absoluteFill} onPress={onClose} />
      </Animated.View>
      <Animated.View
        entering={SlideInDown.duration(240)}
        exiting={SlideOutDown.duration(180)}
        style={[styles.panel, { backgroundColor: theme.card, paddingBottom: insets.bottom + 8 }]}>
        <View style={[styles.head, { borderBottomColor: theme.separator }]}>
          <Text variant="title">Set location</Text>
          <Button label="Close" size="inline" haptic="none" onPress={onClose} />
        </View>
        <ScrollView>
          <Option label="Near me" near selected={picked === null} onPress={() => onPick(null)} />
          {PICKABLE.map((slug) => (
            <Option key={slug} label={VENUE_ZONES[slug].label} selected={picked === slug} onPress={() => onPick(slug)} />
          ))}
        </ScrollView>
      </Animated.View>
    </View>
  );
}

function Option({ label, near, selected, onPress }: { label: string; near?: boolean; selected: boolean; onPress: () => void }) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={() => {
        haptic('selection');
        onPress();
      }}
      style={({ pressed }) => [
        styles.row,
        { borderBottomColor: theme.separator },
        selected ? { backgroundColor: theme.tintSoft } : pressed && { backgroundColor: theme.backgroundElement },
      ]}>
      {near && <Icon sf="location.fill" md="near_me" size={18} color={theme.tint} />}
      <Text tone={selected || near ? 'tint' : 'primary'} style={[styles.label, (near || selected) && styles.strong]}>
        {label}
      </Text>
      {selected && <Icon sf="checkmark" md="check" size={18} color={theme.tint} weight="semibold" />}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    maxWidth: 260,
    height: TOP_BAR_CONTROL,
    paddingHorizontal: 16,
    borderRadius: TOP_BAR_CONTROL / 2,
    ...Shadow.floating,
  },
  chipText: { flexShrink: 1, fontWeight: '600' },
  detail: { fontWeight: '400' },
  panel: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: '72%',
    overflow: 'hidden',
    borderTopLeftRadius: Radius.card,
    borderTopRightRadius: Radius.card,
  },
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    height: 56,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    minHeight: 56,
    paddingHorizontal: 20,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  label: { flex: 1 },
  strong: { fontWeight: '600' },
});
