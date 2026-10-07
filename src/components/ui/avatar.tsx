import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';

import { Type } from '@/constants/theme';
import { initials } from '@/lib/format';
import { useTheme } from '@/hooks/use-theme';

/**
 * Initials on a neutral disc, with an optional status dot (on duty, help, …). Colour only ever carries meaning, via the
 * dot. `placeholder` (or no name) is a quiet "?" for nobody yet.
 */
export function Avatar({ name, size = 30, dot, placeholder, style }: {
  name?: string;
  /** @deprecated Ignored: avatars are neutral so the one accent stays the only colour. */
  color?: string;
  size?: number;
  /** Colour of the small dot bottom-right. None when omitted. */
  dot?: string;
  placeholder?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const theme = useTheme();
  const d = Math.max(8, Math.round(size / 3));
  const empty = placeholder || !name;
  return (
    <View style={[styles.avatar, { width: size, height: size, borderRadius: size / 2, backgroundColor: theme.backgroundElement }, style]}>
      <Text style={[styles.text, { color: empty ? theme.textTertiary : theme.text, fontSize: size >= 30 ? Math.round(size * 0.4) : Type.caption - 2 }]}>
        {empty ? '?' : initials(name)}
      </Text>
      {dot && <View style={[styles.dot, { width: d, height: d, borderRadius: d / 2, backgroundColor: dot, borderColor: theme.card }]} />}
    </View>
  );
}

const styles = StyleSheet.create({
  avatar: { alignItems: 'center', justifyContent: 'center' },
  text: { fontWeight: '600' },
  dot: { position: 'absolute', right: -1, bottom: -1, borderWidth: 2 },
});
