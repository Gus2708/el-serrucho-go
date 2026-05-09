import { useQuery } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';

export interface Tasa {
  bcv_usd:        number;
  bcv_eur:        number;
  binance_p2p:    number;
  tasa_promedio:  number;
  nombre:         string;
  created_at:     string;
}

/**
 * Lee la tasa de cambio actual desde la tabla `tazas`.
 *
 * Usado SOLO para mostrar las tasas de referencia y calcular brecha BCV vs
 * mercado paralelo. NO se usa para convertir precios de productos/ventas
 * (eso lo hace el widget Python al subir los datos en USD nativo).
 */
export function useTazas() {
  return useQuery({
    queryKey: ['tazas-actual'],
    queryFn:  fetchTazaActual,
    staleTime:        30 * 60_000,   // 30 min — Realtime se encarga de invalidar si cambia
  });
}

async function fetchTazaActual(): Promise<Tasa | null> {
  const { data, error } = await supabase
    .from('tazas')
    .select('*')
    .eq('nombre', 'actual')
    .maybeSingle();

  if (error || !data) return null;

  return {
    ...data,
    bcv_usd:       Number(data.bcv_usd       || 0),
    bcv_eur:       Number(data.bcv_eur       || 0),
    binance_p2p:   Number(data.binance_p2p   || 0),
    tasa_promedio: Number(data.tasa_promedio || 0),
  };
}

/** Brecha porcentual entre Binance P2P y BCV (mercado paralelo vs oficial). */
export function calcBrecha(tasa: Tasa | null | undefined): number {
  if (!tasa || !tasa.bcv_usd || !tasa.binance_p2p) return 0;
  return ((tasa.binance_p2p - tasa.bcv_usd) / tasa.bcv_usd) * 100;
}
