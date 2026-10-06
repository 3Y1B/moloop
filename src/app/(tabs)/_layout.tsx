import { TabList, TabSlot, TabTrigger, Tabs } from 'expo-router/ui';

import { TabBar } from '@/components/tab-bar';
import { useInbox } from '@/data/hooks';

export default function TabsLayout() {
  const { unread } = useInbox();
  return (
    <Tabs>
      <TabSlot />
      {/* Declares the routes; the visible bar is TabBar. */}
      <TabList style={{ display: 'none' }}>
        <TabTrigger name="task" href="/" />
        <TabTrigger name="talk" href="/talk" />
        <TabTrigger name="inbox" href="/inbox" />
      </TabList>
      <TabBar
        items={[
          { name: 'task', label: 'My task', sf: 'checklist', sfSelected: 'checklist', md: 'task_alt' },
          { name: 'talk', label: 'Talk', sf: 'mic', sfSelected: 'mic.fill', md: 'mic' },
          { name: 'inbox', label: 'Inbox', sf: 'tray', sfSelected: 'tray.fill', md: 'inbox', badge: unread },
        ]}
      />
    </Tabs>
  );
}
