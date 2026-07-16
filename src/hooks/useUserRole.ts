import { useQuery } from '@tanstack/react-query';
import { Platform } from 'react-native';
import { supabase, Profile, UserRole } from '../lib/supabase';

// ── Offline cache for user role (Web/PWA only) ────────────────────────────────
const ROLE_CACHE_KEY    = 'serrucho:user-role';
const ROLE_CACHE_TTL_MS = 4 * 60 * 60 * 1000; // 4 hours

type CachedRole = {
  role:      UserRole;
  is_active: boolean;
  profile:   Profile | null;
  cachedAt:  number;
};

/** admin o superempleado: pueden hacer write-back directo, compras y aprobar ajustes. */
export function isPrivilegedRole(role: UserRole | undefined | null): boolean {
  return role === 'admin' || role === 'superempleado';
}

function saveRoleToLocal(data: { role: string; is_active: boolean; profile: Profile | null }) {
  if (Platform.OS !== 'web') return;
  try {
    const entry: CachedRole = {
      role:      data.role as UserRole,
      is_active: data.is_active,
      profile:   data.profile,
      cachedAt:  Date.now(),
    };
    localStorage.setItem(ROLE_CACHE_KEY, JSON.stringify(entry));
  } catch {}
}

function loadRoleFromLocal(): CachedRole | null {
  if (Platform.OS !== 'web') return null;
  try {
    const raw = localStorage.getItem(ROLE_CACHE_KEY);
    if (!raw) return null;
    const parsed: CachedRole = JSON.parse(raw);
    if (!parsed.cachedAt) return null;
    if (Date.now() - parsed.cachedAt > ROLE_CACHE_TTL_MS) {
      localStorage.removeItem(ROLE_CACHE_KEY);
      return null;
    }
    return parsed;
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
          role: data.role as UserRole,
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
    // Arranque instantáneo: si hay un rol cacheado en localStorage (guardado en
    // el último fetch exitoso), lo usamos como dato inicial para que el
    // AuthGuard y el dashboard no bloqueen con "Cargando perfil...". Al marcar
    // initialDataUpdatedAt con la hora real del cache, TanStack refetchea en
    // background si ya está stale y corrige cualquier cambio de rol.
    initialData: () => loadRoleFromLocal() ?? undefined,
    initialDataUpdatedAt: () => loadRoleFromLocal()?.cachedAt,
  });
}

export function clearRoleCache() {
  if (Platform.OS !== 'web') return;
  try { localStorage.removeItem(ROLE_CACHE_KEY); } catch {}
}
