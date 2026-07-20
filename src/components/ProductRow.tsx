import { scaleFont } from '../theme/responsive';
import React, { memo, useCallback } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '../theme/ThemeContext';
import { CurrencyText } from './CurrencyText';
import { PressableScale } from './PressableScale';
import { pressScale } from '../theme/motion';
import { isPlaceholder } from '../hooks/useProductos';
import type { Producto } from '../lib/supabase';

interface Props {
  producto: Producto;
  onPress:  (codigo: string) => void;
  bcv?:     number;           // BCV rate for Bs conversion
  markupPct?: number;         // markup % for Bs pricing (default 30)
}

function ProductRowImpl({ producto, onPress, bcv = 0, markupPct = 30 }: Props): React.ReactElement {
  const { colors } = useTheme();
  const { stockColor, stockLabel } = getStockInfo(producto, colors);
  const margin     = getMarginPct(producto);
  const placeholder = isPlaceholder(producto);

  // Stable: handler depends only on the codigo + dispatcher
  const handlePress = useCallback(() => onPress(producto.codigo_interno), [onPress, producto.codigo_interno]);

  // Derived Bs pricing
  const precioMarkup = parseFloat((producto.precio_venta * (1 + markupPct / 100)).toFixed(2));
  const precioBs = bcv > 0 ? precioMarkup * bcv : 0;

  const content = (
    <>
      <View style={[styles.bar, { backgroundColor: stockColor }]} />

      <View style={styles.body}>
        <View style={styles.top}>
          <Text style={[styles.name, { color: colors.text }]} numberOfLines={2}>
            {producto.descripcion}
          </Text>
          <View style={styles.priceStack}>
            <CurrencyText amount={producto.precio_venta} style={styles.price} primary />
            {bcv > 0 && (
              <>
                <Text style={[styles.priceMarkup, { color: colors.textMuted }]} numberOfLines={1} adjustsFontSizeToFit>
                  +{markupPct}% ${precioMarkup.toFixed(2)}
                </Text>
                <Text style={[styles.priceBs, { color: colors.textDim }]} numberOfLines={1} adjustsFontSizeToFit>
                  Bs {precioBs.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </Text>
              </>
            )}
          </View>
        </View>

        <View style={styles.bottom}>
          <Text style={[styles.meta, { color: colors.textMuted }]} numberOfLines={1} adjustsFontSizeToFit>
            {producto.codigo_interno}
            {producto.unidad ? `  ·  ${producto.unidad}` : ''}
            {producto.referencia ? `  ·  Ref: ${producto.referencia}` : ''}
          </Text>

          <View style={styles.badges}>
            <View style={[styles.badge, { backgroundColor: stockColor + '22', borderColor: stockColor + '55' }]}>
              <Text style={[styles.badgeText, { color: stockColor }]} numberOfLines={1} adjustsFontSizeToFit>{stockLabel}</Text>
            </View>
            {margin < 0 && (
              <View style={[styles.badge, { backgroundColor: colors.danger + '22', borderColor: colors.danger + '55' }]}>
                <Text style={[styles.badgeText, { color: colors.danger }]} numberOfLines={1} adjustsFontSizeToFit>
                  Margen {margin.toFixed(0)}%
                </Text>
              </View>
            )}
          </View>
        </View>
      </View>

      <Feather name="chevron-right" size={16} color={colors.textMuted} style={styles.chevron} />
    </>
  );

  // Placeholders (".", "..") are inert — render a dimmed, non-interactive row.
  if (placeholder) {
    return (
      <View
        style={[styles.row, styles.rowPlaceholder, { backgroundColor: colors.surface, borderColor: colors.border }]}
        pointerEvents="none"
      >
        {content}
      </View>
    );
  }

  return (
    <PressableScale
      style={[styles.row, { backgroundColor: colors.surface, borderColor: colors.border }]}
      activeScale={pressScale.row}
      onPress={handlePress}
    >
      {content}
    </PressableScale>
  );
}

// Memo with shallow compare — only re-render if producto reference or onPress reference changes
export const ProductRow = memo(ProductRowImpl, (prev, next) =>
  prev.producto.codigo_interno  === next.producto.codigo_interno &&
  prev.producto.existencia      === next.producto.existencia &&
  prev.producto.precio_venta    === next.producto.precio_venta &&
  prev.producto.costo           === next.producto.costo &&
  prev.producto.descripcion     === next.producto.descripcion &&
  prev.producto.referencia      === next.producto.referencia &&
  prev.onPress                  === next.onPress &&
  prev.bcv                      === next.bcv &&
  prev.markupPct                === next.markupPct
);

function getStockInfo(
  p: Producto,
  colors: { danger: string; warning: string; success: string; textMuted: string }
) {
  if (p.existencia <= 0) return { stockColor: colors.danger,  stockLabel: 'Sin stock' };
  if (p.existencia <= 5) return { stockColor: colors.warning, stockLabel: `${p.existencia} uds` };
  return                        { stockColor: colors.success, stockLabel: `${p.existencia} uds` };
}

function getMarginPct(p: Producto): number {
  if (!p.precio_venta || p.precio_venta === 0) return 0;
  // precio_venta incluye IVA 16%, costo no lo incluye.
  // Comparar manzanas con manzanas: usar precio sin IVA.
  const precioSinIva = p.precio_venta / 1.16;
  return ((precioSinIva - p.costo) / precioSinIva) * 100;
}

const styles = StyleSheet.create({
  row: {
    flexDirection:  'row',
    alignItems:     'center',
    borderRadius:   12,
    borderWidth:    0.5,
    marginHorizontal: 16,
    marginBottom:   8,
    overflow:       'hidden',
  },
  rowPlaceholder: {
    opacity: 0.35,
  },
  bar:    { width: 3, alignSelf: 'stretch' },
  body:   { flex: 1, paddingVertical: 12, paddingHorizontal: 12, gap: 4 },
  top:    { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 },
  name:   { flex: 1, fontSize: scaleFont(14), fontFamily: 'JetBrainsMono_400Regular', lineHeight: scaleFont(19) },
  priceStack: { alignItems: 'flex-end', gap: 1, flexShrink: 0 },
  price:  { fontSize: scaleFont(15), fontFamily: 'JetBrainsMono_700Bold' },
  priceMarkup: { fontSize: scaleFont(10), fontFamily: 'JetBrainsMono_500Medium' },
  priceBs:     { fontSize: scaleFont(10), fontFamily: 'JetBrainsMono_400Regular' },
  bottom: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginTop: 2 },
  meta:   { fontSize: scaleFont(11), flex: 1, fontFamily: 'JetBrainsMono_400Regular' },
  badges: { flexDirection: 'row', gap: 4 },
  badge:  { borderRadius: 999, borderWidth: 0.5, paddingVertical: 2, paddingHorizontal: 7 },
  badgeText: { fontSize: scaleFont(10), fontFamily: 'JetBrainsMono_500Medium' },
  chevron:   { marginRight: 12 },
});
