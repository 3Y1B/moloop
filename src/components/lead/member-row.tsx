import { router } from 'expo-router';
import { StyleSheet, Text } from 'react-native';

import { Type } from '@/constants/theme';
import type { TeamMember } from '@/data/hooks';
import { toneColor, useTheme } from '@/hooks/use-theme';
import { TeamRow } from './team-list';

/** A teammate: first name, then their status in its tone. Tap for the Person sheet. */
export function MemberRow({ member }: { member: TeamMember }) {
  const theme = useTheme();
  const { volunteer, status } = member;
  const off = volunteer.duty === 'off_shift';
  return (
    <TeamRow
      label={`${volunteer.name}, ${status.label}`}
      onPress={() => router.push({ pathname: '/person/[id]', params: { id: volunteer.id } })}>
      <Text style={[styles.name, { color: off ? theme.textTertiary : theme.text }]} numberOfLines={1}>
        {volunteer.name.split(' ')[0]}
      </Text>
      <Text style={[styles.status, { color: toneColor(theme, status.tone) }]} numberOfLines={1}>
        {status.label}
      </Text>
    </TeamRow>
  );
}

const styles = StyleSheet.create({
  name: { width: 84, fontSize: Type.body, fontWeight: '500' },
  status: { flex: 1, fontSize: Type.body },
});
