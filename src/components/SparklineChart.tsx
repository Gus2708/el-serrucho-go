import { View, Text, StyleSheet, Dimensions } from 'react-native';
import { LineChart, CurveType } from 'react-native-gifted-charts';
import Svg, { Line as SvgLine, Rect as SvgRect } from 'react-native-svg';
import { LinearGradient } from 'expo-linear-gradient';
import { useTheme } from '../theme/ThemeContext';
import type { ProfitMonthlyRow } from '../hooks/useProfitSummary';
import type { ProfitDailyRow, ProfitHourlyRow } from '../lib/supabase';

interface Props {
  data:    ProfitMonthlyRow[] | ProfitDailyRow[] | ProfitHourlyRow[];
  width?:  number;
  height?: number;
}

const SCREEN_W     = Dimensions.get('window').width;
const TOP_PAD      = 14;        // padding superior — espacio para el peak label
const BOTTOM_PAD   = 18;        // padding inferior — espacio para los time ticks (10pt)
const LABEL_W      = 64;        // ancho del peak badge (con espacio para "$X,XXX.XX")
const LABEL_OFFSET = 16;        // separación visual entre label y dot

/**
 * Sparkline ejecutivo:
 *   - Curva quadratic + curvature baja → suave pero honesto
 *   - Subgrid horizontal (3 lines dashed) en SVG
 *   - Baseline en y=0 dashed más definido
 *   - Peak destacado con dot + valor anotado encima (clamp para evitar clipping)
 *   - Banda "Receso" 1pm-2pm cuando los datos son por hora
 *   - Hour ticks ("8a", "12p", etc.) en el bottom para datos horarios
 */

/** Formato compacto de hora local (12-h con sufijo a/p). */
function formatHour(hour: number): string {
  if (hour === 0)  return '12a';
  if (hour === 12) return '12p';
  if (hour < 12)   return `${hour}a`;
  return `${hour - 12}p`;
}

const DAYS_ES   = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
const MONTHS_ES = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];

/** Formato corto de fecha desde YYYY-MM-DD según contexto. */
function formatDay(diaStr: string, totalPoints: number): string {
  const [y, m, d] = diaStr.split('-').map(Number);
  if (!y || !m || !d) return '';
  const date = new Date(y, m - 1, d);
  if (totalPoints <= 8) {
    // Vista semana → "Lun 4"
    return `${DAYS_ES[date.getDay()]} ${d}`;
  }
  // Vista mes → "4 May"
  return `${d} ${MONTHS_ES[m - 1]}`;
}
export function SparklineChart({ data, width, height = 70 }: Props) {
  const { colors, formatUSD } = useTheme();
  const w = width ?? SCREEN_W - 32;

  if (!data || !data.length) return <View style={{ height }} />;

  // Chart drawing: el wrap mide `height` pero reservamos PAD arriba y abajo
  // para que la curva no toque ni el borde superior (label) ni el inferior
  // (respiración visual con el contenedor).
  const drawH = Math.max(40, height - TOP_PAD - BOTTOM_PAD);

  // Fidelidad de datos.
  const values = data.map(d => Number(d.ganancia) || 0);
  const minVal = Math.min(...values, 0);
  const rawMax = Math.max(...values, minVal + 1);
  const maxVal = rawMax * 1.10;

  const peakIdx  = values.reduce((best, v, i) => (v > values[best] ? i : best), 0);
  const peakVal  = values[peakIdx];
  const showPeak = peakVal > 0 && values.length > 1;

  const chartData = values.map((v, i) => {
    if (i === peakIdx && showPeak) {
      return {
        value:                v,
        dataPointColor:       colors.primary,
        dataPointRadius:      4,
        dataPointInnerColor:  colors.surface,
        dataPointInnerRadius: 1.5,
      };
    }
    return { value: v, hideDataPoint: true };
  });

  const spacing = chartData.length > 1 ? w / (chartData.length - 1) : 0;

  // Posición del peak en coords del wrap.
  const yMin     = minVal < 0 ? minVal : 0;
  const valRange = maxVal - yMin;
  const peakDotY = TOP_PAD + drawH * (1 - (peakVal - yMin) / valRange);
  const peakX    = peakIdx * spacing;
  // Clamp: si el peak está cerca de un borde, mantén el label dentro del card.
  const labelLeft = Math.max(0, Math.min(w - LABEL_W, peakX - LABEL_W / 2));

  const baselineY = drawH * (1 - (0 - yMin) / valRange);
  const subgridYs = [drawH * 0.25, drawH * 0.5, drawH * 0.75];

  // ── Detección de datos horarios + posición del receso 1pm–2pm ──
  const isHourly = 'hora' in (data[0] as any);
  let lunchStartX = -1;
  let lunchEndX   = -1;
  if (isHourly) {
    let idx13 = -1, idx14 = -1;
    data.forEach((d, i) => {
      const hour = new Date((d as any).hora).getHours();
      if (hour === 13 && idx13 === -1) idx13 = i;
      if (hour === 14 && idx14 === -1) idx14 = i;
    });
    if (idx13 !== -1 && idx14 !== -1) {
      lunchStartX = idx13 * spacing;
      lunchEndX   = idx14 * spacing;
    }
  }
  const hasLunch    = lunchStartX !== -1 && lunchEndX > lunchStartX;
  const lunchWidth  = hasLunch ? lunchEndX - lunchStartX : 0;
  const lunchCenter = hasLunch ? lunchStartX + lunchWidth / 2 : 0;

  // ── Time ticks ── (hora para datos horarios, día para datos diarios)
  // Cap a ~5-7 labels. Distribuye uniformemente y siempre incluye el último.
  const isDaily = !isHourly && 'dia' in (data[0] as any);
  const ticks: { idx: number; label: string; x: number }[] = [];
  if ((isHourly || isDaily) && data.length > 1) {
    // Para semana (≤8 días) muestra TODOS; para más, máximo 5 distribuidos.
    const target = isDaily && data.length <= 8 ? data.length : 5;
    const step   = Math.max(1, Math.ceil(data.length / target));
    const seen   = new Set<number>();
    for (let i = 0; i < data.length; i += step) seen.add(i);
    seen.add(data.length - 1);
    Array.from(seen).sort((a, b) => a - b).forEach(idx => {
      const item = data[idx] as any;
      const label = isHourly
        ? formatHour(new Date(item.hora).getHours())
        : formatDay(item.dia, data.length);
      ticks.push({ idx, label, x: idx * spacing });
    });
  }
  // Width de cada label (en 10pt): horas son cortas ("8a"), días más largos ("Lun 4").
  const tickWidth = isDaily ? 40 : 26;

  return (
    <View style={[styles.wrap, { width: w, height }]}>
      {/* SVG: receso (atrás) + subgrid + baseline. */}
      <Svg
        width={w}
        height={drawH}
        style={[styles.gridSvg, { top: TOP_PAD }]}
        pointerEvents="none"
      >
        {/* Banda del receso (1pm–2pm) — dibujada PRIMERO para quedar atrás */}
        {hasLunch && (
          <SvgRect
            x={lunchStartX}
            y={0}
            width={lunchWidth}
            height={drawH}
            fill={colors.textDim}
            opacity={0.18}
          />
        )}
        {/* Subgrid sutil */}
        {subgridYs.map((y, i) => (
          <SvgLine
            key={`grid-${i}`}
            x1={0} x2={w} y1={y} y2={y}
            stroke={colors.border}
            strokeOpacity={0.7}
            strokeWidth={0.5}
            strokeDasharray="3,5"
          />
        ))}
        {/* Baseline en y=0 */}
        <SvgLine
          x1={0} x2={w} y1={baselineY} y2={baselineY}
          stroke={colors.textDim}
          strokeOpacity={0.9}
          strokeWidth={1}
          strokeDasharray="2,3"
        />
      </Svg>

      {/* Chart drawing */}
      <View style={{ marginTop: TOP_PAD }}>
        <LineChart
          data={chartData}
          width={w}
          height={drawH}
          maxValue={maxVal}
          mostNegativeValue={minVal < 0 ? minVal : undefined}

          // ── Línea ──
          color={colors.primary}
          thickness={2}
          curved
          curveType={CurveType.QUADRATIC}
          curvature={0.08}
          isAnimated={false}

          // ── Spacing ──
          initialSpacing={0}
          endSpacing={0}
          spacing={spacing}

          // ── Sin ejes nativos ──
          hideAxesAndRules
          hideYAxisText
          yAxisLabelWidth={0}
          yAxisThickness={0}
          xAxisThickness={0}
          hideDataPoints={false}

          // ── Gradient fill (más visible) ──
          areaChart
          startFillColor={colors.primary}
          endFillColor={colors.primary}
          startOpacity={0.32}
          endOpacity={0.06}
        />
      </View>

      {/* Gradient bleed: continúa el fade del chart bajo el padding inferior
          hasta el borde del card. La línea queda visualmente protegida con
          su BOTTOM_PAD pero el color sigue presente, dándole peso al card. */}
      <LinearGradient
        colors={[colors.primary + '10', colors.primary + '00']}
        style={{
          position: 'absolute',
          left:     0,
          top:      TOP_PAD + drawH,
          width:    w,
          height:   BOTTOM_PAD,
        }}
        pointerEvents="none"
      />

      {/* Time ticks — hora para horario, día para diario. Por encima del
          gradient bleed para que sean legibles. */}
      {ticks.map(({ idx, label, x }) => {
        const left = Math.max(0, Math.min(w - tickWidth, x - tickWidth / 2));
        return (
          <View
            key={`tick-${idx}`}
            pointerEvents="none"
            style={[
              styles.tickItem,
              { left, top: TOP_PAD + drawH + 1, width: tickWidth },
            ]}
          >
            <Text style={[styles.tickText, { color: colors.textDim }]}>
              {label}
            </Text>
          </View>
        );
      })}

      {/* "Receso" label centrado en la banda gris */}
      {hasLunch && (
        <View
          pointerEvents="none"
          style={[
            styles.lunchLabel,
            {
              left:  lunchCenter - 30,
              top:   TOP_PAD + drawH * 0.5 - 6,    // centrado vertical en el chart
              width: 60,
            },
          ]}
        >
          <Text style={[styles.lunchText, { color: colors.textMuted }]}>RECESO</Text>
        </View>
      )}

      {/* Peak label overlay */}
      {showPeak && (
        <View
          pointerEvents="none"
          style={[
            styles.peakBadge,
            {
              left: labelLeft,
              top:  Math.max(0, peakDotY - LABEL_OFFSET),
              width: LABEL_W,
            },
          ]}
        >
          <Text style={[styles.peakText, { color: colors.primary }]} numberOfLines={1}>
            {formatUSD(peakVal)}
          </Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    marginTop: 10,
    overflow:  'visible',
    position:  'relative',
  },
  gridSvg: {
    position: 'absolute',
    left:     0,
  },
  peakBadge: {
    position:        'absolute',
    alignItems:      'center',
    justifyContent:  'center',
    paddingVertical: 1,
  },
  peakText: {
    fontSize:      10,
    fontFamily:    'JetBrainsMono_700Bold',
    letterSpacing: -0.2,
    textAlign:     'center',
  },
  lunchLabel: {
    position:       'absolute',
    alignItems:     'center',
    justifyContent: 'center',
  },
  lunchText: {
    fontSize:      9,
    fontFamily:    'JetBrainsMono_500Medium',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    opacity:       0.85,
  },
  tickItem: {
    position:       'absolute',
    alignItems:     'center',
    justifyContent: 'center',
  },
  tickText: {
    fontSize:      10,                    // ↑ de 8 — mejor legibilidad en móvil
    fontFamily:    'JetBrainsMono_500Medium',
    letterSpacing: 0.4,                   // ↑ de 0.3 — un poco más de aire
    opacity:       0.95,                  // ↑ de 0.85 — sigue sutil pero ya no pálido
  },
});
