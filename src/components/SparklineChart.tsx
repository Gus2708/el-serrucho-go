import { View, Text, StyleSheet, Dimensions } from 'react-native';
import { LineChart } from 'react-native-gifted-charts';
import { useTheme } from '../theme/ThemeContext';
import type { ProfitMonthlyRow } from '../hooks/useProfitSummary';
import type { ProfitDailyRow } from '../lib/supabase';

interface Props {
  data:    ProfitMonthlyRow[] | ProfitDailyRow[];
  width?:  number;
  height?: number;
}

const SCREEN_W = Dimensions.get('window').width;

export function SparklineChart({ data, width, height = 70 }: Props) {
  const { colors } = useTheme();
  
  // Neutralize card padding (20) to reach edges
  const paddingToNeutralize = 20;
  const w = (width ?? SCREEN_W - 32); 

  if (!data || !data.length) return <View style={{ height }} />;

  const values  = data.map(d => Math.max(d.ganancia, 0));
  const maxVal  = Math.max(...values, 10);
  const chartData = values.map(v => ({ value: v }));

  // Spacing to go from edge to edge
  const spacing = (w + 4) / (chartData.length - 1 || 1);

  return (
    <View style={[styles.wrap, { marginLeft: -paddingToNeutralize - 2, width: w + 4 }]}>
      <LineChart
        areaChart
        data={chartData}
        width={w + 8}
        height={height}
        maxValue={maxVal * 1.2}
        hideDataPoints
        hideAxesAndRules
        hideYAxisText
        yAxisLabelWidth={0}
        yAxisThickness={0}
        xAxisThickness={0}
        color={colors.primary}
        thickness={4}
        startFillColor={colors.primary}
        endFillColor="transparent"
        startOpacity={0.6}
        endOpacity={0.01}
        curved
        isAnimated={false} // Disabled for stability during debug
        initialSpacing={0}
        endSpacing={0}
        spacing={spacing}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    marginTop: 15,
    marginBottom: -20, // Align exactly to the bottom of the card (counteracting padding)
    overflow: 'visible', // Allow glow to be seen
  },
});
