import { Pressable, StyleSheet, View } from 'react-native';
import Animated, { FadeInDown, FadeOut } from 'react-native-reanimated';

import { Icon } from '@/components/ui/icon';
import { ListRow } from '@/components/ui/list-row';
import { PressableOpacity } from '@/components/ui/pressable';
import { Text } from '@/components/ui/text';
import { NOT_CAUGHT } from '@/components/voice/flash';
import { Waveform } from '@/components/voice/waveform';
import { useTheme } from '@/hooks/use-theme';
import type { VoicePhase } from './respond-voice';

/** One round action under the map. */
export type Slot = { key: string; label: string; sf: string; md: string; onPress: () => void };

const SIZE = 56;

/**
 * The bottom of the Respond screen: Hold first (the one filled circle: say it, the AI works out what you meant and
 * does it), then the responses that fit, then More for the rest. While a hold is live or being acted on, this is
 * where it shows.
 */
export function RespondActions({ slots, more, moreOpen, setMoreOpen, voice }: {
  slots: Slot[];
  /** Under More. Empty: no More. */
  more: Slot[];
  moreOpen: boolean;
  setMoreOpen: (open: boolean) => void;
  voice: { phase: VoicePhase; level: number; start: () => void; end: () => void };
}) {
  const theme = useTheme();
  const { phase } = voice;
  const listening = phase.kind === 'listening';
  const busy = phase.kind === 'hearing' || phase.kind === 'acting';

  return (
    <View>
      {(listening || busy) && (
        <Animated.View entering={FadeInDown.duration(160)} exiting={FadeOut.duration(120)} style={styles.live}>
          <Text variant="label" tone={listening ? 'tint' : 'tertiary'}>{listening ? 'Listening' : 'Heard'}</Text>
          {listening ? (
            <Waveform active level={voice.level} bars={28} height={22} />
          ) : (
            <Text variant="title" tone={phase.kind === 'acting' ? 'primary' : 'tertiary'} style={styles.said} numberOfLines={3}>
              {phase.kind === 'acting' ? phase.text : '…'}
            </Text>
          )}
        </Animated.View>
      )}

      {phase.kind === 'missed' && (
        <Animated.View entering={FadeInDown.duration(160)} exiting={FadeOut.duration(120)} style={styles.live}>
          <View style={styles.row}>
            <Icon sf="exclamationmark.circle.fill" md="error" size={16} color={theme.warning} />
            <Text variant="label">{NOT_CAUGHT}</Text>
          </View>
          <Text variant="title" style={styles.said} numberOfLines={3} selectable>{phase.text}</Text>
        </Animated.View>
      )}

      {phase.kind === 'flash' && (
        <Animated.View entering={FadeInDown.duration(160)} exiting={FadeOut.duration(120)} style={styles.flash}>
          <Icon
            sf={phase.ok ? 'checkmark.circle.fill' : 'exclamationmark.circle.fill'}
            md={phase.ok ? 'check_circle' : 'error'}
            size={18}
            color={phase.ok ? theme.success : theme.warning}
          />
          <Text variant="callout" style={styles.flashText} numberOfLines={2}>{phase.message}</Text>
        </Animated.View>
      )}

      {moreOpen && more.length > 0 && (phase.kind === 'idle' || phase.kind === 'missed') && (
        <Animated.View entering={FadeInDown.duration(180)} exiting={FadeOut.duration(120)} style={[styles.more, { borderBottomColor: theme.separator }]}>
          {more.map((x) => (
            <ListRow
              key={x.key}
              flush
              haptic="selection"
              leading={<Icon sf={x.sf} md={x.md} size={18} color={theme.textSecondary} />}
              title={x.label}
              onPress={() => {
                setMoreOpen(false);
                x.onPress();
              }}
              style={styles.moreRow}
            />
          ))}
        </Animated.View>
      )}

      <View style={styles.slots}>
        <Pressable
          onPressIn={voice.start}
          onPressOut={voice.end}
          disabled={busy}
          accessibilityRole="button"
          accessibilityLabel="Hold to talk"
          style={styles.slot}>
          <View style={[styles.circle, { backgroundColor: theme.tint }, listening && styles.big]}>
            <Icon sf="mic.fill" md="mic" size={22} color={theme.onTint} />
          </View>
          <Text variant="label" tone="primary" numberOfLines={1}>Hold</Text>
        </Pressable>
        {slots.map((x) => (
          <Round key={x.key} slot={x} />
        ))}
        {more.length > 0 && (
          <Round
            slot={{ key: 'more', label: 'More', sf: 'ellipsis', md: 'more_horiz', onPress: () => setMoreOpen(!moreOpen) }}
            active={moreOpen}
          />
        )}
      </View>
    </View>
  );
}

function Round({ slot, active }: { slot: Slot; active?: boolean }) {
  const theme = useTheme();
  return (
    <PressableOpacity
      accessibilityRole="button"
      accessibilityLabel={slot.label}
      haptic="selection"
      onPress={slot.onPress}
      style={styles.slot}>
      <View style={[styles.circle, { backgroundColor: active ? theme.backgroundSelected : theme.backgroundElement }]}>
        <Icon sf={slot.sf} md={slot.md} size={22} color={theme.text} />
      </View>
      <Text variant="footnote" numberOfLines={1}>{slot.label}</Text>
    </PressableOpacity>
  );
}

const styles = StyleSheet.create({
  slots: { flexDirection: 'row', justifyContent: 'space-between' },
  slot: { flex: 1, alignItems: 'center', gap: 6 },
  circle: { width: SIZE, height: SIZE, borderRadius: SIZE / 2, alignItems: 'center', justifyContent: 'center' },
  big: { transform: [{ scale: 1.08 }] },
  live: { gap: 6, paddingBottom: 14 },
  flash: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingBottom: 14 },
  flashText: { flex: 1, fontWeight: '500' },
  // What was said reads as words, not a heading.
  said: { fontWeight: '400', letterSpacing: 0 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  more: { paddingBottom: 6, marginBottom: 12, borderBottomWidth: StyleSheet.hairlineWidth },
  moreRow: { gap: 14, paddingHorizontal: 6 },
});
