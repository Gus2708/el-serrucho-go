import { useEffect, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';

export type MaxcamCandidato = {
  sku:        string;
  nombre:     string;
  marca:      string | null;
  similitud:  number;
  disponible: boolean;
  stock_bq:   number;
  precio:     number | null;
  cant_caja:  number | null;
};

export type MaxcamConsulta = {
  id:        string;
  status:    'pendiente' | 'procesando' | 'listo' | 'error';
  error:     string | null;
  resultado: {
    metodo:        'codigo' | 'similitud';
    candidatos:    MaxcamCandidato[];
    consultado_en: string;
  } | null;
};

const REUSE_MINUTES = 15;   // a recent answer is reused instead of asking Maxcam again
const POLL_MS       = 2500;
const GIVE_UP_MS    = 150_000; // covers the API cold start (~76 s) with margin

const COLUMNS = 'id,status,error,resultado';

/**
 * Asks the backend whether a product is available at Maxcam (Barquisimeto).
 * The request goes through the consultas_maxcam bridge table; a listener in the
 * store's backend answers it, so this works from outside the local network.
 */
export function useMaxcamConsulta(codigoInterno: string) {
  const [consultaId, setConsultaId]   = useState<string | null>(null);
  const [startedAt, setStartedAt]     = useState(0);

  const solicitar = useMutation({
    mutationFn: async (): Promise<string> => {
      const desde = new Date(Date.now() - REUSE_MINUTES * 60_000).toISOString();
      const { data: reciente } = await supabase
        .from('consultas_maxcam')
        .select('id')
        .eq('codigo_interno', codigoInterno)
        .eq('status', 'listo')
        .gte('creado_en', desde)
        .order('creado_en', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (reciente) return reciente.id;

      const { data, error } = await supabase
        .from('consultas_maxcam')
        .insert({ codigo_interno: codigoInterno })
        .select('id')
        .single();
      if (error) throw error;
      return data.id;
    },
    onSuccess: (id) => {
      setStartedAt(Date.now());
      setConsultaId(id);
    },
  });

  const consulta = useQuery({
    queryKey: ['maxcam-consulta', consultaId],
    enabled:  !!consultaId,
    queryFn: async (): Promise<MaxcamConsulta> => {
      const { data, error } = await supabase
        .from('consultas_maxcam')
        .select(COLUMNS)
        .eq('id', consultaId!)
        .single();
      if (error) throw error;
      return data as MaxcamConsulta;
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
    if (!consultaId) return;
    setTimedOut(false);
    const t = setTimeout(() => setTimedOut(true), GIVE_UP_MS);
    return () => clearTimeout(t);
  }, [consultaId]);
  const vencida = timedOut && !terminada;

  return {
    consultar: () => solicitar.mutate(),
    reiniciar: () => { setConsultaId(null); setStartedAt(0); },
    consulta:  row,
    enviando:  solicitar.isPending,
    esperando: !!consultaId && !terminada && !vencida,
    vencida,
    errorEnvio: solicitar.error as Error | null,
  };
}
