import { scaleFont } from '../../theme/responsive';
import React, { memo, useCallback, useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '../../theme/ThemeContext';
import { FadeIn } from '../FadeIn';
import { PressableScale } from '../PressableScale';
import { pressScale, staggerDelay } from '../../theme/motion';
import { fechaCorta, metodoLabel } from '../../lib/creditos';
import type { CreditoMovimiento } from '../../lib/supabase';

interface MovimientoRowProps {
  mov: CreditoMovimiento;
  index: number;
  puedeEditar: boolean;
  onCorregir: (mov: CreditoMovimiento) => void;
  onAnular: (mov: CreditoMovimiento) => void;
}

/** Signo tipográfico correcto (U+2212), no el guion del teclado. */
const MENOS = '−';

/** Segunda línea de la fila: fecha · origen/método · autor. */
function detalleLinea(mov: CreditoMovimiento): string {
  const partes = [fechaCorta(mov.fecha)];

  if (mov.tipo === 'abono') {
    partes.push(metodoLabel(mov.metodo));
  } else if (mov.origen === 'factura') {
    partes.push(`Factura ${mov.venta_documento ?? ''}`.trim());
  } else if (mov.origen === 'libre') {
    partes.push('Venta libre');
  }

  partes.push(mov.autor_nombre ?? 'sistema');

  return partes.join(' · ');
}

function MovimientoRowImpl({ mov, index, puedeEditar, onCorregir, onAnular }: MovimientoRowProps): React.ReactElement {
  const { colors, formatUSD } = useTheme();
  const [menuAbierto, setMenuAbierto] = useState(false);

  const esAbono = mov.tipo === 'abono';
  const anulado = !mov.vivo;
  const circuloColor = esAbono ? colors.success : colors.danger;
  const montoColor = esAbono ? colors.success : colors.danger;
  const montoTexto = `${esAbono ? MENOS : '+'}${formatUSD(mov.monto_usd)}`;

  const handleToggleMenu = useCallback(() => setMenuAbierto(prev => !prev), []);
  const handleCorregir = useCallback(() => {
    setMenuAbierto(false);
    onCorregir(mov);
  }, [onCorregir, mov]);
  const handleAnular = useCallback(() => {
    setMenuAbierto(false);
    onAnular(mov);
  }, [onAnular, mov]);

  return (
    <FadeIn delay={staggerDelay(index)}>
      <View style={[styles.row, anulado && styles.rowAnulado]}>
        <View style={[styles.circulo, { backgroundColor: circuloColor + '1A' }]}>
          <Feather name={esAbono ? 'arrow-down-left' : 'arrow-up-right'} size={16} color={circuloColor} />
        </View>

        <View style={styles.centro}>
          <Text style={[styles.concepto, { color: colors.text }]} numberOfLines={2}>
            {mov.concepto}
          </Text>
          <Text style={[styles.detalle, { color: colors.textMuted }]} numberOfLines={1}>
            {detalleLinea(mov)}
          </Text>

          {anulado && (
            <View style={styles.anuladoBlock}>
              <Text style={[styles.anuladoText, { color: colors.warning }]} numberOfLines={2}>
                ANULADO{mov.motivo_anulacion ? ` — ${mov.motivo_anulacion}` : ''}
              </Text>
              {mov.anulado_por_nombre && (
                <Text style={[styles.anuladoText, { color: colors.warning }]} numberOfLines={1}>
                  por {mov.anulado_por_nombre}
                </Text>
              )}
              {mov.corregido_monto != null && (
                <Text style={[styles.anuladoText, { color: colors.warning }]} numberOfLines={1}>
                  CORREGIDO a {formatUSD(mov.corregido_monto)}
                </Text>
              )}
            </View>
          )}
        </View>

        <View style={styles.derecha}>
          <Text
            style={[
              styles.monto,
              { color: montoColor },
              anulado && styles.montoAnulado,
            ]}
            numberOfLines={1}
          >
            {montoTexto}
          </Text>

          {puedeEditar && mov.vivo && (
            <PressableScale
              onPress={handleToggleMenu}
              hitSlop={8}
              activeScale={pressScale.icon}
              style={styles.menuBtn}
            >
              <Feather name="more-vertical" size={16} color={colors.textDim} />
            </PressableScale>
          )}
        </View>
      </View>

      {menuAbierto && (
        <FadeIn>
          <View style={styles.accionesRow}>
            <PressableScale
              onPress={handleCorregir}
              style={[styles.accionBtn, { backgroundColor: colors.surfaceAlt, borderColor: colors.border }]}
            >
              <Feather name="edit-2" size={12} color={colors.text} />
              <Text style={[styles.accionText, { color: colors.text }]}>Corregir</Text>
            </PressableScale>
            <PressableScale
              onPress={handleAnular}
              style={[styles.accionBtn, { backgroundColor: colors.danger + '12', borderColor: colors.danger + '40' }]}
            >
              <Feather name="x-circle" size={12} color={colors.danger} />
              <Text style={[styles.accionText, { color: colors.danger }]}>Anular</Text>
            </PressableScale>
          </View>
        </FadeIn>
      )}
    </FadeIn>
  );
}

// Memo con comparador propio: solo repinta si cambia lo que se ve en la fila.
//
// Los callbacks TIENEN que entrar en la comparación aunque no se dibujen: el
// `handleAnular` del padre cierra sobre el saldo de la cuenta para poder decir
// "el saldo volverá a X". Si lo dejáramos fuera, tras registrar un abono las
// filas conservarían el handler viejo y el diálogo de anulación mostraría el
// saldo anterior — un número falso justo antes de una acción destructiva.
// El historial de una cuenta es corto, así que repintarlo no cuesta nada.
export const MovimientoRow = memo(MovimientoRowImpl, (prev, next) =>
  prev.mov.id === next.mov.id &&
  prev.mov.vivo === next.mov.vivo &&
  prev.mov.monto_usd === next.mov.monto_usd &&
  prev.mov.anulado_por_id === next.mov.anulado_por_id &&
  prev.mov.corregido_por_id === next.mov.corregido_por_id &&
  prev.puedeEditar === next.puedeEditar &&
  prev.onCorregir === next.onCorregir &&
  prev.onAnular === next.onAnular
);

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingVertical: 10,
    gap: 12,
  },
  rowAnulado: {
    opacity: 0.45,
  },
  circulo: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  centro: {
    flex: 1,
    gap: 2,
  },
  concepto: {
    fontSize: scaleFont(13),
    fontFamily: 'JetBrainsMono_500Medium',
  },
  detalle: {
    fontSize: scaleFont(10),
    fontFamily: 'JetBrainsMono_400Regular',
  },
  anuladoBlock: {
    marginTop: 4,
    gap: 1,
  },
  anuladoText: {
    fontSize: scaleFont(9),
    fontFamily: 'JetBrainsMono_700Bold',
  },
  derecha: {
    alignItems: 'flex-end',
    gap: 6,
  },
  monto: {
    fontSize: scaleFont(14),
    fontFamily: 'JetBrainsMono_700Bold',
  },
  montoAnulado: {
    textDecorationLine: 'line-through',
  },
  menuBtn: {
    padding: 4,
  },
  accionesRow: {
    flexDirection: 'row',
    gap: 8,
    marginLeft: 48,
    marginBottom: 8,
  },
  accionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderRadius: 8,
    borderWidth: 0.5,
    paddingVertical: 6,
    paddingHorizontal: 10,
  },
  accionText: {
    fontSize: scaleFont(11),
    fontFamily: 'JetBrainsMono_700Bold',
  },
});
