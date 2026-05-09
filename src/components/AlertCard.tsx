import * as React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '../theme/ThemeContext';
import { CurrencyText } from './CurrencyText';
import type { AlertaStockRow, Anomalia } from '../lib/supabase';

// ── Stock alert card (from vw_alertas_stock) ─────────────────────────────────

interface StockAlertProps {
  alerta: AlertaStockRow;
}

export function StockAlertCard({ alerta }: StockAlertProps) {
  const { colors } = useTheme();

  const { icon, accentColor, titulo, detalle } = getStockAlertMeta(alerta, colors);

  return (
    <View style={[styles.card, { backgroundColor: colors.surface, borderColor: accentColor + '55' }]}>
      <View style={[styles.iconBox, { backgroundColor: accentColor + '22' }]}>
        <Feather name={icon} size={18} color={accentColor} />
      </View>
      <View style={styles.body}>
        <Text style={[styles.titulo, { color: colors.text }]} numberOfLines={2}>
          {alerta.descripcion}
        </Text>
        <Text style={[styles.codigo, { color: colors.textMuted }]}>
          {alerta.codigo_interno}
        </Text>
        <View style={styles.metaRow}>
          <TypeChip label={titulo} color={accentColor} />
          <Text style={[styles.detalle, { color: colors.textMuted }]} numberOfLines={1} adjustsFontSizeToFit>{detalle}</Text>
        </View>
      </View>
      <View style={styles.prices}>
        <CurrencyText amount={alerta.precio_venta} style={styles.price} />
        <Text style={[styles.stock, { color: alerta.existencia <= 0 ? colors.danger : colors.textMuted }]}>
          {alerta.existencia} uds
        </Text>
      </View>
    </View>
  );
}

function getStockAlertMeta(
  a: AlertaStockRow,
  colors: { danger: string; warning: string; textMuted: string }
) {
  switch (a.tipo_alerta) {
    case 'sin_stock':
      return {
        icon:        'alert-circle' as const,
        accentColor: colors.warning,
        titulo:      'Sin stock',
        detalle:     'Existencia agotada',
      };
    case 'stock_negativo':
      return {
        icon:        'alert-octagon' as const,
        accentColor: colors.danger,
        titulo:      'Stock negativo',
        detalle:     'Error de inventario · auditar',
      };
    case 'margen_negativo':
      return {
        icon:        'trending-down' as const,
        accentColor: colors.danger,
        titulo:      'Margen negativo',
        detalle:     'Costo > precio venta',
      };
    default: // stock_muerto
      return {
        icon:        'clock' as const,
        accentColor: colors.warning,
        titulo:      'Stock muerto',
        detalle:     'Sin ventas en 90 días',
      };
  }
}

// ── AI anomaly card (from anomalias table) ────────────────────────────────────

interface AnomaliaProps {
  anomalia:  Anomalia;
  onResolve: (id: number) => void;
}

export function AnomaliaCard({ anomalia, onResolve }: AnomaliaProps) {
  const { colors } = useTheme();

  const severityColor = getSeverityColor(anomalia.severidad, colors);

  return (
    <View style={[styles.card, { backgroundColor: colors.surface, borderColor: severityColor + '55' }]}>
      <View style={[styles.iconBox, { backgroundColor: severityColor + '22' }]}>
        <Feather name="cpu" size={18} color={severityColor} />
      </View>
      <View style={styles.body}>
        <Text style={[styles.titulo, { color: colors.text }]} numberOfLines={1}>
          {anomalia.codigo_producto ?? '—'}
        </Text>
        <Text style={[styles.explicacion, { color: colors.textMuted }]} numberOfLines={3}>
          {anomalia.explicacion ?? 'Sin descripción'}
        </Text>
        <View style={styles.metaRow}>
          <TypeChip
            label={`IA · ${anomalia.severidad}`}
            color={severityColor}
          />
          <Text style={[styles.detalle, { color: colors.textDim }]} numberOfLines={1} adjustsFontSizeToFit>
            {formatRelative(anomalia.detectado_en)}
          </Text>
        </View>
      </View>
      <Pressable
        style={({ pressed }) => [styles.resolveBtn, { borderColor: colors.border }, pressed && { opacity: 0.6 }]}
        onPress={() => onResolve(anomalia.id)}
        hitSlop={8}
      >
        <Feather name="check" size={16} color={colors.success} />
      </Pressable>
    </View>
  );
}

// ── Shared helpers ────────────────────────────────────────────────────────────

function TypeChip({ label, color }: { label: string; color: string }) {
  return (
    <View style={[styles.chip, { backgroundColor: color + '22', borderColor: color + '55' }]}>
      <Text style={[styles.chipText, { color }]} numberOfLines={1} adjustsFontSizeToFit>{label}</Text>
    </View>
  );
}

function getSeverityColor(
  sev: 'alta' | 'media' | 'baja',
  colors: { danger: string; warning: string; success: string }
) {
  if (sev === 'alta')  return colors.danger;
  if (sev === 'media') return colors.warning;
  return colors.success;
}

function formatRelative(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins  = Math.floor(diff / 60_000);
  if (mins < 60)    return `hace ${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24)   return `hace ${hours}h`;
  return `hace ${Math.floor(hours / 24)}d`;
}

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  card: {
    flexDirection:    'row',
    alignItems:       'flex-start',
    borderRadius:     12,
    borderWidth:      0.5,
    marginHorizontal: 16,
    marginBottom:     8,
    padding:          12,
    gap:              10,
  },
  iconBox: {
    width:        36,
    height:       36,
    borderRadius: 10,
    alignItems:   'center',
    justifyContent: 'center',
    flexShrink:   0,
  },
  body: {
    flex: 1,
    gap:  3,
  },
  titulo: {
    fontSize:   13,
    fontFamily: 'JetBrainsMono_700Bold',
    lineHeight: 17,
  },
  codigo: {
    fontSize: 11,
    fontFamily: 'JetBrainsMono_400Regular',
  },
  explicacion: {
    fontSize:   12,
    fontFamily: 'JetBrainsMono_400Regular',
    lineHeight: 16,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems:    'center',
    gap:           8,
    marginTop:     2,
  },
  chip: {
    borderRadius:     999,
    borderWidth:      0.5,
    paddingVertical:  2,
    paddingHorizontal: 7,
  },
  chipText: {
    fontSize:   10,
    fontFamily: 'JetBrainsMono_700Bold',
  },
  detalle: {
    fontSize: 11,
    fontFamily: 'JetBrainsMono_400Regular',
  },
  prices: {
    alignItems:  'flex-end',
    gap:          4,
    flexShrink:   0,
  },
  price: {
    fontSize:   13,
    fontFamily: 'JetBrainsMono_700Bold',
  },
  stock: {
    fontSize: 11,
    fontFamily: 'JetBrainsMono_400Regular',
  },
  resolveBtn: {
    width:        32,
    height:       32,
    borderRadius: 8,
    borderWidth:  0.5,
    alignItems:   'center',
    justifyContent: 'center',
    flexShrink:   0,
    marginTop:    2,
  },
});
