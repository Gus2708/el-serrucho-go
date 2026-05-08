import { useEffect, useState } from 'react';
import { Slot, useRouter, useSegments } from 'expo-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { Session } from '@supabase/supabase-js';
import { supabase } from '../src/lib/supabase';
import { ThemeProvider, useTheme } from '../src/theme/ThemeContext';
import * as SplashScreen from 'expo-splash-screen';
import { ActivityIndicator, View } from 'react-native';
// Las fuentes JetBrainsMono se bundlean como recurso nativo via el plugin
// `expo-font` en app.json — el sistema operativo las tiene listas antes de
// que JS arranque, así que NO necesitamos useFonts() ni esperar nada async.

// Mantener el splash screen visible hasta que la app esté lista
SplashScreen.preventAutoHideAsync().catch(() => {
  /* ignorar errores de re-prevent */
});

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, staleTime: 30_000 },
  },
});

function AuthGuard({ session, ready }: { session: Session | null; ready: boolean }) {
  const segments = useSegments();
  const router   = useRouter();
  const { colors } = useTheme();

  useEffect(() => {
    if (!ready) return;
    
    const inAuth = segments[0] === '(auth)';
    const isRoot = segments.length < 1;

    if (!session) {
      if (!inAuth) {
        router.replace('/(auth)/login');
      }
    } else {
      if (inAuth || isRoot) {
        router.replace('/(tabs)');
      }
    }
  }, [session, ready, segments]);

  if (!ready) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.bg, justifyContent: 'center', alignItems: 'center' }}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  return <Slot />;
}

export default function RootLayout() {
  const [session, setSession] = useState<Session | null>(null);
  const [authReady, setAuthReady] = useState(false);

  useEffect(() => {
    // Failsafe: si Supabase tarda demasiado en responder a getSession()
    // (red lenta, DNS, etc.) abrir igual a los 5 s y dejar que la app
    // muestre el login. Sin esto el splash quedaba colgado indefinidamente.
    const failsafe = setTimeout(() => setAuthReady(true), 5000);

    supabase.auth.getSession()
      .then(({ data }) => {
        setSession(data.session);
      })
      .catch((err) => {
        console.error('Supabase initialization error:', err);
      })
      .finally(() => {
        clearTimeout(failsafe);
        setAuthReady(true);
      });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, s) => {
      setSession(s);
      if (event === 'SIGNED_OUT' || event === 'SIGNED_IN') {
        queryClient.clear();
      }
    });

    return () => {
      clearTimeout(failsafe);
      subscription.unsubscribe();
    };
  }, []);

  const isAppReady = authReady;

  useEffect(() => {
    if (isAppReady) {
      SplashScreen.hideAsync().catch(() => {
        /* ignorar errores de ocultación */
      });
    }
  }, [isAppReady]);

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <QueryClientProvider client={queryClient}>
        <ThemeProvider>
          <AuthGuard session={session} ready={isAppReady} />
        </ThemeProvider>
      </QueryClientProvider>
    </GestureHandlerRootView>
  );
}
