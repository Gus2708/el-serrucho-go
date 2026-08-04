import { scaleFont } from '../../src/theme/responsive';
import * as React from 'react';
import { useState, useCallback, useMemo } from 'react';
import { View, Text, StyleSheet, ScrollView, ActivityIndicator, RefreshControl } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '../../src/theme/ThemeContext';
import { useCreditoCuenta, useCreditoMovimientos } from '../../src/hooks/useCreditos';
import { useAnularMovimiento, useCerrarCuenta, useReabrirCuenta } from '../../src/hooks/useCreditoMutations';
import { useUserRole, isPrivilegedRole } from '../../src/hooks/useUserRole';
import { saldoEstado } from '../../src/lib/creditos';
import { confirm, notify } from '../../src/lib/notify';
import { PressableScale } from '../../src/components/PressableScale';
import { FadeIn } from '../../src/components/FadeIn';
import { pressScale } from '../../src/theme/motion';
import { SaldoHero } from '../../src/components/creditos/SaldoHero';
import { MovimientoRow } from '../../src/components/creditos/MovimientoRow';
import AbonoSheet from '../../src/components/creditos/AbonoSheet';
import NuevoCargoSheet from '../../src/components/creditos/NuevoCargoSheet';
import CorregirMovimientoSheet from '../../src/components/creditos/CorregirMovimientoSheet';
import type { CreditoMovimiento } from '../../src/lib/supabase';

const MOTIVO_ANULACION_DEFAULT = 'Anulado desde la app';

/** "AGOSTO 2026" — encabezado de grupo mensual del historial. */
function nombreMes(fecha: string): string {
  const d = new Date(`${fecha.slice(0, 10)}T12:00:00`);
  return d.toLocaleDateString('es-VE', { month: 'long', year: 'numeric' }).toUpperCase();
}

interface GrupoMes {
  clave: string;
  titulo: string;
  movimientos: CreditoMovimiento[];
}

/** Agrupa el historial (ya filtrado de anulaciones) por mes calendario. */
function agruparPorMes(movimientos: CreditoMovimiento[]): GrupoMes[] {
  const mapa = new Map<string, GrupoMes>();

  for (const mov of movimientos) {
    const clave = mov.fecha.slice(0, 7); // YYYY-MM
    if (!mapa.has(clave)) {
      mapa.set(clave, { clave, titulo: nombreMes(mov.fecha), movimientos: [] });
    }
    mapa.get(clave)!.movimientos.push(mov);
  }

  return Array.from(mapa.values());
}

export default function CreditoDetalle(): React.ReactElement {
  const { colors, formatUSD } = useTheme();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const cuentaId = Number(id);
  const idInvalido = Number.isNaN(cuentaId);

  const [abonoVisible, setAbonoVisible] = useState(false);
  const [cargoVisible, setCargoVisible] = useState(false);
  const [movimientoACorregir, setMovimientoACorregir] = useState<CreditoMovimiento | null>(null);

  const { data: userAuth } = useUserRole();
  const puedeEditar = isPrivilegedRole(userAuth?.role);

  const {
    data: cuenta,
    isLoading: isLoadingCuenta,
    isRefetching: isRefetchingCuenta,
    refetch: refetchCuenta,
  } = useCreditoCuenta(idInvalido ? null : cuentaId);

  const {
    data: movimientos = [],
    isLoading: isLoadingMovs,
    isRefetching: isRefetchingMovs,
    refetch: refetchMovs,
  } = useCreditoMovimientos(idInvalido ? null : cuentaId);

  const anularMovimiento = useAnularMovimiento();
  const cerrarCuenta = useCerrarCuenta();
  const reabrirCuenta = useReabrirCuenta();

  const isLoading = isLoadingCuenta || isLoadingMovs;
  const isRefetching = isRefetchingCuenta || isRefetchingMovs;

  // Las anulaciones no son eventos propios del timeline — su información ya
  // vive en la fila original vía anulado_por_id/motivo_anulacion.
  const movimientosVisibles = useMemo(
    () => movimientos.filter(m => m.reversa_de_id === null),
    [movimientos]
  );

  const grupos = useMemo(() => agruparPorMes(movimientosVisibles), [movimientosVisibles]);

  const handleRefresh = useCallback(() => {
    refetchCuenta();
    refetchMovs();
  }, [refetchCuenta, refetchMovs]);

  const handleCorregir = useCallback((mov: CreditoMovimiento) => {
    setMovimientoACorregir(mov);
  }, []);

  const handleAnular = useCallback((mov: CreditoMovimiento) => {
    if (!cuenta) return;

    const saldoResultante = mov.tipo === 'abono'
      ? cuenta.saldo + mov.monto_usd
      : cuenta.saldo - mov.monto_usd;

    const queEs = mov.tipo === 'abono' ? 'abono' : 'cargo';

    confirm({
      title: '¿Anular este movimiento?',
      message: `Se anulará el ${queEs} de ${formatUSD(mov.monto_usd)}. Quedará en el historial como anulado y el saldo volverá a ${formatUSD(saldoResultante)}.`,
      confirmText: 'Anular',
      destructive: true,
      onConfirm: () => {
        anularMovimiento.mutate(
          { movimiento_id: mov.id, motivo: MOTIVO_ANULACION_DEFAULT, cuenta_id: cuenta.id },
          {
            onSuccess: () => notify('Listo', 'El movimiento quedó anulado.'),
            onError: (e: Error) => notify('Error', e.message),
          }
        );
      },
    });
  }, [cuenta, anularMovimiento, formatUSD]);

  const handleMenuCuenta = useCallback(() => {
    if (!cuenta) return;

    if (cuenta.estado === 'activa') {
      if (saldoEstado(cuenta.saldo) !== 'al_dia') {
        notify('No se puede cerrar', 'Esta cuenta todavía tiene saldo. Salda la cuenta primero.');
        return;
      }
      confirm({
        title: 'Cerrar cuenta',
        message: `${cuenta.nombre} quedará marcada como cerrada. Podrás reabrirla más adelante si hace falta.`,
        confirmText: 'Cerrar cuenta',
        onConfirm: () => {
          cerrarCuenta.mutate(cuenta.id, {
            onSuccess: () => notify('Listo', 'La cuenta quedó cerrada.'),
            onError: (e: Error) => notify('Error', e.message),
          });
        },
      });
      return;
    }

    confirm({
      title: 'Reabrir cuenta',
      message: `${cuenta.nombre} volverá a estar activa.`,
      confirmText: 'Reabrir cuenta',
      onConfirm: () => {
        reabrirCuenta.mutate(cuenta.id, {
          onSuccess: () => notify('Listo', 'La cuenta quedó activa de nuevo.'),
          onError: (e: Error) => notify('Error', e.message),
        });
      },
    });
  }, [cuenta, cerrarCuenta, reabrirCuenta]);

  if (idInvalido) {
    return (
      <SafeAreaView style={[styles.root, { backgroundColor: colors.bg }]} edges={['top']}>
        <StatusBar style="light" />
        <View style={styles.center}>
          <Feather name="alert-circle" size={28} color={colors.danger} />
          <Text style={[styles.errorText, { color: colors.danger }]}>Cuenta no válida</Text>
          <PressableScale
            onPress={() => router.back()}
            style={[styles.volverBtn, { backgroundColor: colors.primaryFaded, borderColor: colors.primary }]}
          >
            <Text style={[styles.volverBtnText, { color: colors.primary }]}>Volver</Text>
          </PressableScale>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={[styles.root, { backgroundColor: colors.bg }]} edges={['top']}>
      <StatusBar style="light" />

      {/* Header */}
      <View style={[styles.nav, { borderColor: colors.border }]}>
        <PressableScale onPress={() => router.back()} style={styles.navBtn} activeScale={pressScale.icon} hitSlop={8}>
          <Feather name="chevron-left" size={28} color={colors.text} />
        </PressableScale>
        <Text style={[styles.navTitle, { color: colors.text }]} numberOfLines={1}>
          {cuenta?.nombre ?? 'Cuenta'}
        </Text>
        {puedeEditar && cuenta ? (
          <PressableScale onPress={handleMenuCuenta} style={styles.navBtn} activeScale={pressScale.icon} hitSlop={8}>
            <Feather name="more-vertical" size={22} color={colors.text} />
          </PressableScale>
        ) : (
          <View style={styles.navBtn} />
        )}
      </View>

      {isLoading ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : !cuenta ? (
        <View style={styles.center}>
          <Feather name="alert-circle" size={28} color={colors.danger} />
          <Text style={[styles.errorText, { color: colors.danger }]}>Cuenta no encontrada</Text>
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={styles.scroll}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl refreshing={isRefetching} onRefresh={handleRefresh} tintColor={colors.primary} />
          }
        >
          <FadeIn>
            <SaldoHero cuenta={cuenta} />
          </FadeIn>

          {cuenta.estado === 'activa' && puedeEditar ? (
            <View style={styles.accionesRow}>
              <PressableScale
                activeScale={pressScale.button}
                style={[styles.accionPrimaria, { backgroundColor: colors.primary }]}
                onPress={() => setAbonoVisible(true)}
              >
                <Feather name="arrow-down-left" size={16} color={colors.onPrimary} />
                <Text style={[styles.accionPrimariaText, { color: colors.onPrimary }]}>Abonar</Text>
              </PressableScale>
              <PressableScale
                activeScale={pressScale.button}
                style={[styles.accionSecundaria, { backgroundColor: colors.surfaceAlt, borderColor: colors.border }]}
                onPress={() => setCargoVisible(true)}
              >
                <Feather name="plus" size={16} color={colors.text} />
                <Text style={[styles.accionSecundariaText, { color: colors.text }]}>Agregar deuda</Text>
              </PressableScale>
            </View>
          ) : cuenta.estado === 'cerrada' ? (
            <View style={[styles.cerradaBanner, { backgroundColor: colors.surfaceAlt, borderColor: colors.border }]}>
              <Feather name="lock" size={14} color={colors.textMuted} />
              <Text style={[styles.cerradaBannerText, { color: colors.textMuted }]}>Cuenta cerrada</Text>
            </View>
          ) : null}

          <View style={styles.historialHeader}>
            <Text style={[styles.historialTitulo, { color: colors.text }]}>Historial</Text>
            <Text style={[styles.historialSub, { color: colors.textDim }]}>
              Todo queda registrado. Nada se borra.
            </Text>
          </View>

          {grupos.length === 0 ? (
            <View style={styles.center}>
              <Feather name="file-text" size={28} color={colors.textDim} />
              <Text style={[styles.emptyText, { color: colors.textDim }]}>Sin movimientos todavía</Text>
            </View>
          ) : (
            grupos.map(grupo => (
              <View key={grupo.clave} style={styles.grupo}>
                <Text style={[styles.grupoTitulo, { color: colors.textDim }]}>{grupo.titulo}</Text>
                {grupo.movimientos.map((mov, index) => (
                  <MovimientoRow
                    key={mov.id}
                    mov={mov}
                    index={index}
                    puedeEditar={puedeEditar}
                    onCorregir={handleCorregir}
                    onAnular={handleAnular}
                  />
                ))}
              </View>
            ))
          )}
        </ScrollView>
      )}

      <AbonoSheet
        visible={abonoVisible}
        onClose={() => setAbonoVisible(false)}
        cuentaId={cuentaId}
        saldoActual={cuenta?.saldo ?? 0}
        nombreCuenta={cuenta?.nombre ?? ''}
      />

      <NuevoCargoSheet
        visible={cargoVisible}
        onClose={() => setCargoVisible(false)}
        cuentaId={cuentaId}
        nombreCuenta={cuenta?.nombre ?? ''}
      />

      <CorregirMovimientoSheet
        visible={!!movimientoACorregir}
        onClose={() => setMovimientoACorregir(null)}
        movimiento={movimientoACorregir}
        saldoActual={cuenta?.saldo ?? 0}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },

  nav: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderBottomWidth: 0.5,
  },
  navBtn: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  navTitle: {
    flex: 1,
    textAlign: 'center',
    fontSize: scaleFont(15),
    fontFamily: 'JetBrainsMono_700Bold',
    marginHorizontal: 8,
  },

  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    paddingVertical: 60,
  },
  errorText: {
    fontSize: scaleFont(14),
    fontFamily: 'JetBrainsMono_700Bold',
  },
  volverBtn: {
    marginTop: 8,
    paddingVertical: 10,
    paddingHorizontal: 20,
    borderRadius: 12,
    borderWidth: 1,
  },
  volverBtnText: {
    fontSize: scaleFont(13),
    fontFamily: 'JetBrainsMono_700Bold',
  },

  scroll: {
    paddingBottom: 48,
  },

  accionesRow: {
    flexDirection: 'row',
    gap: 10,
    paddingHorizontal: 20,
    marginTop: 4,
  },
  accionPrimaria: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    height: 52,
    borderRadius: 14,
  },
  accionPrimariaText: {
    fontSize: scaleFont(14),
    fontFamily: 'JetBrainsMono_700Bold',
  },
  accionSecundaria: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    height: 52,
    borderRadius: 14,
    borderWidth: 1,
  },
  accionSecundariaText: {
    fontSize: scaleFont(14),
    fontFamily: 'JetBrainsMono_700Bold',
  },

  cerradaBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginHorizontal: 20,
    marginTop: 4,
    paddingVertical: 14,
    borderRadius: 14,
    borderWidth: 1,
  },
  cerradaBannerText: {
    fontSize: scaleFont(13),
    fontFamily: 'JetBrainsMono_700Bold',
  },

  historialHeader: {
    paddingHorizontal: 20,
    marginTop: 28,
    marginBottom: 8,
  },
  historialTitulo: {
    fontSize: scaleFont(17),
    fontFamily: 'JetBrainsMono_700Bold',
  },
  historialSub: {
    fontSize: scaleFont(11),
    fontFamily: 'JetBrainsMono_400Regular',
    marginTop: 2,
  },

  grupo: {
    paddingHorizontal: 20,
    marginBottom: 12,
  },
  grupoTitulo: {
    fontSize: scaleFont(10),
    fontFamily: 'JetBrainsMono_700Bold',
    letterSpacing: 0.5,
    marginBottom: 6,
  },

  emptyText: {
    fontSize: scaleFont(13),
    fontFamily: 'JetBrainsMono_400Regular',
  },
});
