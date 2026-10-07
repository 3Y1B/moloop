import * as Haptics from 'expo-haptics';
import { Pressable, type PressableProps, type PressableStateCallbackType, type StyleProp, type ViewStyle } from 'react-native';

export type HapticKind = 'selection' | 'light' | 'medium' | 'heavy' | 'success' | 'warning' | 'error' | 'none';

/** One opacity for every pressed control. */
export const PRESSED_OPACITY = 0.6;

/** The pressed look, for a Pressable's style callback: `style={({ pressed }) => [styles.x, pressedStyle(pressed)]}`. */
export function pressedStyle(pressed: boolean): ViewStyle | undefined {
  return pressed ? { opacity: PRESSED_OPACITY } : undefined;
}

/** A tap's feel. `selection` for picks and toggles, `light` for actions, `success`/`warning`/`error` for outcomes. */
export function haptic(kind: HapticKind) {
  switch (kind) {
    case 'selection': return void Haptics.selectionAsync();
    case 'light': return void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    case 'medium': return void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    case 'heavy': return void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
    case 'success': return void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    case 'warning': return void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
    case 'error': return void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
  }
}

/** Pressable that dims while pressed, with an optional haptic on press. */
export function PressableOpacity({ haptic: kind = 'none', onPress, style, ...rest }: Omit<PressableProps, 'style'> & {
  haptic?: HapticKind;
  style?: StyleProp<ViewStyle> | ((state: PressableStateCallbackType) => StyleProp<ViewStyle>);
}) {
  return (
    <Pressable
      onPress={
        onPress &&
        ((e) => {
          haptic(kind);
          onPress(e);
        })
      }
      style={(state) => [typeof style === 'function' ? style(state) : style, pressedStyle(state.pressed)]}
      {...rest}
    />
  );
}
