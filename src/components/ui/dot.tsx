import { View, type StyleProp, type ViewStyle } from 'react-native';

/** A small round dot: a status tone, unread, a map key. */
export function Dot({ color, size = 8, style }: { color: string; size?: number; style?: StyleProp<ViewStyle> }) {
  return <View style={[{ width: size, height: size, borderRadius: size / 2, backgroundColor: color }, style]} />;
}
