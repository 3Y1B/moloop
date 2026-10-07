import * as Haptics from 'expo-haptics';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeIn, FadeOut, SlideInDown, SlideOutDown } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { floating, MAP_BUTTON } from '@/components/map/map-button';
import { Icon } from '@/components/ui/icon';
import { Radius, Type } from '@/constants/theme';
import { VENUE_ZONES } from '@/data/venue';
import { useTheme } from '@/hooks/use-theme';

/** The places a festival-goer would say they're at, in the order they'd look for them. */
const PICKABLE = [
  'lawn-stage', 'river-stage', 'water-1', 'water-2', 'bar', 'food-alley', 'toilets-east', 'toilets-west',
  'first-aid-hq', 'info-tent', 'the-grove', 'pavilion', 'gate-b', 'gate-a', 'merch-lounge', 'ticket-office',
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
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={zone ?? (located ? `Near me${nearLabel ? `, ${nearLabel}` : ''}` : 'Set location')}
      onPress={() => {
        Haptics.selectionAsync();
        onPress();
      }}
      style={({ pressed }) => [
        styles.chip,
        { backgroundColor: pressed ? theme.backgroundElement : theme.card },
      ]}>
      <Icon sf={set ? 'location.fill' : 'location'} md={set ? 'near_me' : 'location_searching'} size={16} color={theme.text} />
      <Text style={[styles.chipText, { color: theme.text }]} numberOfLines={1}>
        {zone ?? (located ? 'Near me' : 'Set location')}
        {!zone && located && nearLabel && <Text style={[styles.chipDetail, { color: theme.textSecondary }]}>{`  ${nearLabel}`}</Text>}
      </Text>
    </Pressable>
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
          <Text style={[styles.title, { color: theme.text }]}>Set location</Text>
          <Pressable accessibilityRole="button" onPress={onClose} hitSlop={12}>
            <Text style={[styles.close, { color: theme.tint }]}>Close</Text>
          </Pressable>
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
        Haptics.selectionAsync();
        onPress();
      }}
      style={({ pressed }) => [
        styles.row,
        { borderBottomColor: theme.separator },
        selected ? { backgroundColor: theme.tintSoft } : pressed && { backgroundColor: theme.backgroundElement },
      ]}>
      {near && <Icon sf="location.fill" md="near_me" size={18} color={theme.tint} />}
      <Text style={[styles.label, { color: selected || near ? theme.tint : theme.text, fontWeight: near || selected ? '600' : '400' }]}>
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
    height: MAP_BUTTON,
    paddingHorizontal: 16,
    borderRadius: MAP_BUTTON / 2,
    ...floating,
  },
  chipText: { flexShrink: 1, fontSize: Type.body, fontWeight: '600' },
  chipDetail: { fontWeight: '400' },
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
  title: { fontSize: Type.title, fontWeight: '600' },
  close: { fontSize: Type.body, fontWeight: '500' },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    minHeight: 56,
    paddingHorizontal: 20,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  label: { flex: 1, fontSize: Type.body },
});
