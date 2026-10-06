import { Link } from 'expo-router';
import { Pressable } from 'react-native';

import { Icon } from '@/components/ui/icon';
import { useRepo } from '@/data/hooks';
import { useTheme } from '@/hooks/use-theme';

/** Header button to the demo controls sheet. Hidden when the Repo has no dev controls. */
export function DevButton() {
  const repo = useRepo();
  const theme = useTheme();
  if (!repo.dev) return null;
  return (
    <Link href="/dev" asChild>
      <Pressable accessibilityLabel="Demo controls" hitSlop={10} style={{ padding: 6 }}>
        <Icon sf="slider.horizontal.3" md="tune" size={20} color={theme.tint} />
      </Pressable>
    </Link>
  );
}
