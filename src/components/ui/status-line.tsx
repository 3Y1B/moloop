import { router } from 'expo-router';
import type { ReactNode } from 'react';
import { Linking, Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';

import { Type } from '@/constants/theme';
import type { Status, StatusAction, Tone } from '@/lib/status';
import { useTheme } from '@/hooks/use-theme';
import { Dot } from './dot';
import { haptic, pressedStyle } from './pressable';

/** Default for a tappable status: check-ins open the reply sheet, calls open the dialer. */
export function runStatusAction(action: StatusAction) {
  if (action.kind === 'update') router.push({ pathname: '/reply/[id]', params: { id: action.taskId, kind: 'still_on_it' } });
  else Linking.openURL(`tel:${action.phone.replace(/\s+/g, '')}`);
}

/**
 * The one way a status from `lib/status` is drawn: tone dot, label, then the detail in a quieter tone. Tappable when
 * it has an action. `dot={false}` is the label alone in its tone (a teammate's row). `trailing` sits after it ("4m ago",
 * a countdown); a string is drawn quiet.
 */
export function StatusLine({ status, onAction, size = 'footnote', dot = true, trailing, style }: {
  status: Status;
  /** Overrides the default action handling. */
  onAction?: (action: StatusAction) => void;
  size?: 'footnote' | 'callout' | 'body';
  dot?: boolean;
  trailing?: ReactNode;
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
      {dot && <Dot color={c} size={7} />}
      <Text style={[styles.text, { fontSize, fontWeight: dot ? '500' : '400' }]} numberOfLines={1}>
        <Text style={{ color: status.tone === 'neutral' ? theme.textSecondary : c, fontWeight: dot ? '600' : undefined }}>
          {status.label}
        </Text>
        {status.detail && <Text style={{ color: theme.textSecondary }}> · {status.detail}</Text>}
      </Text>
      {typeof trailing === 'string' || typeof trailing === 'number' ? (
        <Text style={[styles.trailing, { fontSize, color: theme.textTertiary }]} numberOfLines={1}>{trailing}</Text>
      ) : (
        trailing
      )}
    </View>
  );
  if (!action) return body;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={status.detail ? `${status.label}, ${status.detail}` : status.label}
      hitSlop={8}
      onPress={() => {
        haptic('selection');
        (onAction ?? runStatusAction)(action);
      }}
      style={({ pressed }) => pressedStyle(pressed)}>
      {body}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  text: { flexShrink: 1 },
  trailing: { marginLeft: 'auto', fontVariant: ['tabular-nums'] },
});
