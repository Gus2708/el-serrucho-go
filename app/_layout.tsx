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
import { ActivityIndicator, Platform, View, useWindowDimensions, Text, Pressable } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
// SplashScreen is a no-op on web
if (Platform.OS !== 'web') {
  SplashScreen.preventAutoHideAsync().catch(() => {});
}

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { 
      retry: 1, 
      staleTime: 30_000,
      refetchOnWindowFocus: false, // Prevents flickering/reloading when switching windows
    },
  },
});

import { useUserRole } from '../src/hooks/useUserRole';

function AuthGuard({ session, ready }: { session: Session | null; ready: boolean }) {
  const [hardTimeout, setHardTimeout] = useState(false);
  const segments = useSegments();
  const router   = useRouter();
  const { colors } = useTheme();
  const { data: roleData, isLoading: roleLoading } = useUserRole(session?.user?.id);

  useEffect(() => {
    const timer = setTimeout(() => {
      setHardTimeout(true);
    }, 5000); // Reducido a 5s para mayor rapidez
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    // Si no estamos listos (fuentes/auth), no hacemos nada
    if (!ready) return;
    
    // Cast a string[] porque typedRoutes restringe los valores de segments al
    // enum de rutas y no permite comparar contra '' o length 0.
    const segs = segments as string[];
    const inAuth = segs[0] === '(auth)';
    const isRoot = segs.length === 0;
    // Expo Router can sometimes represent index as [''] or []
    const isIndex = segs.length === 1 && segs[0] === '';

    if (!session) {
      // Case 1: No session -> Mandar a login si no está ahí
      if (!inAuth) {
        router.replace('/(auth)/login');
      }
    } else {
      // Case 2: Hay sesión pero estamos cargando el rol (con margen de 10s)
      if (roleLoading && !hardTimeout) return;

      // Case 3: Hay sesión y rol cargado
      if (roleData) {
        if (!roleData.is_active) {
          // Usuario no activo -> Mandar a pantalla de espera
          if (segs[segs.length - 1] !== 'pending') {
            router.replace('/(auth)/pending');
          }
        } else {
          // Usuario activo -> Solo redireccionar si está en auth o en la raíz absoluta
          if (inAuth || isRoot || isIndex) {
            router.replace('/(tabs)');
          }
        }
      }
    }
  }, [session, ready, segments, roleData, roleLoading]);

  // Pantalla de carga mientras se decide el destino
  // El hardTimeout asegura que si el rol tarda más de 5s, pasamos igual
  if (!ready || (session && roleLoading && !hardTimeout)) {
    return (
      <View style={{ flex: 1, backgroundColor: colors?.bg || '#010100', justifyContent: 'center', alignItems: 'center', padding: 20 }}>
        <ActivityIndicator size="large" color={colors?.primary || '#fbbf24'} />
        {hardTimeout && (
          <Pressable 
            onPress={() => {
              if (Platform.OS === 'web') window.location.reload();
            }}
            style={{ marginTop: 20, padding: 10, backgroundColor: colors?.surface || '#111', borderRadius: 8, borderWidth: 1, borderColor: colors?.border || '#333' }}
          >
            <Text style={{ color: colors?.primary || '#fbbf24', fontSize: 14 }}>Recargar aplicación</Text>
          </Pressable>
        )}
      </View>
    );
  }

  return <Slot />;
}

import { useRealtimeSync } from '../src/hooks/useRealtimeSync';
import { useSessionEnforcer } from '../src/hooks/useSessionEnforcer';

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
    // Si pasados 2.5 segundos la app no ha cargado (fuentes o auth), 
    // forzamos la entrada para que el usuario no quede bloqueado.
    const globalTimeout = setTimeout(() => {
      setFailsafeActive(true);
      setAuthReady(true); // También forzamos authReady
    }, 2500);

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
      
      // Al entrar o recuperar sesión, invalidamos solo lo relacionado con auth
      // para que AuthGuard y useUserRole obtengan datos frescos inmediatamente.
      if (event === 'SIGNED_IN' || event === 'INITIAL_SESSION') {
        queryClient.invalidateQueries({ queryKey: ['auth-session'] });
        queryClient.invalidateQueries({ queryKey: ['user-role'] });
      } else if (event === 'SIGNED_OUT') {
        queryClient.clear();
      }
    });

    return () => {
      clearTimeout(globalTimeout);
      subscription.unsubscribe();
    };
  }, []);

  // Single-device login: reclama allowed_sid, escucha cambios y firma fuera
  // si otro dispositivo se queda con la sesión.
  useSessionEnforcer(session);

  // La app está lista si:
  // 1. Auth está listo Y las fuentes están listas.
  // 2. O si el failsafe se activó (evita muerte por splash).
  const isAppReady = !!failsafeActive || (!!authReady && (!!fontsLoaded || !!fontError));

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
        SplashScreen.hideAsync().catch(() => {});
        if (Platform.OS === 'web') {
          // Registro de Service Worker para PWA
          // Registro de Service Worker para PWA
          if ('serviceWorker' in navigator) {
            const register = () => {
              navigator.serviceWorker.register('/service-worker.js').then(
                (reg) => console.log('SW Registered'),
                (err) => console.log('SW Registration Failed', err)
              );
            };

            if (document.readyState === 'complete') {
              register();
            } else {
              window.addEventListener('load', register);
            }
          }
        }
      }, 50);
      return () => clearTimeout(h);
    }
  }, [isAppReady]);

  const inner = (
    <SafeAreaProvider>
      <GestureHandlerRootView style={{ flex: 1 }}>
        <QueryClientProvider client={queryClient}>
          <RealtimeInitializer>
            <ThemeProvider>
              <AuthGuard session={session} ready={isAppReady} />
            </ThemeProvider>
          </RealtimeInitializer>
        </QueryClientProvider>
      </GestureHandlerRootView>
    </SafeAreaProvider>
  );

  if (Platform.OS === 'web') {
    // Desktop: full viewport with dark background so the area beyond
    // CONTENT_MAX_WIDTH does not flash white
    if (isDesktop) {
      return (
        <View style={{ flex: 1, backgroundColor: '#010100' }}>
          {inner}
        </View>
      );
    }

    // Verificación crítica de variables de entorno en Web
    if (!process.env.EXPO_PUBLIC_SUPABASE_URL || !process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY) {
      return (
        <View style={{ flex: 1, backgroundColor: '#010100', justifyContent: 'center', alignItems: 'center', padding: 20 }}>
          <Text style={{ color: '#ef4444', textAlign: 'center', fontSize: 16, fontWeight: 'bold' }}>Error de Configuración</Text>
          <Text style={{ color: '#9ca3af', textAlign: 'center', marginTop: 10 }}>Faltan las variables de entorno de Supabase en el servidor.</Text>
        </View>
      );
    }

    // Mobile/PWA: full screen
    return (
      <View style={{ flex: 1, backgroundColor: '#010100' }}>
        {inner}
      </View>
    );
  }

  return inner;
}

