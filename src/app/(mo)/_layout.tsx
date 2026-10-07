import { Redirect, Tabs } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useSpokenBriefs } from '@/components/voice/use-spoken-briefs';
import { DutyPanel } from '@/components/duty-header';
import { MAP_BUTTON } from '@/components/map/map-button';
import { MoMap } from '@/components/mo/mo-map';
import { MoDuty, MoTopBar } from '@/components/mo/mo-top-bar';
import { Icon } from '@/components/ui/icon';
import { useNeedsMe, useRole, useSnapshot } from '@/data/hooks';
import { useTheme } from '@/hooks/use-theme';
import { homeFor } from '@/lib/home';
import { moLayout, type MoTab } from '@/lib/mo-layout';

const TABS: { name: MoTab; title: string; sf: string; md: string }[] = [
  { name: 'index', title: 'Needs action', sf: 'exclamationmark.bubble', md: 'notification_important' },
  { name: 'tasks', title: 'Tasks', sf: 'list.bullet.rectangle', md: 'list_alt' },
  { name: 'crew', title: 'Crew', sf: 'person.3', md: 'groups' },
  { name: 'map', title: 'Map', sf: 'map', md: 'map' },
];

/** The left column's width on a laptop; the map takes the rest. */
const COLUMN = 420;

/**
 * Mo's console: tabs of lists on a phone. On a laptop the tabs keep to a left column and the map stays on screen
 * beside them, mounted once for the whole session. Everyone else is sent to their own app.
 */
export default function MoLayout() {
  const theme = useTheme();
  const s = useSnapshot();
  const home = homeFor(useRole());
  const { width } = useWindowDimensions();
  const { split, tabs } = moLayout(width);
  const insets = useSafeAreaInsets();
  const needs = useNeedsMe();
  const [open, setOpen] = useState(false);
  const duty = { open, toggle: () => setOpen((o) => !o) };
  useSpokenBriefs();

  if (!s.meId) return s.status === 'ready' ? <Redirect href="/sign-in" /> : null;
  if (home && home !== '(mo)') return <Redirect href={`/${home}`} />;

  return (
    <MoDuty.Provider value={duty}>
      <View style={[styles.screen, { backgroundColor: theme.background }]}>
        <View style={split ? [styles.column, { borderRightColor: theme.border }] : styles.fill}>
          <Tabs
            screenOptions={{
              header: () => <MoTopBar />,
              tabBarActiveTintColor: theme.tint,
              tabBarInactiveTintColor: theme.textSecondary,
              tabBarStyle: { backgroundColor: theme.background, borderTopColor: theme.border },
              tabBarLabelStyle: styles.label,
              tabBarBadgeStyle: { backgroundColor: theme.danger, color: theme.onTint },
            }}>
            {TABS.map((t) => (
              <Tabs.Screen
                key={t.name}
                name={t.name}
                options={{
                  title: t.title,
                  tabBarBadge: t.name === 'index' && needs.length > 0 ? needs.length : undefined,
                  // The map draws its own bar, floating over it.
                  headerShown: t.name !== 'map',
                  // On a laptop the map is beside the column, not a tab.
                  href: tabs.includes(t.name) ? undefined : null,
                  tabBarIcon: ({ color }) => <Icon sf={t.sf} md={t.md} size={22} color={color} />,
                }}
              />
            ))}
          </Tabs>
        </View>
        {split && <MoMap style={styles.fill} />}

        {open && (
          <>
            {/* Tap anywhere outside the panel to close it. */}
            <Pressable accessibilityLabel="Close shift details" style={StyleSheet.absoluteFill} onPress={() => setOpen(false)} />
            <DutyPanel style={[styles.duty, { top: insets.top + 8 + MAP_BUTTON + 8 }, split && { width: COLUMN - 32 }]} />
          </>
        )}
      </View>
    </MoDuty.Provider>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, flexDirection: 'row' },
  fill: { flex: 1 },
  column: { width: COLUMN, borderRightWidth: StyleSheet.hairlineWidth },
  label: { fontWeight: '600' },
  duty: { position: 'absolute', left: 16, right: 16 },
});
