import { useQuery, UseQueryResult } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';

export type DirectorioTipo = 'cliente' | 'proveedor';

export type DirectorioBackendStatus = 'oficial' | 'pendiente' | 'aplicando' | 'completado' | 'error';

export interface RegistroDirectorio {
  id:                  string;
  codigo:              string;          // e.g. 'CLI-0001', 'PROV-0002', o 'RC-0005'
  nombre:              string;
  rif:                 string | null;
  telefono:            string | null;
  direccion?:          string | null;   // clientes
  contacto?:           string | null;   // proveedores
  email?:              string | null;   // proveedores
  nota?:               string | null;
  creado_en?:          string | null;
  backend_status:      DirectorioBackendStatus;
  backend_resultado?:  string | null;
  backend_aplicado_en?: string | null;
  codigo_hybrid?:      string | null;
  creado_por_nombre?:  string;
  isOficial:           boolean;
}

export function useRegistrosDirectorio(tipo: DirectorioTipo, search: string = ''): UseQueryResult<RegistroDirectorio[], Error> {
  return useQuery({
    queryKey:  ['registros', tipo, search],
    queryFn:   () => (tipo === 'cliente' ? fetchDirectorioClientes(search) : fetchDirectorioProveedores(search)),
    staleTime: 30_000,
  });
}

async function fetchDirectorioClientes(search: string): Promise<RegistroDirectorio[]> {
  const trimmed = search.trim();

  // 1. Solicitudes emitidas desde la App (registro_clientes_app)
  let appQuery = supabase
    .from('registro_clientes_app')
    .select('*')
    .order('creado_en', { ascending: false })
    .limit(50);

  if (trimmed.length > 0) {
    const term = `%${trimmed}%`;
    appQuery = appQuery.or(`nombre.ilike.${term},rif.ilike.${term},codigo_cliente_hybrid.ilike.${term}`);
  }

  const { data: appData, error: appError } = await appQuery;
  if (appError) throw appError;

  const appRows = appData ?? [];
  const uniqueCreatorIds = [...new Set(appRows.map((r: any) => r.creado_por).filter(Boolean))];
  let profileMap: Record<string, string> = {};
  if (uniqueCreatorIds.length > 0) {
    const { data: profiles } = await supabase
      .from('profiles')
      .select('id, display_name')
      .in('id', uniqueCreatorIds);
    if (profiles) {
      profileMap = Object.fromEntries(profiles.map((p: any) => [p.id, p.display_name]));
    }
  }

  // 2. Clientes oficiales de la BD (clientes)
  let mainQuery = supabase
    .from('clientes')
    .select('*')
    .limit(100);

  if (trimmed.length > 0) {
    const term = `%${trimmed}%`;
    mainQuery = mainQuery.or(`nombre.ilike.${term},rif.ilike.${term},codigo_cliente.ilike.${term}`);
  }

  const { data: mainData, error: mainError } = await mainQuery;
  if (mainError) throw mainError;
  const mainRows = mainData ?? [];

  const existingCodes = new Set(mainRows.map((c: any) => c.codigo_cliente).filter(Boolean));

  // Mapear registros de la app
  const appMapped: RegistroDirectorio[] = appRows
    .filter((r: any) => !(r.backend_status === 'completado' && r.codigo_cliente_hybrid && existingCodes.has(r.codigo_cliente_hybrid)))
    .map((r: any) => ({
      id:                  `app-${r.id}`,
      codigo:              r.codigo_cliente_hybrid ?? `RC-${String(r.id).padStart(4, '0')}`,
      nombre:              r.nombre,
      rif:                 r.rif || null,
      telefono:            r.telefono || null,
      direccion:           r.direccion || null,
      nota:                r.nota || null,
      creado_en:           r.creado_en || null,
      backend_status:      (r.backend_status as DirectorioBackendStatus) ?? 'pendiente',
      backend_resultado:   r.backend_resultado || null,
      backend_aplicado_en: r.backend_aplicado_en || null,
      codigo_hybrid:       r.codigo_cliente_hybrid || null,
      creado_por_nombre:   profileMap[r.creado_por],
      isOficial:           false,
    }));

  // Mapear clientes oficiales
  const mainMapped: RegistroDirectorio[] = mainRows.map((c: any) => ({
    id:                  `oficial-${c.codigo_cliente ?? c.id}`,
    codigo:              c.codigo_cliente ?? 'S/C',
    nombre:              c.nombre,
    rif:                 c.rif || null,
    telefono:            c.telefono || null,
    direccion:           c.direccion || null,
    creado_en:           c.created_at || null,
    backend_status:      'oficial',
    isOficial:           true,
  }));

  // Mostramos primero las solicitudes en cola/pendientes y luego el directorio oficial
  return [...appMapped, ...mainMapped];
}

async function fetchDirectorioProveedores(search: string): Promise<RegistroDirectorio[]> {
  const trimmed = search.trim();

  // 1. Solicitudes emitidas desde la App (registro_proveedores_app)
  let appQuery = supabase
    .from('registro_proveedores_app')
    .select('*')
    .order('creado_en', { ascending: false })
    .limit(50);

  if (trimmed.length > 0) {
    const term = `%${trimmed}%`;
    appQuery = appQuery.or(`nombre.ilike.${term},rif.ilike.${term},codigo_proveedor_hybrid.ilike.${term}`);
  }

  const { data: appData, error: appError } = await appQuery;
  if (appError) throw appError;

  const appRows = appData ?? [];
  const uniqueCreatorIds = [...new Set(appRows.map((r: any) => r.creado_por).filter(Boolean))];
  let profileMap: Record<string, string> = {};
  if (uniqueCreatorIds.length > 0) {
    const { data: profiles } = await supabase
      .from('profiles')
      .select('id, display_name')
      .in('id', uniqueCreatorIds);
    if (profiles) {
      profileMap = Object.fromEntries(profiles.map((p: any) => [p.id, p.display_name]));
    }
  }

  // 2. Proveedores oficiales de la BD (proveedores)
  let mainQuery = supabase
    .from('proveedores')
    .select('*')
    .eq('status', true)
    .limit(100);

  if (trimmed.length > 0) {
    const term = `%${trimmed}%`;
    mainQuery = mainQuery.or(`nombre.ilike.${term},rif.ilike.${term},codigo.ilike.${term}`);
  }

  const { data: mainData, error: mainError } = await mainQuery;
  if (mainError) throw mainError;
  const mainRows = mainData ?? [];

  const existingCodes = new Set(mainRows.map((p: any) => p.codigo).filter(Boolean));

  // Mapear solicitudes de proveedores de la app
  const appMapped: RegistroDirectorio[] = appRows
    .filter((r: any) => !(r.backend_status === 'completado' && r.codigo_proveedor_hybrid && existingCodes.has(r.codigo_proveedor_hybrid)))
    .map((r: any) => ({
      id:                  `app-${r.id}`,
      codigo:              r.codigo_proveedor_hybrid ?? `RP-${String(r.id).padStart(4, '0')}`,
      nombre:              r.nombre,
      rif:                 r.rif || null,
      telefono:            r.telefono || null,
      contacto:            r.contacto || null,
      email:               r.email || null,
      nota:                r.nota || null,
      creado_en:           r.creado_en || null,
      backend_status:      (r.backend_status as DirectorioBackendStatus) ?? 'pendiente',
      backend_resultado:   r.backend_resultado || null,
      backend_aplicado_en: r.backend_aplicado_en || null,
      codigo_hybrid:       r.codigo_proveedor_hybrid || null,
      creado_por_nombre:   profileMap[r.creado_por],
      isOficial:           false,
    }));

  // Mapear proveedores oficiales
  const mainMapped: RegistroDirectorio[] = mainRows.map((p: any) => ({
    id:                  `oficial-${p.codigo}`,
    codigo:              p.codigo ?? 'S/C',
    nombre:              p.nombre,
    rif:                 p.rif || null,
    telefono:            p.telefono || null,
    contacto:            p.contacto || null,
    email:               p.email || null,
    creado_en:           p.actualizado_en || null,
    backend_status:      'oficial',
    isOficial:           true,
  }));

  return [...appMapped, ...mainMapped];
}
