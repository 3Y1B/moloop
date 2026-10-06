import { router } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Avatar } from '@/components/ui/avatar';
import { Icon } from '@/components/ui/icon';
import { StatusLine } from '@/components/ui/status-line';
import { Type } from '@/constants/theme';
import type { TeamMember } from '@/data/hooks';
import { useTheme } from '@/hooks/use-theme';
import { TaskProgress } from './task-head';

/** A teammate: who, their status line, and how far through their task they are. Tap for the Person sheet. */
export function MemberRow({ member, color }: { member: TeamMember; color: string }) {
  const theme = useTheme();
  const { volunteer, status, task } = member;
  const away = volunteer.duty !== 'on_duty';
  return (
    <Pressable
      onPress={() => router.push({ pathname: '/person/[id]', params: { id: volunteer.id } })}
      style={({ pressed }) => [styles.row, pressed && { backgroundColor: theme.backgroundSelected }]}>
      <Avatar name={volunteer.name} color={away ? theme.textTertiary : color} size={32} />
      <View style={styles.body}>
        <Text style={[styles.name, { color: theme.text }]} numberOfLines={1}>{volunteer.name}</Text>
        <StatusLine status={status} />
        {task && <TaskProgress task={task} />}
      </View>
      <Icon sf="chevron.right" md="chevron_right" size={12} color={theme.textTertiary} weight="medium" />
    </Pressable>
  );
}

/** Inset for separators between member rows: past the avatar. */
export const MEMBER_INSET = 58;

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 14, paddingVertical: 10, minHeight: 56 },
  body: { flex: 1, gap: 3 },
  name: { fontSize: Type.body - 1, fontWeight: '500' },
});
