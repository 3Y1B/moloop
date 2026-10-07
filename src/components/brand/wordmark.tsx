import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';

import { Brand } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { LoopMark } from './loop-mark';

type Props = {
  /** Font size of the letters; the loop scales with it. */
  size?: number;
  /** Run the highlight round the loop. It's the busy indicator wherever the wordmark is on screen. */
  spin?: boolean;
  /** Draw the loop in on mount. */
  draw?: boolean;
  style?: StyleProp<ViewStyle>;
};

/**
 * "moloop" set in type with the loop mark standing in for its "oo".
 * Letters in `text`, the loop in `tint` with its highlight in brand mist, as on the icon.
 */
export function Wordmark({ size = 84, spin = false, draw = false, style }: Props) {
  const theme = useTheme();
  // No lineHeight: anything tighter than the font's own clips the letters on iOS, and the "p" loses its tail.
  const word = [styles.word, { color: theme.text, fontSize: size, letterSpacing: -size * 0.04 }];

  return (
    <View
      accessible
      accessibilityRole="header"
      accessibilityLabel="moloop"
      style={[styles.row, style]}>
      <Text style={word}>mol</Text>
      {/* Sits on the x-height band, as the "oo" would: the row ends at the descender, about 0.24em below the baseline. */}
      <View style={{ marginBottom: size * 0.23, marginHorizontal: size * 0.02 }}>
        <LoopMark
          width={size * 0.92}
          color={theme.tint}
          sparkColor={Brand.mist}
          spin={spin}
          draw={draw}
          lap={1500}
        />
      </View>
      <Text style={word}>p</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'flex-end' },
  word: { fontWeight: '700', includeFontPadding: false },
});
