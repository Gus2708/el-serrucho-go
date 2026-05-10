import { useEffect, useState } from 'react';
import { Slot, useRouter, useSegments } from 'expo-router';

// Web only: remove input focus outline
if (typeof window !== 'undefined') {
  require('./global.css');
}
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { Session } from '@supabase/supabase-js';
import { supabase } from '../src/lib/supabase';
import { ThemeProvider, useTheme } from '../src/theme/ThemeContext';
import * as Font from 'expo-font';
import * as SplashScreen from 'expo-splash-screen';
import { ActivityIndicator, Platform, View, useWindowDimensions } from 'react-native';
// SplashScreen is a no-op on web
if (Platform.OS !== 'web') {
  SplashScreen.preventAutoHideAsync().catch(() => {});
}

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, staleTime: 30_000 },
  },
});

import { useUserRole } from '../src/hooks/useUserRole';

function AuthGuard({ session, ready }: { session: Session | null; ready: boolean }) {
  const segments = useSegments();
  const router   = useRouter();
  const { colors } = useTheme();
  const { data: roleData, isLoading: roleLoading } = useUserRole();

  useEffect(() => {
    // Si no estamos listos (fuentes/auth), no hacemos nada
    if (!ready) return;
    
    const inAuth = segments[0] === '(auth)';
    const isRoot = segments.length < 1;
    const isPending = segments[1] === 'pending';

    if (!session) {
      // Caso 1: No hay sesión -> Mandar a login si no está ahí
      if (!inAuth) {
        router.replace('/(auth)/login');
      }
    } else {
      // Caso 2: Hay sesión pero estamos cargando el rol
      if (roleLoading) return;

      // Caso 3: Hay sesión y rol cargado
      if (roleData) {
        if (!roleData.is_active) {
          // Usuario no activo -> Mandar a pantalla de espera
          if (!isPending) {
            router.replace('/(auth)/pending');
          }
        } else {
          // Usuario activo -> Si está en auth, mandarlo a los tabs
          if (inAuth || isRoot) {
            router.replace('/(tabs)');
          }
        }
      }
    }
  }, [session, ready, segments, roleData, roleLoading]);

  // Pantalla de carga mientras se decide el destino
  if (!ready || (session && roleLoading)) {
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
  const { width: windowWidth } = useWindowDimensions();
  const isDesktop = Platform.OS === 'web' && windowWidth >= 768;

  // Carga de fuentes JetBrains Mono Locales (Máxima performance)
  const [fontsLoaded, fontError] = Font.useFonts({
    'JetBrainsMono_400Regular': require('../assets/fonts/JetBrainsMono_400Regular.ttf'),
    'JetBrainsMono_500Medium':  require('../assets/fonts/JetBrainsMono_500Medium.ttf'),
    'JetBrainsMono_600SemiBold': require('../assets/fonts/JetBrainsMono_600SemiBold.ttf'),
    'JetBrainsMono_700Bold':     require('../assets/fonts/JetBrainsMono_700Bold.ttf'),
  });

  useEffect(() => {
    if (fontError) {
      console.warn('Error cargando fuentes locales:', fontError);
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

  // Sincronización de sesión para evitar cuentas compartidas
  const [lastSyncedSid, setLastSyncedSid] = useState<string | null>(null);

  useEffect(() => {
    const currentSid = session?.access_token;
    if (session?.user && currentSid && currentSid !== lastSyncedSid) {
      (async () => {
        try {
          const { error } = await supabase.rpc('sync_session');
          if (error) {
            if (!error.message.includes('No session found in JWT')) {
              console.error('Error sincronizando sesión:', error.message);
            }
          } else {
            setLastSyncedSid(currentSid);
          }
        } catch { /* ignorar fallos de red */ }
      })();
    }
  }, [session, lastSyncedSid]);

  // La app está lista si:
  // 1. Auth está listo Y las fuentes están listas.
  // 2. O si el failsafe se activó (evita muerte por splash).
  const isAppReady = failsafeActive || (authReady && (fontsLoaded || !!fontError));

  useEffect(() => {
    if (!isAppReady) {
      console.log(`[Boot] Waiting for: ${!authReady ? 'Auth ' : ''}${(!fontsLoaded && !fontError) ? 'Fonts' : ''}`);
    } else {
      console.log('[Boot] App Ready!');
    }
  }, [authReady, fontsLoaded, fontError, failsafeActive]);

  useEffect(() => {
    if (isAppReady) {
      // Pequeño delay para asegurar que el frame se renderice antes de ocultar
      const h = setTimeout(() => {
        if (Platform.OS !== 'web') {
          SplashScreen.hideAsync().catch(() => {});
        }
      }, 50);
      return () => clearTimeout(h);
    }
  }, [isAppReady]);

  const inner = (
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

  if (Platform.OS === 'web') {
    // Desktop: full viewport with dark background so the area beyond
    // CONTENT_MAX_WIDTH does not flash white
    if (isDesktop) {
      return (
        <View style={{ flex: 1, backgroundColor: '#0C0C0C' }}>
          {inner}
        </View>
      );
    }

    // Mobile browser: center a 480px column (looks like the native app)
    return (
      <View style={{ flex: 1, backgroundColor: '#0C0C0C', alignItems: 'center' }}>
        <View style={{ flex: 1, width: '100%', maxWidth: 480 }}>
          {inner}
        </View>
      </View>
    );
  }

  return inner;
}

