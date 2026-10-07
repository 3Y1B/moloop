import { useAnimatedKeyboard, useAnimatedStyle } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

/**
 * Animated style that lifts something pinned to the bottom above the keyboard, less the home-indicator inset it
 * already clears. Put it on an Animated.View.
 */
export function useKeyboardLift() {
  const insets = useSafeAreaInsets();
  const keyboard = useAnimatedKeyboard();
  return useAnimatedStyle(() => ({
    transform: [{ translateY: -Math.max(0, keyboard.height.get() - insets.bottom) }],
  }));
}
