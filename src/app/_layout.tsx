import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';

import { AnimatedSplashOverlay } from '@/components/animated-icon';
import { Colors } from '@/constants/theme';
import { RepoProvider } from '@/data/provider';
import { useThemeName } from '@/hooks/use-theme';

SplashScreen.preventAutoHideAsync();

const NAV_THEME = {
  light: { ...DefaultTheme, colors: { ...DefaultTheme.colors, background: Colors.light.background, primary: Colors.light.tint } },
  dark: { ...DarkTheme, colors: { ...DarkTheme.colors, background: Colors.dark.background, primary: Colors.dark.tint } },
};

export default function RootLayout() {
  const scheme = useThemeName();
  return (
    <ThemeProvider value={NAV_THEME[scheme]}>
      <RepoProvider>
        <AnimatedSplashOverlay />
        <Stack>
          <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
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
          <Stack.Screen
            name="dev"
            options={{
              title: 'Demo controls',
              presentation: 'formSheet',
              sheetAllowedDetents: [0.7, 1],
              sheetGrabberVisible: true,
              headerShown: false,
            }}
          />
        </Stack>
      </RepoProvider>
    </ThemeProvider>
  );
}
