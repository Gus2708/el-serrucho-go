import { useQuery } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';

export type ProveedorElegible = {
  elegible:     boolean;
  motivo:       'rotacion' | 'nuevo' | 'baja_rotacion' | 'con_stock';
  facturas:     number;
  ultima_venta: string | null;
  existencia?:  number;
};

/**
 * Is a product worth asking the suppliers about? Only when it is sold out or low on stock
 * AND it rotates well (or is newly added): old products with no recent sales spend no
 * queries. The rule lives in the proveedor_elegible SQL function (migrations 050 and 051).
 *
 * If the check itself fails (function not deployed yet, no network) the answer is
 * "eligible": the cards keep working as before and nothing is hidden by mistake.
 */
export function useProveedorElegible(codigoInterno: string, enabled: boolean) {
  return useQuery({
    queryKey: ['proveedor-elegible', codigoInterno],
    enabled,
    staleTime: 10 * 60_000,
    queryFn: async (): Promise<ProveedorElegible> => {
      const { data, error } = await supabase.rpc('proveedor_elegible', { p_codigo: codigoInterno });
      if (error || !data) {
        return { elegible: true, motivo: 'rotacion', facturas: 0, ultima_venta: null };
      }
      return data as ProveedorElegible;
    },
  });
}
