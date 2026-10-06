import * as Haptics from 'expo-haptics';
import { router } from 'expo-router';
import { Linking, Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';

import { Type } from '@/constants/theme';
import type { Status, StatusAction, Tone } from '@/lib/status';
import { useTheme } from '@/hooks/use-theme';

/** Default for a tappable status: check-ins open the reply sheet, calls open the dialer. */
export function runStatusAction(action: StatusAction) {
  if (action.kind === 'update') router.push({ pathname: '/reply/[id]', params: { id: action.taskId, kind: 'still_on_it' } });
  else Linking.openURL(`tel:${action.phone.replace(/\s+/g, '')}`);
}

/** A status from `lib/status`: tone dot, label, then the detail in a quieter tone. Tappable when it has an action. */
export function StatusLine({ status, onAction, size = 'footnote', style }: {
  status: Status;
  /** Overrides the default action handling. */
  onAction?: (action: StatusAction) => void;
  size?: 'footnote' | 'callout';
  style?: StyleProp<ViewStyle>;
}) {
  const theme = useTheme();
  const color: Record<Tone, string> = {
    neutral: theme.textTertiary,
    tint: theme.tint,
    warning: theme.warning,
    danger: theme.danger,
    success: theme.success,
  };
  const c = color[status.tone];
  const fontSize = Type[size];
  const action = status.action;

  const body = (
    <View style={[styles.row, style]}>
      <View style={[styles.dot, { backgroundColor: c }]} />
      <Text style={[styles.text, { fontSize }]} numberOfLines={1}>
        <Text style={{ color: status.tone === 'neutral' ? theme.textSecondary : c, fontWeight: '600' }}>{status.label}</Text>
        {status.detail && <Text style={{ color: theme.textSecondary }}> · {status.detail}</Text>}
      </Text>
    </View>
  );
  if (!action) return body;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={status.detail ? `${status.label}, ${status.detail}` : status.label}
      hitSlop={8}
      onPress={() => {
        Haptics.selectionAsync();
        (onAction ?? runStatusAction)(action);
      }}
      style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}>
      {body}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  dot: { width: 7, height: 7, borderRadius: 3.5 },
  text: { flexShrink: 1, fontWeight: '500' },
});
