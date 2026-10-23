import * as React from 'react';
import { View, Text, StyleSheet, ActivityIndicator } from 'react-native';
import { Image } from 'expo-image';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '../theme/ThemeContext';
import { scaleFont } from '../theme/responsive';
import { PressableScale } from './PressableScale';
import { useConsultaProveedor, TablaConsulta } from '../hooks/useConsultaProveedor';

type CandidatoBase = {
  sku:        string;
  nombre:     string;
  similitud:  number;
  disponible: boolean;
  precio:     number | null;
};

type Props<C extends CandidatoBase> = {
  tabla:         TablaConsulta;
  codigoInterno: string;
  titulo:        string;
  ayuda:         string;                 // text shown before the first query
  nota:          string;                 // footnote under the results
  sinResultado:  string;                 // text when the supplier has no equivalent
  badge:         (c: C) => string;       // availability label of one candidate
  detalle?:      (c: C) => string;       // extra line parts (box size, minimum sale...)
  imagenes?:     (c: C) => string[];     // photo URLs to try in order; never stored by us
};

/**
 * "Is this sold-out product available at a supplier?" Manual trigger on purpose: every
 * query hits the supplier's catalog. One instance per supplier.
 */
export function ProveedorDisponibilidad<C extends CandidatoBase>(p: Props<C>) {
  const { colors, formatUSD } = useTheme();
  const { consultar, reintentar, consulta, enviando, esperando, vencida, errorEnvio } =
    useConsultaProveedor<C>(p.tabla, p.codigoInterno);

  const resultado = consulta?.status === 'listo' ? consulta.resultado : null;
  const falloListener = consulta?.status === 'error';

  return (
    <View
      testID="proveedor-disponibilidad"
      style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}
    >
      <Text style={[styles.sectionLabel, { color: colors.textMuted }]}>{p.titulo}</Text>

      {!consulta && !esperando && !enviando && (
        <>
          <Text style={[styles.hint, { color: colors.textMuted }]}>{p.ayuda}</Text>
          <PressableScale
            style={[styles.btn, { backgroundColor: colors.primaryFaded, borderColor: colors.primary }]}
            onPress={consultar}
            accessibilityRole="button"
            accessibilityLabel="Consultar"
          >
            <Feather name="search" size={16} color={colors.primary} />
            <Text style={[styles.btnText, { color: colors.primary }]}>Consultar</Text>
          </PressableScale>
          {errorEnvio && (
            <Text style={[styles.hint, { color: colors.danger }]}>
              No se pudo enviar la consulta. Intenta de nuevo.
            </Text>
          )}
        </>
      )}

      {(enviando || esperando) && !vencida && (
        <ProgresoConsulta status={consulta?.status} colors={colors} />
      )}

      {vencida && (
        <>
          <Text style={[styles.hint, { color: colors.warning }]}>
            No hubo respuesta a tiempo. Puede que el backend de la tienda esté apagado.
          </Text>
          <RetryButton colors={colors} onPress={reintentar} />
        </>
      )}

      {falloListener && (
        <>
          <Text style={[styles.hint, { color: colors.danger }]}>
            {consulta?.error ?? 'No se pudo completar la consulta.'}
          </Text>
          <RetryButton colors={colors} onPress={reintentar} />
        </>
      )}

      {resultado && resultado.candidatos.length === 0 && (
        <>
          <Text style={[styles.hint, { color: colors.textMuted }]}>{p.sinResultado}</Text>
          <RetryButton colors={colors} onPress={reintentar} />
        </>
      )}

      {resultado && resultado.candidatos.length > 0 && (
        <>
          {resultado.metodo === 'similitud' && (
            <Text style={[styles.hint, { color: colors.warning }]}>
              Posibles equivalentes por parecido. Verifica que sea el mismo producto antes de pedir.
            </Text>
          )}
          {resultado.candidatos.map((c) => {
            const color = c.disponible ? colors.success : colors.danger;
            const extra = [
              `SKU ${c.sku}`,
              resultado.metodo === 'similitud' ? `${Math.round(c.similitud * 100)}% parecido` : null,
              c.precio != null ? formatUSD(c.precio) : null,
              p.detalle?.(c) || null,
            ].filter(Boolean).join('  ·  ');
            return (
              <View key={c.sku} style={[styles.candidato, { borderColor: colors.border }]}>
                <View style={styles.fila}>
                  <Foto urls={p.imagenes?.(c) ?? []} colors={colors} />
                  <View style={styles.texto}>
                    <Text style={[styles.nombre, { color: colors.text }]} numberOfLines={2}>{c.nombre}</Text>
                    <Text style={[styles.meta, { color: colors.textMuted }]}>{extra}</Text>
                    <View style={[styles.badge, { backgroundColor: color + '22', borderColor: color + '55' }]}>
                      <Text style={[styles.badgeText, { color }]}>{p.badge(c)}</Text>
                    </View>
                  </View>
                </View>
              </View>
            );
          })}
          <Text style={[styles.hint, { color: colors.textMuted }]}>
            Consultado{' '}
            {new Date(resultado.consultado_en).toLocaleTimeString('es-VE', { hour: '2-digit', minute: '2-digit' })}
            {'  ·  '}{p.nota}
          </Text>
          <RetryButton colors={colors} onPress={reintentar} label="Consultar de nuevo" />
        </>
      )}
    </View>
  );
}

/**
 * Photo of a suggested product, loaded straight from the supplier's server. Disposable on
 * purpose: cachePolicy "none" so the app keeps no copy, and nothing is uploaded anywhere.
 * `urls` are alternatives tried in order (the supplier's file extension varies); when all
 * fail, or there are none, a placeholder icon is shown.
 */
function Foto({ urls, colors }: { urls: string[]; colors: any }) {
  const [idx, setIdx] = React.useState(0);
  const uri = urls[idx];
  return (
    <View style={[styles.foto, { borderColor: colors.border }]}>
      {uri ? (
        <Image
          source={{ uri }}
          style={styles.fotoImg}
          contentFit="contain"
          cachePolicy="none"
          onError={() => setIdx((i) => i + 1)}
        />
      ) : (
        <Feather name="image" size={20} color={colors.textDim} />
      )}
    </View>
  );
}

type EstadoConsulta = 'pendiente' | 'procesando' | 'listo' | 'error';

type Etapa = { texto: string; desde: number; hasta: number; tauSeg: number };

/**
 * The listener only reports pendiente -> procesando -> listo, so progress is driven by
 * that real status: each stage fills its own band of the bar and eases towards its end
 * (it never reaches 100% until the answer arrives and the card switches to the result).
 */
const ETAPAS: Record<'enviando' | 'pendiente' | 'procesando', Etapa> = {
  enviando:   { texto: 'Enviando la consulta…',                       desde: 0,  hasta: 10, tauSeg: 1.5 },
  pendiente:  { texto: 'Esperando a que la tienda tome la consulta…', desde: 10, hasta: 25, tauSeg: 3 },
  procesando: { texto: 'La tienda está consultando al proveedor…',    desde: 25, hasta: 95, tauSeg: 12 },
};
const TICK_MS = 250;

function etapaDe(status?: EstadoConsulta): keyof typeof ETAPAS {
  if (status === 'pendiente') return 'pendiente';
  if (status === 'procesando') return 'procesando';
  return 'enviando';
}

function porcentaje(etapa: Etapa, segundos: number): number {
  const avance = 1 - Math.exp(-segundos / etapa.tauSeg);
  return Math.max(1, Math.round(etapa.desde + (etapa.hasta - etapa.desde) * avance));
}

function ProgresoConsulta({ status, colors }: { status?: EstadoConsulta; colors: any }): React.ReactElement {
  const clave = etapaDe(status);
  const etapa = ETAPAS[clave];
  const [segundos, setSegundos] = React.useState(0);

  React.useEffect(() => {
    setSegundos(0); // each stage starts filling its band from the beginning
    const inicio = Date.now();
    const timer = setInterval(() => setSegundos((Date.now() - inicio) / 1000), TICK_MS);
    return () => clearInterval(timer);
  }, [clave]);

  const pct = porcentaje(etapa, segundos);

  return (
    <View style={styles.progressContainer}>
      <View style={styles.row}>
        <ActivityIndicator size="small" color={colors.primary} />
        <Text style={[styles.hint, { color: colors.textMuted, flex: 1 }]}>
          Consultando… puede tardar unos segundos.
        </Text>
        <Text style={[styles.timerBadge, { color: colors.textMuted }]}>{`${pct}%`}</Text>
      </View>
      <View style={[styles.progressBarBg, { backgroundColor: colors.border }]}>
        <View style={[styles.progressBarFill, { width: `${pct}%`, backgroundColor: colors.primary }]} />
      </View>
      <Text style={[styles.stageHint, { color: colors.textMuted }]}>{etapa.texto}</Text>
    </View>
  );
}

function RetryButton({ colors, onPress, label = 'Reintentar' }: { colors: any; onPress: () => void; label?: string }) {
  return (
    <PressableScale
      style={[styles.btn, { backgroundColor: 'transparent', borderColor: colors.border }]}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      <Feather name="refresh-cw" size={14} color={colors.textMuted} />
      <Text style={[styles.btnText, { color: colors.textMuted }]}>{label}</Text>
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  card:         { marginHorizontal: 16, borderRadius: 14, borderWidth: 0.5, padding: 16, gap: 12 },
  sectionLabel: { fontSize: scaleFont(12), fontFamily: 'JetBrainsMono_500Medium', textTransform: 'uppercase', letterSpacing: 0.8 },
  hint:         { fontSize: scaleFont(13), fontFamily: 'JetBrainsMono_400Regular', lineHeight: scaleFont(19) },
  row:          { flexDirection: 'row', alignItems: 'center', gap: 12 },
  progressContainer: { gap: 8 },
  progressBarBg:    { height: 4, borderRadius: 2, overflow: 'hidden', width: '100%' },
  progressBarFill:  { height: '100%', borderRadius: 2 },
  stageHint:        { fontSize: scaleFont(12), fontFamily: 'JetBrainsMono_400Regular' },
  timerBadge:       { fontSize: scaleFont(12), fontFamily: 'JetBrainsMono_500Medium' },
  btn:          { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, borderRadius: 12, borderWidth: 0.5, paddingVertical: 12, minHeight: 44 },
  btnText:      { fontSize: scaleFont(14), fontFamily: 'JetBrainsMono_700Bold' },
  candidato:    { borderTopWidth: 0.5, paddingTop: 12 },
  fila:         { flexDirection: 'row', gap: 12 },
  texto:        { flex: 1, gap: 6 },
  foto:         { width: 64, height: 64, borderRadius: 10, borderWidth: 0.5, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  fotoImg:      { width: '100%', height: '100%' },
  nombre:       { fontSize: scaleFont(14), fontFamily: 'JetBrainsMono_700Bold' },
  meta:         { fontSize: scaleFont(12), fontFamily: 'JetBrainsMono_400Regular' },
  badge:        { alignSelf: 'flex-start', maxWidth: '100%', borderRadius: 999, borderWidth: 0.5, paddingVertical: 4, paddingHorizontal: 12 },
  badgeText:    { fontSize: scaleFont(13), fontFamily: 'JetBrainsMono_500Medium' },
});
