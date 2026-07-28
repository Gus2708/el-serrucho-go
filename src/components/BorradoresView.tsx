import * as React from 'react';
import { useCallback, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, ActivityIndicator, RefreshControl } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useQueryClient } from '@tanstack/react-query';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  useReducedMotion,
  withDelay,
  withTiming,
} from 'react-native-reanimated';
import { scaleFont } from '../theme/responsive';
import { useTheme } from '../theme/ThemeContext';
import { timing, staggerDelay } from '../theme/motion';
import { notify, confirm } from '../lib/notify';
import {
  useBorradores,
  borradoresQueryKey,
  eliminarBorrador,
  reanudarBorradorCompra,
  reanudarBorradorPedido,
  BorradorResumen,
  BorradorTipo,
} from '../hooks/useBorradores';
import { PressableScale } from './PressableScale';

interface BorradoresViewProps {
  tipo:      BorradorTipo;
  onResume?: () => void;   // navega al armador tras cargar el borrador
}

const COPY: Record<BorradorTipo, { vacio: string; contraparteLabel: string; prefijo: string }> = {
  pedido: { vacio: 'Sin listas de pedido guardadas', contraparteLabel: 'Cliente',   prefijo: 'PED' },
  compra: { vacio: 'Sin listas de compra guardadas',  contraparteLabel: 'Proveedor', prefijo: 'C' },
};

/**
 * Pestaña "Borradores": las listas que se guardaron a medio armar. Cada una es
 * una fila status='borrador' que el backend ignora, así que se puede retomar y
 * seguir agregando productos sin que nada llegue a HybridLite.
 */
export default function BorradoresView({ tipo, onResume }: BorradoresViewProps): React.JSX.Element {
  const { colors } = useTheme();
  const queryClient = useQueryClient();
  const { data: borradores = [], isLoading, refetch } = useBorradores(tipo);
  const [refreshing, setRefreshing] = useState<boolean>(false);
  const [busyId, setBusyId] = useState<number | null>(null);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await refetch();
    setRefreshing(false);
  }, [refetch]);

  const handleResume = useCallback(async (borrador: BorradorResumen) => {
    setBusyId(borrador.id);
    try {
      if (tipo === 'pedido') {
        await reanudarBorradorPedido(borrador.id);
      } else {
        await reanudarBorradorCompra(borrador.id);
      }
      onResume?.();
    } catch (e: any) {
      notify('Error', e.message ?? 'No se pudo abrir el borrador.');
    } finally {
      setBusyId(null);
    }
  }, [tipo, onResume]);

  const handleDelete = useCallback((borrador: BorradorResumen) => {
    confirm({
      title:       'Descartar borrador',
      message:     `Se eliminará "${borrador.titulo}" con sus ${borrador.itemCount} ítem${borrador.itemCount === 1 ? '' : 's'}.`,
      confirmText: 'Descartar',
      destructive: true,
      onConfirm:   async () => {
        setBusyId(borrador.id);
        try {
          await eliminarBorrador(tipo, borrador.id);
          await queryClient.invalidateQueries({ queryKey: borradoresQueryKey(tipo) });
        } catch (e: any) {
          notify('Error', e.message ?? 'No se pudo descartar el borrador.');
        } finally {
          setBusyId(null);
        }
      },
    });
  }, [tipo, queryClient]);

  if (isLoading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  if (borradores.length === 0) {
    return (
      <View style={styles.center}>
        <Feather name="bookmark" size={32} color={colors.textDim} />
        <Text style={[styles.emptyTitle, { color: colors.textMuted }]}>{COPY[tipo].vacio}</Text>
        <Text style={[styles.emptySub, { color: colors.textDim }]}>
          Arma una lista y toca "Guardar borrador"{'\n'}para terminarla más tarde
        </Text>
      </View>
    );
  }

  return (
    <ScrollView
      contentContainerStyle={styles.scroll}
      showsVerticalScrollIndicator={false}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} colors={[colors.primary]} />
      }
    >
      {borradores.map((borrador, index) => (
        <BorradorCard
          key={borrador.id}
          index={index}
          tipo={tipo}
          borrador={borrador}
          busy={busyId === borrador.id}
          onResume={() => handleResume(borrador)}
          onDelete={() => handleDelete(borrador)}
        />
      ))}
      <View style={{ height: 150 }} />
    </ScrollView>
  );
}

// ── Card ──────────────────────────────────────────────────────────────────────

interface BorradorCardProps {
  tipo:     BorradorTipo;
  borrador: BorradorResumen;
  busy:     boolean;
  index:    number;
  onResume: () => void;
  onDelete: () => void;
}

function BorradorCard({ tipo, borrador, busy, index, onResume, onDelete }: BorradorCardProps): React.JSX.Element {
  const { colors } = useTheme();
  const reduced = useReducedMotion();
  const progress = useSharedValue(0);

  React.useEffect(() => {
    progress.value = withDelay(staggerDelay(index), withTiming(1, timing.enter));
  }, [index, progress]);

  const enterStyle = useAnimatedStyle(() => ({
    opacity: progress.value,
    transform: reduced
      ? []
      : [{ translateY: (1 - progress.value) * 10 }, { scale: 0.96 + progress.value * 0.04 }],
  }));

  const fecha = new Date(borrador.actualizadoEn).toLocaleString('es-VE', {
    day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
  });

  return (
    <Animated.View
      style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }, enterStyle]}
    >
      <View style={styles.cardTop}>
        <Text style={[styles.cardTitle, { color: colors.text }]} numberOfLines={1}>
          {borrador.titulo}
        </Text>
        <View style={[styles.chip, { backgroundColor: colors.textDim + '20', borderColor: colors.border }]}>
          <Feather name="bookmark" size={10} color={colors.textMuted} />
          <Text style={[styles.chipText, { color: colors.textMuted }]}>BORRADOR</Text>
        </View>
      </View>

      <Text style={[styles.cardMeta, { color: colors.textMuted }]} numberOfLines={1} adjustsFontSizeToFit>
        {borrador.itemCount} ítem{borrador.itemCount === 1 ? '' : 's'}
        {'  ·  '}{fecha}
      </Text>

      <Text
        style={[styles.cardContraparte, { color: borrador.contraparte ? colors.text : colors.textDim }]}
        numberOfLines={1}
      >
        {COPY[tipo].contraparteLabel}: {borrador.contraparte ?? 'sin definir'}
      </Text>

      {borrador.nota ? (
        <Text style={[styles.cardNota, { color: colors.textMuted }]} numberOfLines={1}>
          {borrador.nota}
        </Text>
      ) : null}

      <View style={styles.actionRow}>
        <PressableScale onPress={onDelete} disabled={busy} dimmed={busy} style={styles.deleteBtn} hitSlop={6}>
          <Feather name="trash-2" size={13} color={colors.danger} />
          <Text style={[styles.deleteBtnText, { color: colors.danger }]}>Descartar</Text>
        </PressableScale>

        <PressableScale
          onPress={onResume}
          disabled={busy}
          dimmed={busy}
          style={[styles.resumeBtn, { backgroundColor: colors.primary }]}
        >
          {busy ? (
            <ActivityIndicator size="small" color={colors.onPrimary} />
          ) : (
            <>
              <Feather name="edit-2" size={13} color={colors.onPrimary} />
              <Text style={[styles.resumeBtnText, { color: colors.onPrimary }]}>Continuar</Text>
            </>
          )}
        </PressableScale>
      </View>
    </Animated.View>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  scroll: { paddingTop: 12, gap: 8 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, paddingHorizontal: 32 },
  emptyTitle: { fontSize: scaleFont(16), fontFamily: 'JetBrainsMono_700Bold', textAlign: 'center' },
  emptySub:   { fontSize: scaleFont(12), fontFamily: 'JetBrainsMono_400Regular', textAlign: 'center', lineHeight: scaleFont(18) },

  card: {
    marginHorizontal: 16,
    borderRadius:     12,
    borderWidth:      0.5,
    padding:          14,
    gap:              4,
  },
  cardTop: {
    flexDirection:  'row',
    alignItems:     'center',
    justifyContent: 'space-between',
    gap:            8,
  },
  cardTitle:       { flex: 1, fontSize: scaleFont(14), fontFamily: 'JetBrainsMono_700Bold' },
  cardMeta:        { fontSize: scaleFont(11), fontFamily: 'JetBrainsMono_400Regular', marginTop: 2 },
  cardContraparte: { fontSize: scaleFont(12), fontFamily: 'JetBrainsMono_400Regular' },
  cardNota:        { fontSize: scaleFont(11), fontFamily: 'JetBrainsMono_400Regular' },

  chip: {
    flexDirection:     'row',
    alignItems:        'center',
    gap:               4,
    borderRadius:      999,
    borderWidth:       0.5,
    paddingVertical:   3,
    paddingHorizontal: 8,
  },
  chipText: { fontSize: scaleFont(9), fontFamily: 'JetBrainsMono_700Bold', letterSpacing: 0.3 },

  actionRow: {
    flexDirection:  'row',
    alignItems:     'center',
    justifyContent: 'space-between',
    marginTop:      10,
  },
  deleteBtn:     { flexDirection: 'row', alignItems: 'center', gap: 5, paddingVertical: 4 },
  deleteBtnText: { fontSize: scaleFont(11), fontFamily: 'JetBrainsMono_700Bold' },
  resumeBtn: {
    flexDirection:     'row',
    alignItems:        'center',
    justifyContent:    'center',
    gap:               6,
    borderRadius:      999,
    paddingVertical:   8,
    paddingHorizontal: 16,
  },
  resumeBtnText: { fontSize: scaleFont(11), fontFamily: 'JetBrainsMono_700Bold' },
});
