import { useMutation, UseMutationResult, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';

// Registro de un proveedor nuevo → cola `registro_proveedores_app`. Escritura restringida a
// privilegiados por RLS (modelo Compras). El backend lo da de alta en HybridLite (write-back)
// y devuelve `codigo_proveedor_hybrid`. Ver docs/REGISTRO-DIRECTORIO-PIPELINE.md.

export interface RegistroProveedorInput {
  nombre:   string;
  rif:      string | null;
  telefono: string | null;
  contacto: string | null;
  email:    string | null;
  nota:     string | null;
}

export interface RegistroProveedorResult {
  id: number;
}

function limpiar(valor: string | null): string | null {
  const trimmed = (valor ?? '').trim();
  return trimmed.length > 0 ? trimmed : null;
}

async function insertRegistroProveedor(input: RegistroProveedorInput): Promise<RegistroProveedorResult> {
  const { data: auth } = await supabase.auth.getUser();
  const userId = auth.user?.id;
  if (!userId) throw new Error('No autenticado.');

  const nombre = input.nombre.trim().toUpperCase();
  if (nombre.length === 0) throw new Error('El nombre es obligatorio.');

  const { data, error } = await supabase
    .from('registro_proveedores_app')
    .insert({
      creado_por: userId,
      nombre,
      rif:        limpiar(input.rif),
      telefono:   limpiar(input.telefono),
      contacto:   limpiar(input.contacto),
      email:      limpiar(input.email),
      nota:       limpiar(input.nota),
      status:     'emitido',
    })
    .select('id')
    .single();

  if (error || !data) throw error ?? new Error('No se pudo registrar el proveedor.');
  return { id: data.id };
}

export function useRegistrarProveedor(): UseMutationResult<RegistroProveedorResult, Error, RegistroProveedorInput> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: insertRegistroProveedor,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['registros', 'proveedor'] });
    },
  });
}
