import { useEffect, useState } from 'react';
import { Slot, useRouter, useSegments } from 'expo-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { Session } from '@supabase/supabase-js';
import { supabase } from '../src/lib/supabase';
import { ThemeProvider } from '../src/theme/ThemeContext';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, staleTime: 30_000 },
  },
});

function AuthGuard({ session, ready }: { session: Session | null; ready: boolean }) {
  const segments = useSegments();
  const router   = useRouter();

  useEffect(() => {
    if (!ready) return;
    const inAuth = segments[0] === '(auth)';
    if (!session && !inAuth) {
      router.replace('/(auth)/login');
    } else if (session && inAuth) {
      router.replace('/(tabs)');
    }
  }, [session, ready, segments]);

  return <Slot />;
}

export default function RootLayout() {
  const [session, setSession] = useState<Session | null>(null);
  const [ready,   setReady]   = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setReady(true);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, s) => {
      setSession(s);
      if (event === 'SIGNED_OUT' || event === 'SIGNED_IN') {
        queryClient.clear();
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <QueryClientProvider client={queryClient}>
        <ThemeProvider>
          <AuthGuard session={session} ready={ready} />
        </ThemeProvider>
      </QueryClientProvider>
    </GestureHandlerRootView>
  );
}
