import { scaleFont } from '../theme/responsive';
import React, { useMemo } from 'react';
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
  viewMode?: 'dia' | 'ayer' | 'semana' | 'mes';
}

interface Tick {
  idx:   number;
  label: string;
  x:     number;
}

interface ChartModel {
  drawH:       number;
  chartData:   { value: number; hideDataPoint?: boolean; dataPointColor?: string; dataPointRadius?: number; dataPointInnerColor?: string; dataPointInnerRadius?: number }[];
  spacing:     number;
  maxVal:      number;
  minVal:      number;
  baselineY:   number;
  subgridYs:   number[];
  hasLunch:    boolean;
  lunchStartX: number;
  lunchWidth:  number;
  lunchCenter: number;
  ticks:       Tick[];
  tickWidth:   number;
  showPeak:    boolean;
  peakVal:     number;
  peakDotY:    number;
  labelLeft:   number;
}

const SCREEN_W     = Dimensions.get('window').width;
const MIN_CHART_W  = 260;   // piso: un ancho 0 o negativo produce <svg width="-32"> y el navegador lo rechaza
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
 *
 * Rendimiento: toda la geometría se computa una sola vez en un `useMemo`, y el
 * componente está envuelto en `React.memo`. Esto evita reconstruir el path SVG
 * de gifted-charts en cada render del dashboard (p. ej. durante el scroll).
 */

/** Extrae de forma segura la hora como entero (0–23) desde timestamps ISO, "HH:MM", cadenas numéricas o números. */
export function parseHour(hora: unknown): number {
  if (typeof hora === 'number') {
    return isNaN(hora) ? 0 : Math.max(0, Math.min(23, Math.floor(hora)));
  }
  if (!hora || typeof hora !== 'string') return 0;
  const trimmed = hora.trim();
  if (/^\d{1,2}$/.test(trimmed)) {
    const val = parseInt(trimmed, 10);
    return isNaN(val) ? 0 : Math.max(0, Math.min(23, val));
  }
  const tMatch = trimmed.match(/[T ](\d{1,2}):/);
  if (tMatch) {
    const val = parseInt(tMatch[1], 10);
    return isNaN(val) ? 0 : Math.max(0, Math.min(23, val));
  }
  const colonMatch = trimmed.match(/^(\d{1,2}):/);
  if (colonMatch) {
    const val = parseInt(colonMatch[1], 10);
    return isNaN(val) ? 0 : Math.max(0, Math.min(23, val));
  }
  const d = new Date(trimmed);
  const h = d.getHours();
  return isNaN(h) ? 0 : h;
}

/** Formato compacto de hora local (12-h con sufijo a/p). */
function formatHour(hour: number): string {
  if (isNaN(hour)) return '12a';
  if (hour === 0 || hour === 24) return '12a';
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

/** Construye toda la geometría del chart. Devuelve null si no hay datos. */
function buildModel(
  data: Props['data'],
  w: number,
  height: number,
  primary: string,
  surface: string,
): ChartModel | null {
  if (!data || !data.length) return null;

  // El wrap mide `height` pero reservamos PAD arriba y abajo para que la curva
  // no toque ni el borde superior (label) ni el inferior (respiración visual).
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
        dataPointColor:       primary,
        dataPointRadius:      4,
        dataPointInnerColor:  surface,
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
  const isHourly = data.length > 0 && 'hora' in (data[0] as any);
  let lunchStartX = -1;
  let lunchEndX   = -1;
  if (isHourly) {
    let idx13 = -1, idx14 = -1;
    data.forEach((d, i) => {
      const hour = parseHour((d as any).hora);
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

  // ── Time ticks ── (hora para datos horarios, día para diario)
  const isDaily = !isHourly && data.length > 0 && 'dia' in (data[0] as any);
  const ticks: Tick[] = [];
  const tickWidth = isDaily ? 38 : 28;

  if (isHourly && data.length > 1) {
    // 5 hitos canónicos limpios a lo largo de las 24 horas: 12a, 6a, 12p, 6p, 11p
    const milestoneHours = [0, 6, 12, 18, 23];
    milestoneHours.forEach((targetH) => {
      const idx = data.findIndex((d) => parseHour((d as any).hora) === targetH);
      if (idx !== -1) {
        ticks.push({
          idx,
          label: formatHour(targetH),
          x: idx * spacing,
        });
      }
    });
  } else if (isDaily && data.length > 1) {
    if (data.length <= 8) {
      // Vista semanal: cada día
      data.forEach((d, idx) => {
        ticks.push({
          idx,
          label: formatDay((d as any).dia, data.length),
          x: idx * spacing,
        });
      });
    } else {
      // Vista mensual (30 días): 5 marcas uniformes
      const step = Math.floor((data.length - 1) / 4);
      const sampleIndices = [0, step, step * 2, step * 3, data.length - 1];
      sampleIndices.forEach((idx) => {
        if (data[idx]) {
          ticks.push({
            idx,
            label: formatDay((data[idx] as any).dia, data.length),
            x: idx * spacing,
          });
        }
      });
    }
  }

  return {
    drawH,
    chartData,
    spacing,
    maxVal,
    minVal,
    baselineY,
    subgridYs,
    hasLunch,
    lunchStartX,
    lunchWidth,
    lunchCenter,
    ticks,
    tickWidth,
    showPeak,
    peakVal,
    peakDotY,
    labelLeft,
  };
}

function SparklineChartBase({ data, width, height = 70, viewMode }: Props) {
  const { colors, formatUSD } = useTheme();
  const w = Math.max(MIN_CHART_W, width ?? SCREEN_W - 32);

  // ── Detección de Día No Laborable (Domingo) ──
  const isNonWorking = useMemo(() => {
    if (viewMode === 'dia') return new Date().getDay() === 0;
    if (viewMode === 'ayer') {
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      return yesterday.getDay() === 0;
    }
    if (data && data.length > 0 && 'hora' in data[0]) {
      const horaVal = (data[0] as any).hora;
      if (typeof horaVal === 'string' && horaVal.includes('-')) {
        const d = new Date(horaVal);
        return !isNaN(d.getTime()) && d.getDay() === 0;
      }
    }
    return false;
  }, [data, viewMode]);

  // Toda la geometría se computa una sola vez por cambio de datos/dimensiones.
  const model = useMemo(
    () => buildModel(data, w, height, colors.primary, colors.surface),
    [data, w, height, colors.primary, colors.surface],
  );

  if (!model) {
    return (
      <View style={[styles.wrap, { width: w, height }]}>
        {isNonWorking && (
          <View style={styles.nonWorkingOverlay} pointerEvents="none">
            <Text style={[styles.nonWorkingText, { color: colors.textMuted }]}>
              DÍA NO LABORABLE
            </Text>
          </View>
        )}
      </View>
    );
  }

  const {
    drawH, chartData, spacing, maxVal, minVal, baselineY, subgridYs,
    hasLunch, lunchStartX, lunchWidth, lunchCenter, ticks, tickWidth,
    showPeak, peakVal, peakDotY, labelLeft,
  } = model;

  return (
    <View style={[styles.wrap, { width: w, height }]}>
      {/* Non-working day overlay */}
      {isNonWorking && (
        <View style={styles.nonWorkingOverlay} pointerEvents="none">
          <Text style={[styles.nonWorkingText, { color: colors.textMuted }]}>
            DÍA NO LABORABLE
          </Text>
        </View>
      )}

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
          thickness={2.5}
          curved
          curveType={CurveType.CUBIC}
          curvature={0.2}
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
          disableScroll
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
            <Text style={[styles.tickText, { color: colors.textMuted }]}>
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

/**
 * `React.memo`: el dashboard re-renderiza con frecuencia (refetch en background,
 * cambio de período). Sin memo, cada render reconstruye el path SVG de
 * gifted-charts. La comparación shallow por defecto basta: `data` es una
 * referencia estable del cache de TanStack Query y solo cambia con datos nuevos.
 */
export const SparklineChart = React.memo(SparklineChartBase);

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
    fontSize:      scaleFont(10),
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
    fontSize:      scaleFont(9),
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
    fontSize:      scaleFont(10),                    // ↑ de 8 — mejor legibilidad en móvil
    fontFamily:    'JetBrainsMono_500Medium',
    letterSpacing: 0.4,                   // ↑ de 0.3 — un poco más de aire
    opacity:       0.95,                  // ↑ de 0.85 — sigue sutil pero ya no pálido
  },
  nonWorkingOverlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 200,
    top: TOP_PAD,
    height: 40, // Centered in the drawing area
  },
  nonWorkingText: {
    fontSize: scaleFont(12),
    fontFamily: 'JetBrainsMono_700Bold',
    letterSpacing: 2,
    opacity: 0.6,
    textTransform: 'uppercase',
  },
});
