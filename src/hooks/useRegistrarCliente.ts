import { useMutation, UseMutationResult, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';

// Registro de un cliente nuevo → cola `registro_clientes_app`. El backend lo da de alta
// en HybridLite (write-back) y devuelve `codigo_cliente_hybrid`. Ver
// docs/REGISTRO-DIRECTORIO-PIPELINE.md.

export interface RegistroClienteInput {
  nombre:    string;
  rif:       string | null;
  telefono:  string | null;
  direccion: string | null;
  nota:      string | null;
}

export interface RegistroClienteResult {
  id: number;
}

function limpiar(valor: string | null): string | null {
  const trimmed = (valor ?? '').trim();
  return trimmed.length > 0 ? trimmed : null;
}

async function insertRegistroCliente(input: RegistroClienteInput): Promise<RegistroClienteResult> {
  const { data: auth } = await supabase.auth.getUser();
  const userId = auth.user?.id;
  if (!userId) throw new Error('No autenticado.');

  const nombre = input.nombre.trim().toUpperCase();
  if (nombre.length === 0) throw new Error('El nombre es obligatorio.');

  const { data, error } = await supabase
    .from('registro_clientes_app')
    .insert({
      creado_por: userId,
      nombre,
      rif:        limpiar(input.rif),
      telefono:   limpiar(input.telefono),
      direccion:  limpiar(input.direccion),
      nota:       limpiar(input.nota),
      status:     'emitido',
    })
    .select('id')
    .single();

  if (error || !data) throw error ?? new Error('No se pudo registrar el cliente.');
  return { id: data.id };
}

export function useRegistrarCliente(): UseMutationResult<RegistroClienteResult, Error, RegistroClienteInput> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: insertRegistroCliente,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['registros', 'cliente'] });
    },
  });
}
