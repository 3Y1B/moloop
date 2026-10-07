import { router } from 'expo-router';
import { createContext, useContext } from 'react';

import { DemoButton } from '@/components/demo-panel';
import { DutyChip } from '@/components/duty-header';
import { MapButton } from '@/components/map/map-button';
import { TopBar } from '@/components/ui/top-bar';
import { useInbox } from '@/data/hooks';

/** Whether Mo's shift details are open, shared by the bar on every tab. Provided by the (mo) layout. */
export const MoDuty = createContext<{ open: boolean; toggle: () => void }>({ open: false, toggle: () => {} });

/**
 * Over every tab: Mo's shift on the left, the inbox on the right. Flat on a list; over the map it floats, exactly
 * as on the staff map.
 */
export function MoTopBar({ overMap = false }: { overMap?: boolean }) {
  const duty = useContext(MoDuty);
  const { unread } = useInbox();
  const flat = !overMap;
  return (
    <TopBar
      variant={overMap ? 'floating' : 'flat'}
      left={<DutyChip open={duty.open} onToggle={duty.toggle} flat={flat} />}
      right={
        <>
          <DemoButton flat={flat} />
          <MapButton label="Inbox" sf="tray" md="inbox" badge={unread} flat={flat} onPress={() => router.push('/inbox')} />
        </>
      }
    />
  );
}
