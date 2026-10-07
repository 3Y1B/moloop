import { View } from 'react-native';

import { LogLine, type LogIcon } from '@/components/task/task-log';
import type { GuestThreadEntry } from '@/lib/schema';
import { useTheme } from '@/hooks/use-theme';

const WHO: Record<GuestThreadEntry['from'], string> = { guest: 'You', ai: 'Moloop', staff: 'Staff' };

/** What was said, by whom, oldest first: the same rail the crew's log uses, so a task reads alike on every phone. */
export function Thread({ entries }: { entries: GuestThreadEntry[] }) {
  const theme = useTheme();
  const icon: Record<GuestThreadEntry['from'], LogIcon> = {
    guest: { sf: 'person.fill', md: 'person', color: theme.text },
    ai: { sf: 'sparkles', md: 'auto_awesome' },
    staff: { sf: 'person.crop.circle.badge.checkmark', md: 'person_check', color: theme.tint },
  };
  return (
    <View>
      {entries.map((e, i) => (
        <LogLine
          key={`${e.at}-${i}`}
          entry={{ id: `${e.at}-${i}`, at: e.at, who: e.name ?? WHO[e.from], text: e.text, quote: true, icon: icon[e.from] }}
          last={i === entries.length - 1}
        />
      ))}
    </View>
  );
}
