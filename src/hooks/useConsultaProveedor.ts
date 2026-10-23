import { useEffect, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { withSupabaseRetry } from '../lib/retry';

/** Bridge tables: the app inserts a request, a listener in the store backend answers it. */
export type TablaConsulta = 'consultas_maxcam' | 'consultas_corpnorte';

export type ConsultaProveedor<C> = {
  id:        string;
  status:    'pendiente' | 'procesando' | 'listo' | 'error';
  error:     string | null;
  resultado: {
    metodo:        'codigo' | 'similitud';
    candidatos:    C[];
    consultado_en: string;
  } | null;
};

const REUSE_MINUTES = 15;      // a recent answer is reused instead of asking the supplier again
const POLL_MS       = 2500;
const GIVE_UP_MS    = 150_000; // covers a slow first answer with margin

/**
 * Asks the store backend whether a product is available at a supplier. The request goes
 * through a bridge table, so this works from outside the local network.
 */
export function useConsultaProveedor<C>(tabla: TablaConsulta, codigoInterno: string) {
  const [consultaId, setConsultaId] = useState<string | null>(null);
  const [startedAt, setStartedAt]   = useState(0);

  const solicitar = useMutation({
    // `nueva` skips the reuse window: a retry must ask the supplier again.
    mutationFn: async (nueva: boolean): Promise<string> => {
      if (!nueva) {
        const desde = new Date(Date.now() - REUSE_MINUTES * 60_000).toISOString();
        const { data: reciente } = await withSupabaseRetry(() => supabase
          .from(tabla)
          .select('id')
          .eq('codigo_interno', codigoInterno)
          .eq('status', 'listo')
          .gte('creado_en', desde)
          .order('creado_en', { ascending: false })
          .limit(1)
          .maybeSingle());
        if (reciente) return reciente.id;
      }

      // Safari may drop a request outright ("Load failed"); a quick retry avoids a false error.
      const { data, error } = await withSupabaseRetry(() => supabase
        .from(tabla)
        .insert({ codigo_interno: codigoInterno })
        .select('id')
        .single());
      if (error) throw error;
      return data.id;
    },
    onSuccess: (id) => {
      setStartedAt(Date.now());
      setConsultaId(id);
    },
  });

  const consulta = useQuery({
    queryKey: [tabla, consultaId],
    enabled:  !!consultaId,
    queryFn: async (): Promise<ConsultaProveedor<C>> => {
      const { data, error } = await supabase
        .from(tabla)
        .select('id,status,error,resultado')
        .eq('id', consultaId!)
        .single();
      if (error) throw error;
      return data as ConsultaProveedor<C>;
    },
    refetchInterval: (query) => {
      const row = query.state.data;
      if (row && (row.status === 'listo' || row.status === 'error')) return false;
      return Date.now() - startedAt > GIVE_UP_MS ? false : POLL_MS;
    },
  });

  const row       = consulta.data;
  const terminada = row?.status === 'listo' || row?.status === 'error';

  // A timer (not Date.now() in render): once polling stops nothing re-renders on its own.
  const [timedOut, setTimedOut] = useState(false);
  useEffect(() => {
    setTimedOut(false); // on every change, so a retry never inherits the old timeout
    if (!consultaId) return;
    const t = setTimeout(() => setTimedOut(true), GIVE_UP_MS);
    return () => clearTimeout(t);
  }, [consultaId]);
  const vencida = timedOut && !terminada;

  return {
    consultar:  () => solicitar.mutate(false),
    reintentar: () => { setConsultaId(null); solicitar.mutate(true); },
    consulta:   row,
    enviando:   solicitar.isPending,
    esperando:  !!consultaId && !terminada && !vencida,
    vencida,
    errorEnvio: solicitar.error as Error | null,
  };
}
