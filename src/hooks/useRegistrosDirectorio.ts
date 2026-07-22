import { useQuery, UseQueryResult } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';

// Historial + estado de write-back de los registros de directorio (clientes / proveedores).
// Espeja useComprasHistory.ts: batch a `profiles` para el nombre del creador. La columna del
// código que Hybrid autoasigna y los campos extra dependen del tipo.

export type DirectorioTipo = 'cliente' | 'proveedor';

export type DirectorioBackendStatus = 'pendiente' | 'aplicando' | 'completado' | 'error';

export interface RegistroDirectorio {
  id:                  number;
  nombre:              string;
  rif:                 string | null;
  telefono:            string | null;
  nota:                string | null;
  status:              string;
  creado_en:           string;
  backend_status:      DirectorioBackendStatus;
  backend_resultado:   string | null;
  backend_aplicado_en: string | null;
  codigo_hybrid:       string | null;   // codigo_cliente_hybrid | codigo_proveedor_hybrid
  creado_por_nombre?:  string;
  direccion?:          string | null;   // solo cliente
  contacto?:           string | null;   // solo proveedor
  email?:              string | null;   // solo proveedor
}

interface DirectorioConfig {
  tabla:     string;
  codigoCol: string;
  extraCols: string;
}

function configFor(tipo: DirectorioTipo): DirectorioConfig {
  if (tipo === 'cliente') {
    return {
      tabla:     'registro_clientes_app',
      codigoCol: 'codigo_cliente_hybrid',
      extraCols: 'direccion',
    };
  }
  return {
    tabla:     'registro_proveedores_app',
    codigoCol: 'codigo_proveedor_hybrid',
    extraCols: 'contacto, email',
  };
}

export function useRegistrosDirectorio(tipo: DirectorioTipo): UseQueryResult<RegistroDirectorio[], Error> {
  return useQuery({
    queryKey:  ['registros', tipo],
    queryFn:   () => fetchRegistros(tipo),
    staleTime: 60_000,
  });
}

async function fetchRegistros(tipo: DirectorioTipo): Promise<RegistroDirectorio[]> {
  const { tabla, codigoCol, extraCols } = configFor(tipo);

  const { data, error } = await supabase
    .from(tabla)
    .select(`
      id, creado_por, nombre, rif, telefono, nota, status, creado_en,
      backend_status, backend_resultado, backend_aplicado_en,
      ${codigoCol}, ${extraCols}
    `)
    .order('creado_en', { ascending: false })
    .limit(50);

  if (error) throw error;

  const rows = data ?? [];

  // Batch-fetch creator names from profiles (patrón useComprasHistory)
  const uniqueIds = [...new Set(rows.map((r: any) => r.creado_por).filter(Boolean))];
  let profileMap: Record<string, string> = {};

  if (uniqueIds.length > 0) {
    const { data: profiles } = await supabase
      .from('profiles')
      .select('id, display_name')
      .in('id', uniqueIds);

    if (profiles) {
      profileMap = Object.fromEntries(profiles.map((p: any) => [p.id, p.display_name]));
    }
  }

  return rows.map((r: any) => ({
    id:                  r.id,
    nombre:              r.nombre,
    rif:                 r.rif,
    telefono:            r.telefono,
    nota:                r.nota,
    status:              r.status,
    creado_en:           r.creado_en,
    backend_status:      r.backend_status,
    backend_resultado:   r.backend_resultado,
    backend_aplicado_en: r.backend_aplicado_en,
    codigo_hybrid:       r[codigoCol] ?? null,
    creado_por_nombre:   profileMap[r.creado_por] ?? undefined,
    direccion:           r.direccion ?? null,
    contacto:            r.contacto ?? null,
    email:               r.email ?? null,
  }));
}
