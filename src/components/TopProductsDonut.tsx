import React from 'react';
import { View, Text, StyleSheet, useWindowDimensions, Platform } from 'react-native';
import { PieChart } from 'react-native-gifted-charts';
import { useTheme } from '../theme/ThemeContext';
import { CurrencyText } from './CurrencyText';
import type { TopProductoRow } from '../lib/supabase';

interface Props {
  data: TopProductoRow[];
  loading?: boolean;
  useUnits?: boolean;
}

export function TopProductsDonut({ data, loading, useUnits }: Props) {
  const { colors, formatUSD } = useTheme();
  const { width: screenWidth } = useWindowDimensions();

  // Tomamos los top 4
  const top4 = data.slice(0, 4);
  const totalValue = top4.reduce((acc, p) => acc + (useUnits ? (p.unidades_vendidas || 0) : (p.ganancia || 0)), 0);
  
  if (loading) {
    return (
      <View style={styles.loading}>
        <Text style={[styles.emptyText, { color: colors.textMuted }]}>Cargando datos...</Text>
      </View>
    );
  }

  if (top4.length === 0) {
    return (
      <View style={styles.empty}>
        <Text style={[styles.emptyText, { color: colors.textMuted }]}>Sin ventas este periodo</Text>
      </View>
    );
  }

  const PALETTE = [
    '#F5B200', // Dorado Base
    '#009DF5', // Azul Eléctrico
    '#F5005E', // Carmesí / Rosa Fuerte
    '#00F552', // Verde Esmeralda Vibrante
  ];

  const pieData = top4.map((p, i) => ({
    value: Math.max(useUnits ? p.unidades_vendidas : p.ganancia, 0.01),
    color: PALETTE[i % PALETTE.length],
    text: p.descripcion,
  }));

  // Background data for the glow - handled per-platform in the JSX
  const glowData = pieData;

  const radius = screenWidth * 0.28;
  const innerRadius = radius * 0.85;

  return (
    <View style={styles.container}>
      {/* Chart Section */}
      <View style={styles.chartContainer}>
        {/* Glow Layers (Background) */}
        <View style={styles.glowLayer}>
          {Platform.OS === 'web' ? (
            <View style={{ filter: 'blur(12px)', opacity: 1 }}>
              <PieChart
                data={glowData}
                donut
                radius={radius + 8}
                innerRadius={innerRadius - 8}
                innerCircleColor="transparent"
                showText={false}
                strokeWidth={0}
              />
            </View>
          ) : (
            <>
              {/* Ultra-smooth High-Impact Dense Glow for Mobile - 12 layers, 2px steps, 30% base opacity */}
              {[...Array(12)].map((_, i) => {
                const step = i + 1;
                const opacityHex = Math.round((0.30 / step) * 255).toString(16).padStart(2, '0');
                return (
                  <View key={`glow-${i}`} style={{ position: 'absolute' }}>
                    <PieChart
                      data={glowData.map(d => ({ ...d, color: d.color + opacityHex }))}
                      donut
                      radius={radius + (step * 2)}
                      innerRadius={innerRadius - (step * 2)}
                      innerCircleColor="transparent"
                      showText={false}
                      strokeWidth={2}
                      strokeColor="transparent"
                    />
                  </View>
                );
              })}
            </>
          )}
        </View>

        {/* Main Layer */}
        <PieChart
          data={pieData}
          donut
          radius={radius}
          innerRadius={innerRadius}
          innerCircleColor={colors.surface}
          centerLabelComponent={() => (
            <View style={styles.centerLabel}>
              <Text style={[styles.centerTotal, { color: colors.text }]}>
                {useUnits ? totalValue.toLocaleString() : formatUSD(totalValue)}
              </Text>
              <Text style={[styles.centerSub, { color: colors.textMuted }]}>
                {useUnits ? 'unidades vendidas' : 'ganancia estrella'}
              </Text>
            </View>
          )}
          showText={false}
          strokeWidth={0}
        />
      </View>

      {/* Grid Section (2x2) */}
      <View style={styles.grid}>
        {top4.map((p, i) => {
          const color = PALETTE[i % PALETTE.length];
          const percentage = totalValue > 0 ? ((useUnits ? p.unidades_vendidas : p.ganancia) / totalValue) * 100 : 0;
          
          return (
            <View key={p.codigo_producto} style={styles.gridItem}>
              <View style={styles.rankBadgeContainer}>
                <View style={[styles.rankBadge, { backgroundColor: color + '20', borderColor: color + '40' }]}>
                  <Text style={[styles.rankText, { color: color }]}>TOP {i + 1}</Text>
                </View>
              </View>

              <View style={styles.itemHeader}>
                <Text style={[styles.itemName, { color: colors.textMuted }]} numberOfLines={1}>
                  {p.descripcion}
                </Text>
                <Text style={[styles.itemValue, { color: colors.text }]}>
                  {useUnits ? `${p.unidades_vendidas} uds` : formatUSD(p.ganancia)}
                </Text>
              </View>
              
              <View style={styles.progressContainer}>
                <View 
                  style={[
                    styles.progressBar, 
                    { backgroundColor: color, width: `${Math.max(percentage, 2)}%` }
                  ]} 
                />
                <View 
                  style={[
                    styles.progressBarBg, 
                    { backgroundColor: color, opacity: 0.1, width: '100%', position: 'absolute' }
                  ]} 
                />
              </View>
              
              <View style={styles.itemFooter}>
                <Text style={[styles.itemPct, { color: color }]}>
                  {percentage.toFixed(0)}% del top 4
                </Text>
              </View>
            </View>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 20,
  },
  glowLayer: {
    position: 'absolute',
    zIndex: -1,
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chartContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    marginVertical: 32,
    position: 'relative',
    height: 220, // Explicit height to avoid clipping
  },
  centerLabel: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  centerTotal: {
    fontSize: 24,
    fontFamily: 'JetBrainsMono_700Bold',
  },
  centerSub: {
    fontSize: 10,
    fontFamily: 'JetBrainsMono_400Regular',
    textTransform: 'uppercase',
    marginTop: 2,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    columnGap: 16,
    rowGap: 24,
    marginTop: 20,
    paddingHorizontal: 12,
    marginBottom: 20,
  },
  gridItem: {
    flex: 1,
    minWidth: '45%',
  },
  rankBadgeContainer: {
    marginBottom: 6,
    flexDirection: 'row',
  },
  rankBadge: {
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 4,
    borderWidth: 0.5,
  },
  rankText: {
    fontSize: 8,
    fontFamily: 'JetBrainsMono_700Bold',
    letterSpacing: 0.5,
  },
  itemHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  itemName: {
    fontSize: 10,
    fontFamily: 'JetBrainsMono_500Medium',
    flex: 1,
    marginRight: 4,
    textTransform: 'uppercase',
  },
  itemValue: {
    fontSize: 11,
    fontFamily: 'JetBrainsMono_700Bold',
  },
  progressContainer: {
    height: 6,
    borderRadius: 3,
    overflow: 'hidden',
    position: 'relative',
  },
  progressBar: {
    height: '100%',
    borderRadius: 3,
  },
  progressBarBg: {
    height: '100%',
  },
  itemFooter: {
    marginTop: 6,
  },
  itemPct: {
    fontSize: 9,
    fontFamily: 'JetBrainsMono_700Bold',
    letterSpacing: 0.5,
  },
  empty: {
    height: 200,
    alignItems: 'center',
    justifyContent: 'center',
  },
  loading: {
    height: 200,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyText: {
    fontSize: 13,
    fontFamily: 'JetBrainsMono_400Regular',
  },
});
