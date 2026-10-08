import { createAvatar } from '@dicebear/core';
import * as notionists from '@dicebear/notionists';
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { SvgXml } from 'react-native-svg';

import { Colors, Type } from '@/constants/theme';
import { initials } from '@/lib/format';
import { useTheme } from '@/hooks/use-theme';

/**
 * A face (`face`, from Volunteer.avatar) or initials on a neutral disc, with an optional status dot (on duty, help, …).
 * Colour only ever carries meaning, via the dot. `placeholder` (or no name) is a quiet "?" for nobody yet.
 */
export function Avatar({ name, face, size = 30, dot, placeholder, style }: {
  name?: string;
  /** DiceBear notionists options as a query string ("seed=priya.shah&beardProbability=0"). Initials when absent. */
  face?: string | null;
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
  const svg = !placeholder && face ? drawn(face) : null;
  const disc = { width: size, height: size, borderRadius: size / 2 };
  return (
    <View style={[styles.avatar, disc, { backgroundColor: theme.backgroundElement }, style]}>
      {svg ? (
        // The line art is black, so it keeps a light disc in the dark too.
        <View style={[styles.face, disc]}>
          <SvgXml xml={svg} width={size} height={size} />
        </View>
      ) : (
        <Text style={[styles.text, { color: empty ? theme.textTertiary : theme.text, fontSize: size >= 30 ? Math.round(size * 0.4) : Type.caption - 2 }]}>
          {empty ? '?' : initials(name)}
        </Text>
      )}
      {dot && <View style={[styles.dot, { width: d, height: d, borderRadius: d / 2, backgroundColor: dot, borderColor: theme.card }]} />}
    </View>
  );
}

const faces = new Map<string, string>();

/** The face's SVG, drawn once per set of options. */
function drawn(face: string) {
  let svg = faces.get(face);
  if (!svg) {
    const opts: Record<string, string | number | string[]> = {};
    for (const pair of face.split('&')) {
      const [key, value = ''] = pair.split('=').map(decodeURIComponent);
      opts[key] = key === 'seed' ? value : key.endsWith('Probability') ? Number(value) : value.split(',');
    }
    // Head and shoulders, so the face reads at list size.
    svg = createAvatar(notionists, { gestureProbability: 0, ...opts, scale: 115, translateY: 6, randomizeIds: true }).toString();
    faces.set(face, svg);
  }
  return svg;
}

const styles = StyleSheet.create({
  avatar: { alignItems: 'center', justifyContent: 'center' },
  face: { overflow: 'hidden', backgroundColor: Colors.light.backgroundElement },
  text: { fontWeight: '600' },
  dot: { position: 'absolute', right: -1, bottom: -1, borderWidth: 2 },
});
