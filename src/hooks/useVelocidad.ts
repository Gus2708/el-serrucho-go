import { useQuery } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import type { VelocidadCounts } from '../components/DonutChart';

type VelocidadRow = {
  codigo_interno: string;
  descripcion:    string;
  existencia:     number;
  vendido_30d:    number;
  velocidad:      'rapido' | 'lento' | 'sin_movimiento';
};

export function useVelocidad() {
  return useQuery({
    queryKey:  ['velocidad'],
    queryFn:   fetchVelocidad,
    staleTime: 5 * 60_000,
    select:    toVelocidadCounts,
  });
}

async function fetchVelocidad(): Promise<VelocidadRow[]> {
  const { data, error } = await supabase
    .from('vw_velocidad_productos')
    .select('codigo_interno,descripcion,existencia,vendido_30d,velocidad');

  if (error) throw error;
  return (data ?? []) as VelocidadRow[];
}

function toVelocidadCounts(rows: VelocidadRow[]): VelocidadCounts {
  return rows.reduce(
    (acc, r) => {
      acc[r.velocidad]++;
      acc.total++;
      return acc;
    },
    { rapido: 0, lento: 0, sin_movimiento: 0, total: 0 } as VelocidadCounts
  );
}
