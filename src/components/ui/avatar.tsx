import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';

import { Type } from '@/constants/theme';
import { initials } from '@/lib/format';
import { useTheme } from '@/hooks/use-theme';

/** Initials on a team-coloured disc, with an optional status dot (on duty, help, …). */
export function Avatar({ name, color, size = 30, dot, style }: {
  name: string;
  /** Usually the team colour. Defaults to the accent. */
  color?: string;
  size?: number;
  /** Colour of the small dot bottom-right. None when omitted. */
  dot?: string;
  style?: StyleProp<ViewStyle>;
}) {
  const theme = useTheme();
  const d = Math.max(8, Math.round(size / 3));
  return (
    <View style={[styles.avatar, { width: size, height: size, borderRadius: size / 2, backgroundColor: color ?? theme.tint }, style]}>
      <Text style={[styles.text, { fontSize: size >= 30 ? Math.round(size * 0.4) : Type.caption - 2 }]}>{initials(name)}</Text>
      {dot && <View style={[styles.dot, { width: d, height: d, borderRadius: d / 2, backgroundColor: dot, borderColor: theme.card }]} />}
    </View>
  );
}

const styles = StyleSheet.create({
  avatar: { alignItems: 'center', justifyContent: 'center' },
  text: { color: '#fff', fontWeight: '600' },
  dot: { position: 'absolute', right: -1, bottom: -1, borderWidth: 2 },
});
