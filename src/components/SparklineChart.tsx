import { View, Text, StyleSheet, Dimensions } from 'react-native';
import { LineChart } from 'react-native-gifted-charts';
import { LinearGradient } from 'expo-linear-gradient';
import { useTheme } from '../theme/ThemeContext';
import type { ProfitMonthlyRow } from '../hooks/useProfitSummary';
import type { ProfitDailyRow, ProfitHourlyRow } from '../lib/supabase';

interface Props {
  data:    ProfitMonthlyRow[] | ProfitDailyRow[] | ProfitHourlyRow[];
  width?:  number;
  height?: number;
}

const SCREEN_W = Dimensions.get('window').width;

export function SparklineChart({ data, width, height = 70 }: Props) {
  const { colors } = useTheme();
  
  const w = (width ?? SCREEN_W - 32); 

  if (!data || !data.length) return <View style={{ height }} />;

  // Fidelidad a datos: usar EXACTAMENTE los valores que llegan, sin clamp ni
  // smoothing extra. Los valores negativos (pérdidas) se preservan; el chart
  // los baselina al 0 (maxValue lo dimensiona, mostrando la curva real).
  const values    = data.map(d => Number(d.ganancia) || 0);
  const minVal    = Math.min(...values, 0);
  const maxVal    = Math.max(...values, minVal + 1);
  const chartData = values.map(v => ({ value: v }));

  // Spacing simétrico: la línea toca AMBOS bordes del contenedor sin padding.
  // (n-1) intervalos en `w` píxeles → cada intervalo = w/(n-1).
  const spacing = chartData.length > 1 ? w / (chartData.length - 1) : 0;

  return (
    <View style={[styles.wrap, { width: w }]}>
      <LineChart
        data={chartData}
        width={w}
        height={height}
        maxValue={maxVal}
        mostNegativeValue={minVal < 0 ? minVal : undefined}
        hideDataPoints
        hideAxesAndRules
        hideYAxisText
        yAxisLabelWidth={0}
        yAxisThickness={0}
        xAxisThickness={0}
        color={colors.primary}
        thickness={3}
        curved
        isAnimated={false}
        initialSpacing={0}
        endSpacing={0}
        spacing={spacing}
        // ── Gradient fill bajo la línea ──
        areaChart
        startFillColor={colors.primary}
        endFillColor={colors.primary}
        startOpacity={0.35}
        endOpacity={0}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    marginTop: 10,
    overflow: 'hidden',
  },
});
