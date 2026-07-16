import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase, Profile, UserRole } from '../lib/supabase';

// ── Gestión de usuarios (solo admin) ──────────────────────────────────────────
// Lista todos los perfiles y permite al admin cambiar rol / activación.
// La escritura la habilita la policy "Admins can update any profile" (migración
// 026); un no-admin recibe error del trigger fn_protect_profile_privileges.

export function useUsuarios() {
  return useQuery({
    queryKey:  ['usuarios'],
    queryFn:   fetchUsuarios,
    staleTime: 30_000,
  });
}

async function fetchUsuarios(): Promise<Profile[]> {
  const { data, error } = await supabase
    .from('profiles')
    .select('id, role, email, display_name, is_active, updated_at')
    .order('role', { ascending: true })
    .order('display_name', { ascending: true });

  if (error) throw error;
  return (data ?? []) as Profile[];
}

export function useUpdateUsuario() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      id,
      role,
      is_active,
    }: {
      id: string;
      role?: UserRole;
      is_active?: boolean;
    }) => {
      const updates: Record<string, unknown> = {};
      if (role !== undefined) updates.role = role;
      if (is_active !== undefined) updates.is_active = is_active;

      const { data, error } = await supabase
        .from('profiles')
        .update(updates)
        .eq('id', id)
        .select('id');

      if (error) throw new Error(error.message);
      if (!data || data.length === 0) {
        throw new Error('No se pudo actualizar: se requieren permisos de administrador.');
      }
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['usuarios'] });
      queryClient.invalidateQueries({ queryKey: ['user-role'] });
    },
  });
}
