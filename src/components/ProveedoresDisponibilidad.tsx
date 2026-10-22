import * as React from 'react';
import { Text, StyleSheet } from 'react-native';
import { useTheme } from '../theme/ThemeContext';
import { scaleFont } from '../theme/responsive';
import { useProveedorElegible } from '../hooks/useProveedorElegible';
import { MaxcamDisponibilidad } from './MaxcamDisponibilidad';
import { CorpnorteDisponibilidad } from './CorpnorteDisponibilidad';

/** Same cap as the "Stock bajo" badge and as p_stock_max in proveedor_elegible (migration 051). */
export const STOCK_BAJO_MAX = 5;

/**
 * Supplier availability cards. They appear only for products that are sold out or low on
 * stock (<= STOCK_BAJO_MAX) AND rotate well (or are new), so old products with no recent
 * sales spend nothing. Products with enough stock never run the check at all.
 */
export function ProveedoresDisponibilidad(
  { codigoInterno, existencia }: { codigoInterno: string; existencia: number },
) {
  const { colors } = useTheme();
  const aplica = existencia <= STOCK_BAJO_MAX;
  const { data } = useProveedorElegible(codigoInterno, aplica);

  if (!aplica || !data) return null; // enough stock, or still checking: render nothing

  if (!data.elegible) {
    return (
      <Text style={[styles.note, { color: colors.textDim }]}>
        Rotación baja ({data.facturas} {data.facturas === 1 ? 'factura' : 'facturas'} en los
        últimos 90 días): no se consulta a los proveedores.
      </Text>
    );
  }

  return (
    <>
      <MaxcamDisponibilidad codigoInterno={codigoInterno} existencia={existencia} />
      <CorpnorteDisponibilidad codigoInterno={codigoInterno} existencia={existencia} />
    </>
  );
}

const styles = StyleSheet.create({
  note: { fontSize: scaleFont(12), fontFamily: 'JetBrainsMono_400Regular', lineHeight: scaleFont(18) },
});
