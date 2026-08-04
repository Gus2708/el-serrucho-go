import { useQuery, UseQueryResult } from '@tanstack/react-query';
import { supabase, CreditoCuenta, CreditoMovimiento, CreditoResumen, VentaCreditoDisponible } from '../lib/supabase';
import { withSupabaseRetry } from '../lib/retry';

// Lecturas de crédito (fiado): todo sale de vistas de solo lectura
// (vw_creditos_*). La escritura vive aparte en useCreditoMutations.ts, siempre
// por RPC — no hay policies de INSERT/UPDATE/DELETE sobre las tablas base.
// Ver migración 041.

export interface UseCreditosCuentasOptions {
  search?:          string;
  incluirCerradas?: boolean;
}

export function useCreditosCuentas(opts?: UseCreditosCuentasOptions): UseQueryResult<CreditoCuenta[], Error> {
  const search = opts?.search ?? '';
  const incluirCerradas = opts?.incluirCerradas ?? false;

  return useQuery({
    queryKey:  ['creditos', 'cuentas', search, incluirCerradas],
    queryFn:   () => fetchCreditosCuentas(search, incluirCerradas),
    staleTime: 30_000,
  });
}

async function fetchCreditosCuentas(search: string, incluirCerradas: boolean): Promise<CreditoCuenta[]> {
  let query = supabase.from('vw_creditos_saldo').select('*');

  if (!incluirCerradas) query = query.eq('estado', 'activa');

  const texto = search.trim();
  if (texto.length > 0) {
    query = query.or(`nombre.ilike.%${texto}%,documento_id.ilike.%${texto}%,telefono.ilike.%${texto}%`);
  }

  // Las cuentas con más deuda quedan arriba: es lo primero que el cobrador
  // necesita ver al entrar a la pantalla.
  const { data, error } = await withSupabaseRetry(() =>
    query.order('saldo', { ascending: false }),
  );

  if (error) throw error;
  return data ?? [];
}

export function useCreditosResumen(): UseQueryResult<CreditoResumen, Error> {
  return useQuery({
    queryKey:  ['creditos', 'resumen'],
    queryFn:   fetchCreditosResumen,
    staleTime: 30_000,
  });
}

async function fetchCreditosResumen(): Promise<CreditoResumen> {
  const { data, error } = await withSupabaseRetry(() =>
    supabase.from('vw_creditos_resumen').select('*').maybeSingle(),
  );

  if (error) throw error;

  // La vista siempre debería traer una fila; si no hay ninguna (sin cuentas
  // creadas aún) devolvemos ceros en vez de dejar la UI sin datos.
  return data ?? {
    total_por_cobrar: 0, total_a_favor: 0,
    cuentas_con_deuda: 0, cuentas_activas: 0, mayor_saldo: 0,
  };
}

export function useCreditoCuenta(cuentaId: number | null): UseQueryResult<CreditoCuenta | null, Error> {
  return useQuery({
    queryKey:  ['creditos', 'cuenta', cuentaId],
    queryFn:   () => fetchCreditoCuenta(cuentaId as number),
    enabled:   cuentaId != null,
    staleTime: 15_000,
  });
}

async function fetchCreditoCuenta(cuentaId: number): Promise<CreditoCuenta | null> {
  const { data, error } = await withSupabaseRetry(() =>
    supabase.from('vw_creditos_saldo').select('*').eq('id', cuentaId).maybeSingle(),
  );

  if (error) throw error;
  return data ?? null;
}

export function useCreditoMovimientos(cuentaId: number | null): UseQueryResult<CreditoMovimiento[], Error> {
  return useQuery({
    queryKey:  ['creditos', 'movimientos', cuentaId],
    queryFn:   () => fetchCreditoMovimientos(cuentaId as number),
    enabled:   cuentaId != null,
    staleTime: 15_000,
  });
}

async function fetchCreditoMovimientos(cuentaId: number): Promise<CreditoMovimiento[]> {
  // El más reciente arriba: es un estado de cuenta, se lee de atrás para adelante.
  const { data, error } = await withSupabaseRetry(() =>
    supabase
      .from('vw_creditos_movimientos')
      .select('*')
      .eq('cuenta_id', cuentaId)
      .order('fecha', { ascending: false })
      .order('id', { ascending: false }),
  );

  if (error) throw error;
  return data ?? [];
}

export function useVentasCreditoDisponibles(search: string): UseQueryResult<VentaCreditoDisponible[], Error> {
  return useQuery({
    queryKey:  ['creditos', 'ventas-disponibles', search],
    queryFn:   () => fetchVentasCreditoDisponibles(search),
    staleTime: 60_000,
  });
}

async function fetchVentasCreditoDisponibles(search: string): Promise<VentaCreditoDisponible[]> {
  let query = supabase.from('vw_ventas_credito_disponibles').select('*');

  const texto = search.trim();
  if (texto.length > 0) {
    query = query.or(`documento.ilike.%${texto}%,sugerido_nombre.ilike.%${texto}%`);
  }

  const { data, error } = await withSupabaseRetry(() =>
    query.order('created_at', { ascending: false }).limit(40),
  );

  if (error) throw error;
  return data ?? [];
}
