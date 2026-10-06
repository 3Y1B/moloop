import { router } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Icon } from '@/components/ui/icon';
import { StatusLine } from '@/components/ui/status-line';
import { Type } from '@/constants/theme';
import { useNow, type RequestView } from '@/data/hooks';
import { ago } from '@/lib/format';
import { useTheme } from '@/hooks/use-theme';

/** One of their requests: what they said, where it's at. Opens the request. */
export function RequestRow({ view }: { view: RequestView }) {
  const theme = useTheme();
  const now = useNow();
  const { request, status } = view;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${request.heard}. ${status.label}`}
      onPress={() => router.push({ pathname: '/request/[id]', params: { id: request.id } })}
      style={({ pressed }) => [styles.row, pressed && { backgroundColor: theme.backgroundSelected }]}>
      <View style={styles.body}>
        <Text style={[styles.heard, { color: theme.text }]} numberOfLines={2}>{request.heard}</Text>
        <View style={styles.meta}>
          <StatusLine status={status} style={styles.status} />
          <Text style={[styles.ago, { color: theme.textTertiary }]}>{ago(request.createdAt, now)}</Text>
        </View>
      </View>
      <Icon sf="chevron.right" md="chevron_right" size={12} color={theme.textTertiary} weight="semibold" />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16, paddingVertical: 12 },
  body: { flex: 1, gap: 4 },
  heard: { fontSize: Type.body, lineHeight: 20 },
  meta: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  status: { flexShrink: 1 },
  ago: { fontSize: Type.footnote },
});
