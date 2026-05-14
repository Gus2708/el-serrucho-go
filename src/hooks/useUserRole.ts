import { useQuery } from '@tanstack/react-query';
import { Platform } from 'react-native';
import { supabase, Profile } from '../lib/supabase';

// ── Offline cache for user role (Web/PWA only) ────────────────────────────────
const ROLE_CACHE_KEY = 'serrucho:user-role';

function saveRoleToLocal(data: { role: string; is_active: boolean; profile: Profile | null }) {
  if (Platform.OS !== 'web') return;
  try {
    localStorage.setItem(ROLE_CACHE_KEY, JSON.stringify(data));
  } catch {}
}

function loadRoleFromLocal(): { role: 'admin' | 'empleado'; is_active: boolean; profile: Profile | null } | null {
  if (Platform.OS !== 'web') return null;
  try {
    const raw = localStorage.getItem(ROLE_CACHE_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function isOffline(): boolean {
  if (Platform.OS !== 'web') return false;
  return typeof navigator !== 'undefined' && !navigator.onLine;
}

export function useUserRole(userId?: string) {
  return useQuery({
    queryKey: ['user-role', userId],
    queryFn: async () => {
      let activeId = userId;
      
      if (!activeId) {
        const { data: { session } } = await supabase.auth.getSession();
        activeId = session?.user?.id;
      }

      if (!activeId) {
        // No userId at all — check if we're offline and have a cached role
        if (isOffline()) {
          const cached = loadRoleFromLocal();
          if (cached) return cached;
        }
        return { role: 'empleado' as const, is_active: false, profile: null };
      }

      // Race against a 5-second timeout to prevent infinite loading
      const fetchProfile = async () => {
        const { data, error } = await supabase
          .from('profiles')
          .select('*')
          .eq('id', activeId)
          .single();

        if (error || !data) {
          // ── Offline fallback ──
          // If the fetch failed AND we're offline (or it timed out),
          // use the last known good role from localStorage.
          // This prevents the "pending" screen from showing when internet is down.
          const cached = loadRoleFromLocal();
          if (cached) {
            console.log('[useUserRole] Using cached role (offline/error)');
            return cached;
          }
          return { role: 'empleado' as const, is_active: false, profile: null };
        }

        const result = { 
          role: data.role as 'admin' | 'empleado', 
          is_active: data.is_active as boolean,
          profile: data as Profile 
        };

        // Cache successful result for offline use
        saveRoleToLocal(result);

        return result;
      };

      const timeout = new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Timeout fetching role')), 5000)
      );

      try {
        return await Promise.race([fetchProfile(), timeout]) as any;
      } catch (err) {
        console.warn('User role fetch timed out or failed:', err);
        // ── Critical offline fallback ──
        // If the network request timed out, use cached role.
        // This is the key fix: without this, a slow/no internet causes
        // is_active=false → redirect to "pending" screen.
        const cached = loadRoleFromLocal();
        if (cached) {
          console.log('[useUserRole] Using cached role after timeout');
          return cached;
        }
        return { role: 'empleado' as const, is_active: false, profile: null };
      }
    },
    staleTime: 5 * 60_000,
    gcTime:    30 * 60_000,
    retry: false,
  });
}
