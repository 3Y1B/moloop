import { SymbolView, type AndroidSymbol, type SFSymbol } from 'expo-symbols';
import type { ColorValue } from 'react-native';

type Props = {
  /** SF Symbol name (iOS). */
  sf: string;
  /** Material Symbol name (Android/web). Defaults to a neutral dot. */
  md?: string;
  size?: number;
  color?: ColorValue;
  weight?: 'regular' | 'medium' | 'semibold' | 'bold';
};

export function Icon({ sf, md = 'circle', size = 20, color, weight = 'regular' }: Props) {
  return (
    <SymbolView
      name={{ ios: sf as SFSymbol, android: md as AndroidSymbol, web: md as AndroidSymbol }}
      size={size}
      tintColor={color}
      weight={weight}
      style={{ width: size, height: size }}
    />
  );
}
