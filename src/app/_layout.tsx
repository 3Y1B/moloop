import * as Notifications from 'expo-notifications';
import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { Platform, StyleSheet } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import { AnimatedSplashOverlay } from '@/components/animated-icon';
import { DemoOverlay } from '@/components/demo-panel';
import { FinderPrompt } from '@/components/finder/finder-prompt';
import { LocationSharing } from '@/components/location-sharing';
import { PushNotifications } from '@/components/push-notifications';
import { Colors } from '@/constants/theme';
import { RepoProvider } from '@/data/provider';
import { useThemeName } from '@/hooks/use-theme';

SplashScreen.preventAutoHideAsync();

// A push that lands while the app is open: no banner, no sound. Realtime already shows it and the brief speaks it.
if (Platform.OS !== 'web') {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: false,
      shouldShowList: false,
      shouldPlaySound: false,
      shouldSetBadge: false,
    }),
  });
}

/** Sheets over the map: most of the screen first, drag up for the rest. */
const SHEET = {
  presentation: 'formSheet' as const,
  sheetAllowedDetents: [0.7, 1],
  sheetGrabberVisible: true,
  headerShown: false,
};

const NAV_THEME = {
  light: { ...DefaultTheme, colors: { ...DefaultTheme.colors, background: Colors.light.background, primary: Colors.light.tint } },
  dark: { ...DarkTheme, colors: { ...DarkTheme.colors, background: Colors.dark.background, primary: Colors.dark.tint } },
};

export default function RootLayout() {
  const scheme = useThemeName();
  return (
    <GestureHandlerRootView style={StyleSheet.absoluteFill}>
    <ThemeProvider value={NAV_THEME[scheme]}>
      <RepoProvider>
        <AnimatedSplashOverlay />
        <LocationSharing />
        <PushNotifications />
        {/* Every route is registered here; (mo), (staff) and (guest) redirect to each other by role, and to sign-in when nobody is. */}
        <Stack>
          <Stack.Screen name="(mo)" options={{ headerShown: false }} />
          <Stack.Screen name="(staff)" options={{ headerShown: false }} />
          <Stack.Screen name="(guest)" options={{ headerShown: false }} />
          <Stack.Screen name="sign-in" options={{ headerShown: false, animation: 'fade' }} />
          <Stack.Screen name="task/[id]" options={{ title: 'Task', headerShown: false }} />
          <Stack.Screen
            name="navigate/[id]"
            options={{ title: '', headerTransparent: true, headerShadowVisible: false, headerBackButtonDisplayMode: 'minimal' }}
          />
          <Stack.Screen
            name="reply/[id]"
            // Holding the orb must never turn into a sheet drag, or the recording gets cancelled mid-sentence.
            options={{
              presentation: 'formSheet',
              sheetAllowedDetents: [0.6, 1],
              sheetExpandsWhenScrolledToEdge: false,
              sheetGrabberVisible: true,
              headerShown: false,
            }}
          />
          {/* The finder takes the whole screen, like Apple's: nothing else to look at while you're searching. */}
          <Stack.Screen name="find/[id]" options={{ headerShown: false, presentation: 'fullScreenModal', animation: 'fade' }} />
          <Stack.Screen name="inbox" options={{ ...SHEET, title: 'Inbox' }} />
          <Stack.Screen name="respond/[id]" options={{ ...SHEET, title: 'Respond' }} />
          <Stack.Screen name="person/[id]" options={{ ...SHEET, title: 'Person' }} />
          <Stack.Screen name="assign/[id]" options={{ ...SHEET, title: 'Pick a volunteer' }} />
          <Stack.Screen name="approve/[id]" options={{ ...SHEET, sheetAllowedDetents: [0.6, 1], title: 'Approve' }} />
          <Stack.Screen name="mobilize/[id]" options={{ ...SHEET, title: "Mobilization" }} />
        </Stack>
        <FinderPrompt />
        <DemoOverlay />
      </RepoProvider>
    </ThemeProvider>
    </GestureHandlerRootView>
  );
}
