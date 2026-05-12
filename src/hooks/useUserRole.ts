import { useQuery } from '@tanstack/react-query';
import { supabase, Profile } from '../lib/supabase';

export function useUserRole() {
  return useQuery({
    queryKey: ['user-role'],
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      
      if (!user) {
        return { role: 'empleado', is_active: false, profile: null };
      }
      
      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', user.id)
        .single();

      if (error || !data) {
        return { role: 'empleado', is_active: false, profile: null };
      }

      return { 
        role: data.role as 'admin' | 'empleado', 
        is_active: data.is_active as boolean,
        profile: data as Profile 
      };
    },
    staleTime: 5 * 60_000,
    gcTime:    30 * 60_000,
  });
}
