import { useQuery } from '@tanstack/react-query';
import { supabase, Profile } from '../lib/supabase';

export function useUserRole() {
  // First, get the current user session
  const { data: user } = useQuery({
    queryKey: ['auth-session'],
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      return user;
    },
    staleTime: 5 * 60_000, // Reduced from 1h to 5min for better responsiveness
  });

  return useQuery({
    queryKey: ['user-role', user?.id],
    queryFn: async () => {
      if (!user) return { role: 'empleado', profile: null };
      
      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', user.id)
        .single();

      if (error || !data) {
        return { role: 'empleado', profile: null };
      }

      return { 
        role: data.role as 'admin' | 'empleado', 
        is_active: data.is_active as boolean,
        profile: data as Profile 
      };
    },
    enabled: !!user,
    staleTime: 5 * 60_000,
    gcTime:    30 * 60_000,   // keep in cache 30 min so navigation doesn't re-trigger fetch
  });
}
