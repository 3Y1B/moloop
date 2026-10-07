import { Linking, StyleSheet, View } from 'react-native';

import { Avatar } from '@/components/ui/avatar';
import { Icon } from '@/components/ui/icon';
import { PressableOpacity } from '@/components/ui/pressable';
import { Text } from '@/components/ui/text';
import { useLookups } from '@/data/hooks';
import type { Task } from '@/lib/schema';
import { useTheme } from '@/hooks/use-theme';

/** Backing someone up: whose task it is, and a quick call to them. */
export function Owner({ task }: { task: Task }) {
  const theme = useTheme();
  const { volunteers } = useLookups();
  const owner = task.assigneeId ? volunteers[task.assigneeId] : undefined;
  if (!owner) return null;
  return (
    <View style={styles.owner}>
      <Avatar name={owner.name} size={22} />
      <Text variant="footnote" style={styles.name} numberOfLines={1}>
        {owner.name}
      </Text>
      {owner.phone && (
        <PressableOpacity
          accessibilityRole="button"
          accessibilityLabel={`Call ${owner.name}`}
          hitSlop={8}
          haptic="selection"
          onPress={() => Linking.openURL(`tel:${owner.phone!.replace(/\s+/g, '')}`)}
          style={styles.call}>
          <Icon sf="phone.fill" md="call" size={12} color={theme.tint} />
          <Text variant="footnote" tone="tint" style={styles.medium}>Call</Text>
        </PressableOpacity>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  owner: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  name: { flex: 1, fontWeight: '500' },
  medium: { fontWeight: '500' },
  call: { flexDirection: 'row', alignItems: 'center', gap: 3, paddingVertical: 2 },
});
