import React, { useEffect, useState } from 'react';
import { Slot } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { useFonts, Inter_400Regular, Inter_500Medium, Inter_600SemiBold } from '@expo-google-fonts/inter';
import { ZenKakuGothicNew_500Medium, ZenKakuGothicNew_700Bold } from '@expo-google-fonts/zen-kaku-gothic-new';
import { SessionProvider, useSession } from '@/session/SessionProvider';
import { ThemeProvider } from '@/theme/ThemeProvider';
import { loadSavedLanguage, useLanguage } from '@/i18n';

SplashScreen.preventAutoHideAsync().catch(() => {});

/** El acento del tema es el color del dojo activo */
function ThemedApp() {
  const { dojo } = useSession();
  useLanguage(); // re-render al cambiar idioma
  return (
    <ThemeProvider accent={dojo?.color_primary}>
      <StatusBar style="dark" />
      <Slot />
    </ThemeProvider>
  );
}

export default function RootLayout() {
  const [fontsLoaded] = useFonts({
    Inter_400Regular, Inter_500Medium, Inter_600SemiBold, ZenKakuGothicNew_500Medium, ZenKakuGothicNew_700Bold,
  });
  const [langLoaded, setLangLoaded] = useState(false);

  useEffect(() => { loadSavedLanguage().finally(() => setLangLoaded(true)); }, []);
  useEffect(() => { if (fontsLoaded && langLoaded) SplashScreen.hideAsync().catch(() => {}); }, [fontsLoaded, langLoaded]);

  if (!fontsLoaded || !langLoaded) return null;
  return (
    <SafeAreaProvider>
      <SessionProvider>
        <ThemedApp />
      </SessionProvider>
    </SafeAreaProvider>
  );
}
