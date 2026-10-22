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
  const { consultar, reiniciar, consulta, enviando, esperando, vencida, errorEnvio } =
    useConsultaProveedor<C>(p.tabla, p.codigoInterno);

  const resultado = consulta?.status === 'listo' ? consulta.resultado : null;
  const falloListener = consulta?.status === 'error';

  return (
    <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      <Text style={[styles.sectionLabel, { color: colors.textMuted }]}>{p.titulo}</Text>

      {!consulta && !esperando && !enviando && (
        <>
          <Text style={[styles.hint, { color: colors.textMuted }]}>{p.ayuda}</Text>
          <PressableScale
            style={[styles.btn, { backgroundColor: colors.primaryFaded, borderColor: colors.primary }]}
            onPress={consultar}
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
        <View style={styles.row}>
          <ActivityIndicator color={colors.primary} />
          <Text style={[styles.hint, { color: colors.textMuted, flex: 1 }]}>
            Consultando… puede tardar unos segundos.
          </Text>
        </View>
      )}

      {vencida && (
        <>
          <Text style={[styles.hint, { color: colors.warning }]}>
            No hubo respuesta a tiempo. Puede que el backend de la tienda esté apagado.
          </Text>
          <RetryButton colors={colors} onPress={reiniciar} />
        </>
      )}

      {falloListener && (
        <>
          <Text style={[styles.hint, { color: colors.danger }]}>
            {consulta?.error ?? 'No se pudo completar la consulta.'}
          </Text>
          <RetryButton colors={colors} onPress={reiniciar} />
        </>
      )}

      {resultado && resultado.candidatos.length === 0 && (
        <>
          <Text style={[styles.hint, { color: colors.textMuted }]}>{p.sinResultado}</Text>
          <RetryButton colors={colors} onPress={reiniciar} />
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
          <Text style={[styles.hint, { color: colors.textDim }]}>
            Consultado{' '}
            {new Date(resultado.consultado_en).toLocaleTimeString('es-VE', { hour: '2-digit', minute: '2-digit' })}
            {'  ·  '}{p.nota}
          </Text>
          <RetryButton colors={colors} onPress={reiniciar} label="Consultar de nuevo" />
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

function RetryButton({ colors, onPress, label = 'Reintentar' }: { colors: any; onPress: () => void; label?: string }) {
  return (
    <PressableScale
      style={[styles.btn, { backgroundColor: 'transparent', borderColor: colors.border }]}
      onPress={onPress}
    >
      <Feather name="refresh-cw" size={14} color={colors.textMuted} />
      <Text style={[styles.btnText, { color: colors.textMuted }]}>{label}</Text>
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  card:         { borderRadius: 16, borderWidth: 0.5, padding: 16, gap: 12 },
  sectionLabel: { fontSize: scaleFont(12), fontFamily: 'JetBrainsMono_500Medium', textTransform: 'uppercase', letterSpacing: 0.8 },
  hint:         { fontSize: scaleFont(13), fontFamily: 'JetBrainsMono_400Regular', lineHeight: scaleFont(19) },
  row:          { flexDirection: 'row', alignItems: 'center', gap: 12 },
  btn:          { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, borderRadius: 12, borderWidth: 0.5, paddingVertical: 12 },
  btnText:      { fontSize: scaleFont(14), fontFamily: 'JetBrainsMono_700Bold' },
  candidato:    { borderTopWidth: 0.5, paddingTop: 12 },
  fila:         { flexDirection: 'row', gap: 12 },
  texto:        { flex: 1, gap: 6 },
  foto:         { width: 64, height: 64, borderRadius: 10, borderWidth: 0.5, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  fotoImg:      { width: '100%', height: '100%' },
  nombre:       { fontSize: scaleFont(14), fontFamily: 'JetBrainsMono_700Bold' },
  meta:         { fontSize: scaleFont(12), fontFamily: 'JetBrainsMono_400Regular' },
  badge:        { alignSelf: 'flex-start', borderRadius: 999, borderWidth: 0.5, paddingVertical: 4, paddingHorizontal: 12 },
  badgeText:    { fontSize: scaleFont(13), fontFamily: 'JetBrainsMono_500Medium' },
});
