import { useQuery } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import type { VelocidadCounts } from '../components/DonutChart';
import { isDemoActive } from '../demo/useDemoStore';

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
  if (isDemoActive()) {
    const rows: VelocidadRow[] = [];
    for (let i = 0; i < 142; i++) rows.push({ codigo_interno: `R-${i}`, descripcion: `Item R-${i}`, existencia: 10, vendido_30d: 50, velocidad: 'rapido' });
    for (let i = 0; i < 58; i++) rows.push({ codigo_interno: `L-${i}`, descripcion: `Item L-${i}`, existencia: 5, vendido_30d: 4, velocidad: 'lento' });
    for (let i = 0; i < 14; i++) rows.push({ codigo_interno: `S-${i}`, descripcion: `Item S-${i}`, existencia: 12, vendido_30d: 0, velocidad: 'sin_movimiento' });
    return rows;
  }
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
