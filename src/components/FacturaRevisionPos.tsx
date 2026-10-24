import * as React from 'react';
import { StyleSheet, View } from 'react-native';
import { useTheme } from '../theme/ThemeContext';
import type { BloqueoPos, CodigoBloqueoPos, ProyeccionSku, RepresentacionPos } from '../lib/compraRepresentacionPos';
import type { EstadoExistencias } from '../hooks/useFacturaRevision';
import { Texto, avisoImporteOculto, formatoUsdExacto } from './FacturaRevisionCabecera';

export interface FacturaRevisionPosProps {
  representacion: RepresentacionPos;
  estadoExistencias: EstadoExistencias;
  moneda: string | null;
}

const BLOQUEOS_POS: Record<CodigoBloqueoPos, string> = {
  revision_con_bloqueos: 'La revisión tiene bloqueos: no se calcula ningún impacto.',
  existencia_no_leida: 'No se pudo leer la existencia; no se asume cero.',
  producto_nuevo_identidad_no_verificada: 'Producto nuevo: su identidad y existencia en Hybrid no están verificadas; no se asume cero.',
  sku_repetido_costo_distinto: 'El mismo producto aparece en varios renglones con costos distintos; no se promedian.',
  compensacion_altera_base: 'Compensar el negativo cambia la base que calcularía el POS (no verificado).',
  cuantizacion_altera_base: 'La precisión de costo del POS cambia la base (regla de prueba, no aprobada).',
  precision_pos_no_verificada: 'La precisión y el redondeo del POS no están verificados.',
  control_fecha_no_transmisibles: 'El número de control y la fecha impresos no se pueden transmitir con el esquema de compra actual.',
  existencia_ejecucion_no_verificada: 'La existencia se lee ahora y no se vuelve a verificar al ejecutar la compra (no verificado).',
};

function claveSku(sku: ProyeccionSku): string {
  return sku.codigoProducto ?? `nuevo-${sku.lineaIds[0]}`;
}

function textoBloqueo(bloqueo: BloqueoPos): string {
  const donde = bloqueo.ambito === 'sku' ? `${bloqueo.codigoProducto ?? 'Producto nuevo'}: ` : '';
  return `• ${donde}${BLOQUEOS_POS[bloqueo.codigo]}`;
}

function TarjetaSku({ sku }: { sku: ProyeccionSku }): React.JSX.Element {
  const { colors } = useTheme();
  const id = `revision-impacto-sku-${claveSku(sku)}`;
  return (
    <View testID={id} style={[styles.tarjeta, { borderColor: colors.border, backgroundColor: colors.surface }]}>
      <Texto tone="primary">{sku.codigoProducto ?? 'Producto nuevo (sin identidad en Hybrid)'}</Texto>
      <Texto testID={`${id}-cantidad`} small>{`Cantidad en factura: ${sku.cantidadDocumentoStock}`}</Texto>
      <Texto testID={`${id}-existencia`} small>{`Existencia leída: ${sku.existenciaLeida ?? 'no leída'}`}</Texto>
      <Texto testID={`${id}-compensacion`} small>{`Compensación por negativo: ${sku.compensacion ?? 'desconocida'}`}</Texto>
      <Texto testID={`${id}-envio`} small>{`Cantidad que se enviaría: ${sku.cantidadPos ?? 'desconocida'}`}</Texto>
      <Texto testID={`${id}-esperada`} small>{`Existencia esperada tras la compra: ${sku.existenciaEsperada ?? 'desconocida'}`}</Texto>
      <Texto testID={`${id}-base-documental`} small>{`Base documental sin IVA: ${formatoUsdExacto(sku.baseDocumentalExIva)}`}</Texto>
      <Texto testID={`${id}-base-hipotetica`} small>{`Base hipotética POS sin IVA (costo × cantidad enviada, no es deuda observada): ${formatoUsdExacto(sku.baseHipoteticaPosExIva)}`}</Texto>
      <Texto testID={`${id}-diferencia`} small>{`Diferencia (documental − hipotética): ${formatoUsdExacto(sku.diferenciaBase)}`}</Texto>
    </View>
  );
}

function EstadoLectura({ estado, lecturaEn }: { estado: EstadoExistencias; lecturaEn: string | null }): React.JSX.Element | null {
  switch (estado) {
    case 'pendiente':
      return <Texto testID="revision-impacto-existencias" small tone="muted">Leyendo existencias de Hybrid…</Texto>;
    case 'error':
      return <Texto testID="revision-impacto-existencias" small tone="warning">No se pudo leer la existencia de Hybrid. Las cantidades quedan desconocidas; no se asume cero.</Texto>;
    case 'listo':
      return <Texto testID="revision-impacto-existencias" small tone="muted">{`Existencias leídas: ${lecturaEn ?? 'sin hora observada'}`}</Texto>;
    default:
      return null;
  }
}

/** Read-only consumer of the review calculation: quantities and clearly labelled bases, never an action or an authority. */
export default function FacturaRevisionPos({ representacion, estadoExistencias, moneda }: FacturaRevisionPosProps): React.JSX.Element {
  const { colors } = useTheme();
  const sinProyeccion = moneda !== 'USD' || representacion.emisionImportada.bloqueos.some(b => b.codigo === 'revision_con_bloqueos');

  return (
    <View testID="revision-impacto-hybrid" style={[styles.bloque, { borderColor: colors.border }]}>
      <Texto tone="primary">IMPACTO EN HYBRID (solo lectura)</Texto>
      <Texto small tone="muted">Solo informativo: no se envía nada al POS ni cambia el inventario desde aquí. Las bases son cálculos sin IVA, no una deuda observada.</Texto>

      {sinProyeccion ? (
        <>
          <Texto testID="revision-impacto-sin-proyeccion" small tone="warning">Sin proyección: la revisión tiene bloqueos.</Texto>
          {moneda !== 'USD' ? <Texto testID="revision-impacto-oculto" small tone="warning">{avisoImporteOculto(moneda)}</Texto> : null}
        </>
      ) : (
        <>
          <EstadoLectura estado={estadoExistencias} lecturaEn={representacion.lecturaExistenciasEn} />
          {representacion.skus.map(sku => (
            <TarjetaSku key={claveSku(sku)} sku={sku} />
          ))}
          {representacion.totalDocumentalConImpuestos !== null ? (
            <Texto testID="revision-impacto-total-documental" small>{`Total documental con impuestos (revisión): ${formatoUsdExacto(representacion.totalDocumentalConImpuestos)}`}</Texto>
          ) : null}
          <Texto testID="revision-impacto-base-total" small>{`Base documental sin IVA total: ${formatoUsdExacto(representacion.baseDocumentalExIvaTotal)}`}</Texto>
          <Texto testID="revision-impacto-base-hipotetica-total" small>{`Base hipotética POS sin IVA total (no es deuda observada): ${formatoUsdExacto(representacion.baseHipoteticaPosExIvaTotal)}`}</Texto>
        </>
      )}

      <Texto testID="revision-impacto-emision" tone="warning">Emisión importada bloqueada</Texto>
      <View testID="revision-impacto-bloqueos" style={styles.lista}>
        {representacion.emisionImportada.bloqueos.map((bloqueo, i) => (
          <Texto key={i} small tone="warning">{textoBloqueo(bloqueo)}</Texto>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  bloque: { gap: 8, borderTopWidth: 0.5, paddingTop: 12 },
  tarjeta: { borderWidth: 0.5, borderRadius: 10, padding: 10, gap: 4 },
  lista: { gap: 4 },
});
