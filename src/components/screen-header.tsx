import type { Href } from 'expo-router';
import type { ReactNode } from 'react';

import { Icon } from '@/components/ui/icon';
import { PressableOpacity } from '@/components/ui/pressable';
import { TopBar } from '@/components/ui/top-bar';
import { useTheme } from '@/hooks/use-theme';
import { goBack } from '@/lib/navigation';

/**
 * Compact in-app header: back chevron, centred title, optional trailing action.
 * Drawn by us instead of the native navigation bar so it looks the same on every platform.
 */
export function ScreenHeader({ title, back = false, backFallback, right }: {
  title: string;
  back?: boolean;
  backFallback?: Href;
  right?: ReactNode;
}) {
  const theme = useTheme();
  return (
    <TopBar
      title={title}
      left={
        back && (
          <PressableOpacity accessibilityRole="button" accessibilityLabel="Back" hitSlop={12} onPress={() => goBack(backFallback)}>
            <Icon sf="chevron.left" md="chevron_left" size={18} color={theme.text} weight="medium" />
          </PressableOpacity>
        )
      }
      right={right}
    />
  );
}
