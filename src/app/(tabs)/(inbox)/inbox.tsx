import { router } from 'expo-router';
import { Fragment } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ScreenHeader } from '@/components/screen-header';
import { Card, Separator } from '@/components/ui/card';
import { Icon } from '@/components/ui/icon';
import { BottomTabInset, Type } from '@/constants/theme';
import { useInbox, useNow, useRepo } from '@/data/hooks';
import { ago } from '@/lib/format';
import type { Message, MessageKind } from '@/lib/schema';
import { useTheme } from '@/hooks/use-theme';

const KIND: Record<MessageKind, { sf: string; md: string; color: 'tint' | 'warning' | 'success' | 'danger' | 'textTertiary' | 'purple' }> = {
  task: { sf: 'list.bullet.clipboard.fill', md: 'assignment', color: 'tint' },
  nudge: { sf: 'bell.badge.fill', md: 'notifications_active', color: 'warning' },
  broadcast: { sf: 'megaphone.fill', md: 'campaign', color: 'purple' },
  direct: { sf: 'person.crop.circle.fill', md: 'person', color: 'success' },
  system: { sf: 'info.circle.fill', md: 'info', color: 'textTertiary' },
};

export default function InboxScreen() {
  const theme = useTheme();
  const repo = useRepo();
  const { messages, unread } = useInbox();
  const insets = useSafeAreaInsets();

  return (
    <View style={[styles.flex, { backgroundColor: theme.background }]}>
      <ScreenHeader
        title="Inbox"
        right={
          unread ? (
            <Pressable hitSlop={10} onPress={() => repo.markRead(messages.map((m) => m.id))}>
              <Text style={[styles.action, { color: theme.tint }]}>Read all</Text>
            </Pressable>
          ) : undefined
        }
      />
      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + BottomTabInset + 16 }]}>
      {messages.length === 0 ? (
        <Text style={[styles.empty, { color: theme.textSecondary }]}>Nothing yet.</Text>
      ) : (
        <Card>
          {messages.map((m, i) => (
            <Fragment key={m.id}>
              {i > 0 && <Separator inset={58} />}
              <MessageRow message={m} />
            </Fragment>
          ))}
        </Card>
      )}
      </ScrollView>
    </View>
  );
}

function MessageRow({ message: m }: { message: Message }) {
  const theme = useTheme();
  const repo = useRepo();
  const now = useNow();
  const k = KIND[m.kind];
  const color = k.color === 'purple' ? '#AF52DE' : theme[k.color];

  const open = () => {
    repo.markRead([m.id]);
    if (m.taskId) router.push({ pathname: '/task/[id]', params: { id: m.taskId } });
  };

  return (
    <Pressable onPress={open} style={({ pressed }) => [styles.row, pressed && { backgroundColor: theme.backgroundSelected }]}>
      <View style={styles.unreadCol}>{!m.read && <View style={[styles.unread, { backgroundColor: theme.tint }]} />}</View>
      <View style={[styles.icon, { backgroundColor: `${color}14` }]}>
        <Icon sf={k.sf} md={k.md} size={15} color={color} />
      </View>
      <View style={styles.body}>
        <View style={styles.topRow}>
          <Text style={[styles.from, { color: theme.text }, !m.read && styles.bold]} numberOfLines={1}>
            {m.kind === 'broadcast' ? `${m.fromName} · Everyone` : m.fromName}
          </Text>
          <Text style={[styles.time, { color: theme.textTertiary }]}>{ago(m.at, now)}</Text>
        </View>
        <Text style={[styles.text, { color: m.read ? theme.textSecondary : theme.text }]} numberOfLines={4}>
          {m.body}
        </Text>
        {m.delivery && (
          <View style={styles.delivery}>
            <Icon
              sf={m.delivery === 'spoken' ? 'speaker.wave.2.fill' : 'iphone.radiowaves.left.and.right'}
              md={m.delivery === 'spoken' ? 'volume_up' : 'vibration'}
              size={12}
              color={theme.textTertiary}
            />
            <Text style={[styles.deliveryText, { color: theme.textTertiary }]}>
              {m.delivery === 'spoken' ? 'Read aloud' : 'Pinged (you were busy)'}
            </Text>
          </View>
        )}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: { padding: 16 },
  action: { fontSize: Type.callout, fontWeight: '500' },
  empty: { textAlign: 'center', marginTop: 60, fontSize: Type.body },
  row: { flexDirection: 'row', alignItems: 'flex-start', paddingVertical: 12, paddingRight: 14 },
  unreadCol: { width: 16, alignItems: 'center', paddingTop: 13 },
  unread: { width: 6, height: 6, borderRadius: 3 },
  icon: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center', marginRight: 10 },
  body: { flex: 1, gap: 2 },
  topRow: { flexDirection: 'row', alignItems: 'baseline', gap: 8 },
  from: { flex: 1, fontSize: Type.body - 1, fontWeight: '500' },
  bold: { fontWeight: '600' },
  time: { fontSize: Type.caption },
  text: { fontSize: Type.callout - 1, lineHeight: 18 },
  delivery: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 2 },
  deliveryText: { fontSize: Type.caption - 1 },
});
