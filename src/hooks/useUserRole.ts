import { useQuery } from '@tanstack/react-query';
import { supabase, Profile } from '../lib/supabase';

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
        return { role: 'empleado', is_active: false, profile: null };
      }

      // Race against a 5-second timeout to prevent infinite loading
      const fetchProfile = async () => {
        const { data, error } = await supabase
          .from('profiles')
          .select('*')
          .eq('id', activeId)
          .single();

        if (error || !data) {
          return { role: 'empleado', is_active: false, profile: null };
        }

        return { 
          role: data.role as 'admin' | 'empleado', 
          is_active: data.is_active as boolean,
          profile: data as Profile 
        };
      };

      const timeout = new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Timeout fetching role')), 5000)
      );

      try {
        return await Promise.race([fetchProfile(), timeout]) as any;
      } catch (err) {
        console.warn('User role fetch timed out or failed:', err);
        return { role: 'empleado', is_active: false, profile: null };
      }
    },
    staleTime: 5 * 60_000,
    gcTime:    30 * 60_000,
    retry: false,
  });
}
