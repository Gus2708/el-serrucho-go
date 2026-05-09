import { useEffect, useState } from 'react';
import { Slot, useRouter, useSegments } from 'expo-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { Session } from '@supabase/supabase-js';
import { supabase } from '../src/lib/supabase';
import { ThemeProvider, useTheme } from '../src/theme/ThemeContext';
import * as SplashScreen from 'expo-splash-screen';
import { ActivityIndicator, View } from 'react-native';
import { 
  useFonts,
  JetBrainsMono_400Regular,
  JetBrainsMono_500Medium,
  JetBrainsMono_600SemiBold,
  JetBrainsMono_700Bold 
} from '@expo-google-fonts/jetbrains-mono';

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

import { useRealtimeSync } from '../src/hooks/useRealtimeSync';

function RealtimeInitializer({ children }: { children: React.ReactNode }) {
  useRealtimeSync();
  return <>{children}</>;
}

export default function RootLayout() {
  const [session, setSession] = useState<Session | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [failsafeActive, setFailsafeActive] = useState(false);

  // Carga de fuentes JetBrains Mono
  const [fontsLoaded, fontError] = useFonts({
    JetBrainsMono_400Regular,
    JetBrainsMono_500Medium,
    JetBrainsMono_600SemiBold,
    JetBrainsMono_700Bold,
  });

  useEffect(() => {
    if (fontError) {
      console.warn('Font loading error, falling back to system fonts:', fontError);
      // No bloqueamos la app si las fuentes fallan, pero lo logueamos.
    }
  }, [fontError]);

  useEffect(() => {
    // ── FALLSAFE GLOBAL ──
    // Si pasados 7 segundos la app no ha cargado (fuentes o auth), 
    // forzamos la entrada para que el usuario no quede bloqueado.
    const globalTimeout = setTimeout(() => {
      console.warn('App loading timeout reached (7s). Forcing ready state.');
      setFailsafeActive(true);
    }, 7000);

    // ── INICIALIZACIÓN AUTH ──
    supabase.auth.getSession()
      .then(({ data }) => {
        setSession(data.session);
      })
      .catch((err) => {
        console.error('Supabase initialization error:', err);
      })
      .finally(() => {
        setAuthReady(true);
      });

    // Suscripción a cambios de auth
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, s) => {
      setSession(s);
      if (event === 'SIGNED_OUT' || event === 'SIGNED_IN') {
        queryClient.clear();
      }
    });

    return () => {
      clearTimeout(globalTimeout);
      subscription.unsubscribe();
    };
  }, []);

  // La app está lista si:
  // 1. Auth está listo Y las fuentes están listas.
  // 2. O si el failsafe se activó (evita muerte por splash).
  const isAppReady = failsafeActive || (authReady && (fontsLoaded || !!fontError));

  useEffect(() => {
    if (isAppReady) {
      // Pequeño delay para asegurar que el frame se renderice antes de ocultar
      const h = setTimeout(() => {
        SplashScreen.hideAsync().catch(() => {
          /* ignorar errores */
        });
      }, 50);
      return () => clearTimeout(h);
    }
  }, [isAppReady]);

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <QueryClientProvider client={queryClient}>
        <RealtimeInitializer>
          <ThemeProvider>
            <AuthGuard session={session} ready={isAppReady} />
          </ThemeProvider>
        </RealtimeInitializer>
      </QueryClientProvider>
    </GestureHandlerRootView>
  );
}

