import * as Haptics from 'expo-haptics';
import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeIn, FadeOut, LinearTransition } from 'react-native-reanimated';

import { Radius, Type } from '@/constants/theme';
import { useNow, type RequestView } from '@/data/hooks';
import { ago } from '@/lib/format';
import { toneColor, useTheme } from '@/hooks/use-theme';

/** Still in motion: not sorted or cancelled. */
export const isOpen = (r: RequestView) => r.status.stage !== 'sorted' && r.status.stage !== 'cancelled';

/** The newest open request on one line; the rest fold underneath it. Open ones first, newest first. */
export function RequestFold({ requests, maxHeight }: { requests: RequestView[]; maxHeight: number }) {
  const theme = useTheme();
  const [open, setOpen] = useState(false);
  const [lead, ...rest] = [...requests].sort((a, b) => Number(isOpen(b)) - Number(isOpen(a)) || b.request.createdAt - a.request.createdAt);
  if (!lead) return null;
  return (
    <Animated.View
      layout={LinearTransition.duration(200)}
      style={[styles.card, { backgroundColor: theme.card, borderColor: theme.border }]}>
      <ScrollView style={{ maxHeight }} scrollEnabled={open} bounces={false}>
        <RequestRow view={lead} />
        {open && rest.map((r) => (
          <Animated.View
            key={r.request.id}
            entering={FadeIn.duration(160)}
            exiting={FadeOut.duration(120)}
            style={[styles.divided, { borderTopColor: theme.separator }]}>
            <RequestRow view={r} />
          </Animated.View>
        ))}
      </ScrollView>
      {rest.length > 0 && (
        <Pressable
          accessibilityRole="button"
          onPress={() => {
            Haptics.selectionAsync();
            setOpen((o) => !o);
          }}
          style={({ pressed }) => [
            styles.more,
            { borderTopColor: theme.separator },
            pressed && { backgroundColor: theme.backgroundSelected },
          ]}>
          <Text style={[styles.moreText, { color: theme.textSecondary }]}>{open ? 'Show less' : `${rest.length} earlier`}</Text>
        </Pressable>
      )}
    </Animated.View>
  );
}

/** One of their requests: where it's at, then what they said. Opens the request. */
export function RequestRow({ view }: { view: RequestView }) {
  const theme = useTheme();
  const now = useNow();
  const { request, status } = view;
  const tone = toneColor(theme, status.tone);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${status.label}${status.detail ? `, ${status.detail}` : ''}. ${request.heard}`}
      onPress={() => router.push({ pathname: '/request/[id]', params: { id: request.id } })}
      style={({ pressed }) => [styles.row, pressed && { backgroundColor: theme.backgroundSelected }]}>
      <View style={styles.top}>
        <View style={[styles.dot, { backgroundColor: status.tone === 'neutral' ? theme.textTertiary : tone }]} />
        <Text style={styles.status} numberOfLines={1}>
          <Text style={{ color: tone }}>{status.label}</Text>
          {status.detail && <Text style={{ color: theme.textSecondary }}>{` · ${status.detail}`}</Text>}
        </Text>
        <Text style={[styles.ago, { color: theme.textTertiary }]}>{ago(request.createdAt, now)}</Text>
      </View>
      <Text style={[styles.heard, { color: theme.textSecondary }]} numberOfLines={1}>{request.heard}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: Radius.card,
    borderCurve: 'continuous',
    borderWidth: StyleSheet.hairlineWidth * 2,
    overflow: 'hidden',
  },
  divided: { borderTopWidth: StyleSheet.hairlineWidth },
  row: { paddingHorizontal: 18, paddingVertical: 14, gap: 4 },
  top: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  status: { flex: 1, fontSize: Type.body, fontWeight: '600' },
  ago: { fontSize: Type.footnote },
  heard: { marginLeft: 18, fontSize: Type.callout },
  more: { height: 44, alignItems: 'center', justifyContent: 'center', borderTopWidth: StyleSheet.hairlineWidth },
  moreText: { fontSize: Type.callout, fontWeight: '600' },
});
