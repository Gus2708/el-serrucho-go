import { useQuery, UseQueryResult } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';

export interface Proveedor {
  codigo:   string;
  nombre:   string;
  rif:      string | null;
  telefono: string | null;
}

export function useProveedores(): UseQueryResult<Proveedor[], Error> {
  return useQuery({
    queryKey:  ['proveedores'],
    queryFn:   fetchProveedores,
    staleTime: 10 * 60_000,
  });
}

async function fetchProveedores(): Promise<Proveedor[]> {
  const { data, error } = await supabase
    .from('proveedores')
    .select('codigo, nombre, rif, telefono')
    .eq('status', true)
    .order('nombre');

  if (error) throw error;

  return (data ?? []).map((p: any) => ({
    codigo:   p.codigo,
    nombre:   p.nombre,
    rif:      p.rif || null,
    telefono: p.telefono || null,
  }));
}
