import * as React from 'react';
import { View, Text, StyleSheet, ActivityIndicator } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '../theme/ThemeContext';
import { scaleFont } from '../theme/responsive';
import { PressableScale } from './PressableScale';
import { useMaxcamConsulta, MaxcamCandidato } from '../hooks/useMaxcamConsulta';

/**
 * "Is this sold-out product available at the supplier (Maxcam, Barquisimeto)?"
 * Manual trigger on purpose: each query hits the supplier's catalog.
 */
export function MaxcamDisponibilidad({ codigoInterno }: { codigoInterno: string }) {
  const { colors, formatUSD } = useTheme();
  const { consultar, reiniciar, consulta, enviando, esperando, vencida, errorEnvio } =
    useMaxcamConsulta(codigoInterno);

  const resultado = consulta?.status === 'listo' ? consulta.resultado : null;
  const falloListener = consulta?.status === 'error';

  return (
    <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      <Text style={[styles.sectionLabel, { color: colors.textMuted }]}>Disponibilidad en Maxcam (BQ)</Text>

      {!consulta && !esperando && !enviando && (
        <>
          <Text style={[styles.hint, { color: colors.textMuted }]}>
            Producto agotado. Consulta si el proveedor lo tiene en Barquisimeto para pedirlo.
          </Text>
          <PressableScale
            style={[styles.btn, { backgroundColor: colors.primaryFaded, borderColor: colors.primary }]}
            onPress={consultar}
          >
            <Feather name="search" size={16} color={colors.primary} />
            <Text style={[styles.btnText, { color: colors.primary }]}>Consultar en Maxcam</Text>
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
            Consultando a Maxcam… puede tardar unos segundos.
          </Text>
        </View>
      )}

      {vencida && (
        <>
          <Text style={[styles.hint, { color: colors.warning }]}>
            Maxcam no respondió a tiempo. Puede que el backend de la tienda esté apagado.
          </Text>
          <RetryButton colors={colors} onPress={reiniciar} />
        </>
      )}

      {falloListener && (
        <>
          <Text style={[styles.hint, { color: colors.danger }]}>
            {consulta?.error ?? 'No se pudo consultar a Maxcam.'}
          </Text>
          <RetryButton colors={colors} onPress={reiniciar} />
        </>
      )}

      {resultado && resultado.candidatos.length === 0 && (
        <>
          <Text style={[styles.hint, { color: colors.textMuted }]}>
            No se encontró un equivalente en el catálogo de Maxcam.
          </Text>
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
          {resultado.candidatos.map((c) => (
            <Candidato key={c.sku} c={c} metodo={resultado.metodo} colors={colors} formatUSD={formatUSD} />
          ))}
          <Text style={[styles.hint, { color: colors.textDim }]}>
            Consultado{' '}
            {new Date(resultado.consultado_en).toLocaleTimeString('es-VE', { hour: '2-digit', minute: '2-digit' })}
            {'  ·  '}Solo cuenta el stock de Barquisimeto.
          </Text>
          <RetryButton colors={colors} onPress={reiniciar} label="Consultar de nuevo" />
        </>
      )}
    </View>
  );
}

function Candidato({ c, metodo, colors, formatUSD }: {
  c: MaxcamCandidato; metodo: 'codigo' | 'similitud'; colors: any; formatUSD: (n: number) => string;
}) {
  const color = c.disponible ? colors.success : colors.danger;
  return (
    <View style={[styles.candidato, { borderColor: colors.border }]}>
      <Text style={[styles.nombre, { color: colors.text }]} numberOfLines={2}>{c.nombre}</Text>
      <Text style={[styles.meta, { color: colors.textMuted }]}>
        SKU {c.sku}
        {metodo === 'similitud' ? `  ·  ${Math.round(c.similitud * 100)}% parecido` : ''}
        {c.precio != null ? `  ·  ${formatUSD(c.precio)}` : ''}
        {c.cant_caja ? `  ·  caja x${c.cant_caja}` : ''}
      </Text>
      <View style={[styles.badge, { backgroundColor: color + '22', borderColor: color + '55' }]}>
        <Text style={[styles.badgeText, { color }]}>
          {c.disponible ? `Disponible · ${c.stock_bq} uds` : 'Agotado en BQ'}
        </Text>
      </View>
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
  candidato:    { borderTopWidth: 0.5, paddingTop: 12, gap: 6 },
  nombre:       { fontSize: scaleFont(14), fontFamily: 'JetBrainsMono_700Bold' },
  meta:         { fontSize: scaleFont(12), fontFamily: 'JetBrainsMono_400Regular' },
  badge:        { alignSelf: 'flex-start', borderRadius: 999, borderWidth: 0.5, paddingVertical: 4, paddingHorizontal: 12 },
  badgeText:    { fontSize: scaleFont(13), fontFamily: 'JetBrainsMono_500Medium' },
});
