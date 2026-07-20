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
        {/* Row 1: Title (left) & Base USD Price (right) */}
        <View style={styles.rowTop}>
          <Text style={[styles.name, { color: colors.text }]} numberOfLines={2}>
            {producto.descripcion}
          </Text>
          <CurrencyText amount={producto.precio_venta} style={styles.priceMain} primary />
        </View>

        {/* Row 2: Code/Meta (left) & Recargo +30% USD (right) */}
        <View style={styles.rowMid}>
          <Text style={[styles.meta, { color: colors.textMuted }]} numberOfLines={1}>
            {producto.codigo_interno}
            {producto.unidad ? `  ·  ${producto.unidad}` : ''}
            {producto.referencia ? `  ·  Ref: ${producto.referencia}` : ''}
          </Text>
          {bcv > 0 && (
            <Text style={[styles.priceRecargo, { color: colors.textMuted }]} numberOfLines={1}>
              +{markupPct}% ${precioMarkup.toFixed(2)}
            </Text>
          )}
        </View>

        {/* Row 3: Stock Badges (left) & Bs BCV Price (right) */}
        <View style={styles.rowBottom}>
          <View style={styles.badges}>
            <View style={[styles.badge, { backgroundColor: stockColor + '1E', borderColor: stockColor + '40' }]}>
              <Text style={[styles.badgeText, { color: stockColor }]} numberOfLines={1}>{stockLabel}</Text>
            </View>
            {margin < 0 && (
              <View style={[styles.badge, { backgroundColor: colors.danger + '1E', borderColor: colors.danger + '40' }]}>
                <Text style={[styles.badgeText, { color: colors.danger }]} numberOfLines={1}>
                  Margen {margin.toFixed(0)}%
                </Text>
              </View>
            )}
          </View>

          {bcv > 0 && (
            <Text style={[styles.priceBs, { color: colors.text }]} numberOfLines={1}>
              Bs {precioBs.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </Text>
          )}
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
    borderRadius:   14,
    borderWidth:    0.5,
    marginHorizontal: 16,
    marginBottom:   10,
    overflow:       'hidden',
  },
  rowPlaceholder: {
    opacity: 0.35,
  },
  bar:        { width: 3.5, alignSelf: 'stretch' },
  body:       { flex: 1, paddingVertical: 12, paddingHorizontal: 14, gap: 6 },
  rowTop:     { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10 },
  name:       { flex: 1, fontSize: scaleFont(14), fontFamily: 'JetBrainsMono_700Bold', lineHeight: scaleFont(19) },
  priceMain:  { fontSize: scaleFont(16), fontFamily: 'JetBrainsMono_700Bold' },
  
  rowMid:     { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  meta:       { flex: 1, fontSize: scaleFont(11), fontFamily: 'JetBrainsMono_400Regular' },
  priceRecargo: { fontSize: scaleFont(11), fontFamily: 'JetBrainsMono_500Medium' },
  
  rowBottom:  { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginTop: 2 },
  badges:     { flexDirection: 'row', alignItems: 'center', gap: 6 },
  badge:      { borderRadius: 6, borderWidth: 0.5, paddingVertical: 2.5, paddingHorizontal: 8 },
  badgeText:  { fontSize: scaleFont(10), fontFamily: 'JetBrainsMono_700Bold' },
  priceBs:    { fontSize: scaleFont(12), fontFamily: 'JetBrainsMono_700Bold', fontVariant: ['tabular-nums'] },
  
  chevron:    { marginRight: 12, opacity: 0.6 },
});
