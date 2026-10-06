import { SymbolView, type AndroidSymbol, type SFSymbol } from 'expo-symbols';
import { Platform, type ColorValue } from 'react-native';

type Props = {
  /** SF Symbol name (iOS). */
  sf: string;
  /** Material Symbol name (Android/web). Without one, nothing is drawn there rather than a placeholder dot. */
  md?: string;
  size?: number;
  color?: ColorValue;
  weight?: 'regular' | 'medium' | 'semibold' | 'bold';
};

export function Icon({ sf, md, size = 20, color, weight = 'regular' }: Props) {
  if (!md && Platform.OS !== 'ios') return null;
  return (
    <SymbolView
      name={{ ios: sf as SFSymbol, android: (md ?? 'circle') as AndroidSymbol, web: (md ?? 'circle') as AndroidSymbol }}
      size={size}
      tintColor={color}
      weight={weight}
      style={{ width: size, height: size }}
    />
  );
}
