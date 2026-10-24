import * as React from 'react';
import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { useTheme } from '../theme/ThemeContext';
import { newUuid } from '../lib/facturaDocumentoPicker';
import type { FacturaRevisionRepository } from '../lib/facturaRevisionRepository';
import type { CodigoBloqueo, CorreccionesLinea, DecisionCabecera } from '../lib/facturaRevision';
import { facturaRevisionRepository, useFacturaRevision } from '../hooks/useFacturaRevision';
import { getFacturaSessionUid } from '../hooks/useFacturasProveedor';
import FacturaRevisionCabecera, { Boton, Entrada, Texto, avisoImporteOculto, formatoUsdExacto } from './FacturaRevisionCabecera';
import FacturaRevisionLinea from './FacturaRevisionLinea';

export interface FacturaRevisionViewProps {
  facturaId: string;
  ownerId: string;
  /** Saved invoice version the review is based on (0 = not saved yet). */
  facturaVersion: number;
  documento: { path: string; mime: string; sha256: string; nombre: string } | null;
  /** True while the manual editor has unsaved changes. */
  editorDirty: boolean;
  repository?: FacturaRevisionRepository;
  getSessionUid?: () => string | null;
  newId?: () => string;
  onDirtyChange?: (dirty: boolean) => void;
}

const BLOQUEOS: Record<CodigoBloqueo, string> = {
  moneda_desconocida: 'La moneda del documento es desconocida.',
  moneda_sin_tasa_aprobada: 'La moneda del documento no es USD y no hay conversión aprobada.',
  documento_completitud_no_confirmada: 'Falta confirmar que el documento está completo (completitud).',
  recepcion_no_confirmada: 'Falta confirmar la recepción completa de la mercancía.',
  iva_inclusion_desconocida: 'Falta indicar si los precios incluyen IVA.',
  iva_tasa_desconocida: 'Falta la tasa de IVA.',
  iva_incluido_division_inexacta: 'La división del IVA incluido no es exacta y no hay regla de redondeo aprobada.',
  asociacion_pendiente: 'Falta decidir la asociación con un producto.',
  conversion_no_confirmada: 'Falta confirmar el factor de conversión de unidades.',
  dato_faltante: 'Falta un dato necesario',
  valor_invalido: 'Hay un valor que no se puede interpretar',
  cantidad_cero: 'La cantidad en inventario es cero.',
  costo_unitario_division_inexacta: 'El costo por unidad de inventario no es exacto y no hay regla de redondeo aprobada.',
  descuento_alcance_desconocido: 'Un descuento no indica su alcance.',
  descuento_alcance_inconsistente: 'Un descuento tiene un alcance que no corresponde a su lugar.',
  descuento_inclusion_desconocida: 'Un descuento no indica si ya está incluido en el precio.',
  descuento_sin_valor: 'Un descuento no tiene porcentaje ni monto.',
  descuento_invalido: 'Un descuento no es válido.',
  descuento_inconsistente: 'El porcentaje y el monto de un descuento no coinciden.',
  descuento_excede_importe: 'Un descuento supera el importe del renglón.',
  descuento_global_sin_politica: 'Hay un descuento global y no existe una regla aprobada para repartirlo.',
  descuento_global_no_representable: 'El descuento global no se puede repartir exactamente.',
  diferencia_documental: 'Un importe impreso no coincide con el calculado.',
  codigo_barras_no_verificado: 'El código de barras no está verificado (colisión o lectura incompleta).',
  politica_no_aprobada: 'Se usó una regla de prueba que no está aprobada.',
};

const RAZON_CARGA = {
  no_disponible: 'La revisión asistida todavía no está disponible en el servidor. La factura manual sigue funcionando.',
  error: 'No se pudo leer la revisión. Tus datos manuales no se tocaron.',
  sin_sesion: 'La sesión cambió o no coincide con esta factura. Inicia sesión con la cuenta correcta.',
} as const;

export default function FacturaRevisionView(props: FacturaRevisionViewProps): React.JSX.Element {
  const { colors } = useTheme();
  const { facturaId, ownerId, facturaVersion, documento, editorDirty, onDirtyChange } = props;
  const control = useFacturaRevision({
    repository: props.repository ?? facturaRevisionRepository,
    facturaId,
    ownerId,
    facturaVersion,
    documentoSha256: documento?.sha256 ?? null,
    editorDirty,
    getSessionUid: props.getSessionUid ?? getFacturaSessionUid,
    newId: props.newId ?? newUuid,
  });
  const [motivoGuardado, setMotivoGuardado] = useState('');
  const [motivoReemplazo, setMotivoReemplazo] = useState('');
  const [nueva, setNueva] = useState({ descripcion: '', codigo: '', cantidad: '', unidad: '', precio: '', iva: '', motivo: '' });

  useEffect(() => {
    onDirtyChange?.(control.sucio);
  }, [control.sucio, onDirtyChange]);

  const { efectiva, calculo, contenido } = control;
  const numeroPorLinea = new Map(calculo?.lineas.map((l, i) => [l.lineaId, l.numeroLinea ?? `m${i + 1}`]) ?? []);
  const bloqueos = (calculo?.bloqueos ?? []).map(b => {
    const base = BLOQUEOS[b.codigo];
    const donde = b.lineaId ? `Renglón ${numeroPorLinea.get(b.lineaId) ?? ''}: ` : '';
    const detalle = b.detalle && (b.codigo === 'dato_faltante' || b.codigo === 'valor_invalido') ? ` (${b.detalle})` : '';
    return `${donde}${base}${detalle}`;
  });
  const decisiones: Record<DecisionCabecera, boolean | null> = {
    documentoCompletoConfirmado: contenido?.cabecera.documentoCompletoConfirmado ?? null,
    recepcionCompleta: contenido?.cabecera.recepcionCompleta ?? null,
    precioIncluyeIva: contenido?.cabecera.precioIncluyeIva ?? null,
  };
  const tonoAviso = control.aviso ? { ok: 'success', warning: 'warning', error: 'danger' }[control.aviso.tipo] as 'success' | 'warning' | 'danger' : 'muted';
  const motivoOk = motivoReemplazo.trim() !== '';
  const esUsd = calculo?.moneda === 'USD';
  const oculto = avisoImporteOculto(calculo?.moneda ?? null);

  function agregarRenglonOmitido(): void {
    const motivo = nueva.motivo.trim();
    const campos: Array<[keyof CorreccionesLinea, string]> = [
      ['descripcion', nueva.descripcion],
      ['codigoProveedor', nueva.codigo],
      ['cantidad', nueva.cantidad],
      ['unidad', nueva.unidad],
      // A price typed while the currency was USD is not stored once the amounts are hidden.
      ['precioUnitario', esUsd ? nueva.precio : ''],
      ['tasaIva', nueva.iva],
    ];
    const correcciones: Record<string, { valor: string; motivo: string }> = {};
    for (const [campo, valor] of campos) if (valor.trim() !== '') correcciones[campo] = { valor: valor.trim(), motivo };
    if (control.editar({ tipo: 'agregar_linea_manual', correcciones: correcciones as CorreccionesLinea }).ok) {
      setNueva({ descripcion: '', codigo: '', cantidad: '', unidad: '', precio: '', iva: '', motivo: '' });
    }
  }

  return (
    <View testID="factura-revision" style={[styles.raiz, { borderColor: colors.border, backgroundColor: colors.bg }]}>
      <Texto tone="primary">REVISIÓN ASISTIDA</Texto>
      <Texto testID="revision-estado">{control.estadoVisible}</Texto>
      <Texto small tone="muted">Los datos leídos de la factura son una sugerencia: nada se compra ni cambia inventario desde aquí.</Texto>

      {control.carga === 'cargando' ? <ActivityIndicator color={colors.primary} /> : null}
      {control.carga === 'no_disponible' || control.carga === 'sin_sesion' ? <Texto tone="warning">{RAZON_CARGA[control.carga]}</Texto> : null}
      {control.carga === 'error' ? (
        <View testID="revision-error" style={styles.bloque}>
          <Texto tone="danger">{RAZON_CARGA.error}</Texto>
          <Boton testID="revision-reintentar" label="Reintentar lectura" onPress={() => void control.recargar()} />
        </View>
      ) : null}

      {control.aviso ? (
        <View testID="revision-aviso" style={[styles.aviso, { borderColor: colors.border, backgroundColor: colors.surface }]}>
          <Texto tone={tonoAviso}>{control.aviso.texto}</Texto>
        </View>
      ) : null}
      {control.conflicto ? (
        <Boton testID="revision-recargar" label="Recargar versión del servidor (descarta mis cambios sin guardar)" danger onPress={() => void control.recargar()} />
      ) : null}

      <View style={styles.bloque}>
        <Texto tone="primary">EXTRACCIÓN</Texto>
        <Boton testID="revision-extraer" label={control.ocupado === 'extrayendo' ? 'Extrayendo…' : 'Extraer datos'} disabled={!control.puedeExtraer} onPress={() => void control.extraer()} />
        {control.razonNoExtraer ? <Texto small tone="warning">{control.razonNoExtraer}</Texto> : null}
        <Texto small tone="muted">Es un clic explícito: usa un servicio externo de lectura y puede tener costo. Nunca se repite solo.</Texto>
        {control.extracciones.map(fila => (
          <Texto key={fila.id} small tone="muted">{`Intento ${fila.iniciadoEn.slice(0, 16).replace('T', ' ')}: ${fila.estado}${fila.errorCodigo ? ` (${fila.errorCodigo})` : ''}`}</Texto>
        ))}
        {contenido !== null && control.extraccionesUsables.some(fila => fila.id !== contenido.extraccion_id) ? (
          <>
            <Texto small tone="warning">
              {control.sucio ? 'Aplicar otra extracción reemplaza el trabajo actual, incluidos los cambios sin guardar.' : 'Aplicar otra extracción reemplaza la revisión actual por una nueva.'}
            </Texto>
            <Entrada testID="revision-reemplazo-motivo" label="Motivo para aplicar esta extracción" value={motivoReemplazo} onChangeText={setMotivoReemplazo} />
          </>
        ) : null}
        {control.extraccionesUsables.map(fila =>
          contenido === null ? (
            <Boton key={fila.id} testID={`revision-iniciar-${fila.id}`} label="Iniciar revisión con esta extracción" onPress={() => control.aplicarExtraccion(fila.id, null)} />
          ) : fila.id !== contenido.extraccion_id ? (
            <Boton
              key={fila.id}
              testID={`revision-aplicar-${fila.id}`}
              label="Aplicar esta extracción"
              disabled={!motivoOk}
              onPress={() => {
                if (control.aplicarExtraccion(fila.id, motivoReemplazo).ok) setMotivoReemplazo('');
              }}
            />
          ) : null
        )}
      </View>

      {contenido && efectiva && calculo ? (
        <>
          <FacturaRevisionCabecera efectiva={efectiva} decisiones={decisiones} calculo={calculo} onEditar={control.editar} />
          <Texto tone="primary">{`RENGLONES (${efectiva.lineas.length})`}</Texto>
          {control.catalogoParcial ? <Texto small tone="warning">Catálogo parcial: la lectura se acotó o falló, así que la ausencia de un producto no prueba que no exista.</Texto> : null}
          {efectiva.lineas.map((linea, index) => {
            const llave = linea.numeroLinea !== null ? String(linea.numeroLinea) : `m${index + 1}`;
            const origen = control.extraccion?.lineas.find(l => l.numeroLinea === linea.numeroLinea) ?? null;
            return (
              <FacturaRevisionLinea
                key={linea.lineaId}
                llave={llave}
                numero={linea.numeroLinea !== null ? String(linea.numeroLinea) : String(index + 1)}
                pagina={origen?.pagina ?? null}
                efectiva={linea}
                calculo={calculo.lineas.find(l => l.lineaId === linea.lineaId)}
                match={linea.numeroLinea !== null ? control.candidatos[linea.numeroLinea] : undefined}
                catalogoParcial={control.catalogoParcial}
                moneda={calculo.moneda}
                esUsd={esUsd}
                estadoBarras={control.estadosBarras[linea.lineaId]}
                onEditar={control.editar}
                onElegirCandidato={codigo => control.elegirCandidato(linea.numeroLinea ?? 0, linea.lineaId, codigo)}
              />
            );
          })}

          <View style={styles.bloque}>
            <Texto tone="primary">RENGLÓN OMITIDO POR LA LECTURA</Texto>
            <Texto small tone="muted">Si la lectura se saltó un renglón impreso, agrégalo aquí. Entra en esta misma revisión y no cambia las líneas leídas.</Texto>
            <Entrada testID="revision-agregar-descripcion" label="Descripción del renglón omitido" value={nueva.descripcion} onChangeText={v => setNueva(n => ({ ...n, descripcion: v }))} />
            <Entrada testID="revision-agregar-codigo" label="Código impreso (opcional)" value={nueva.codigo} onChangeText={v => setNueva(n => ({ ...n, codigo: v }))} />
            <Entrada testID="revision-agregar-cantidad" label="Cantidad (opcional)" value={nueva.cantidad} keyboardType="decimal-pad" onChangeText={v => setNueva(n => ({ ...n, cantidad: v }))} />
            <Entrada testID="revision-agregar-unidad" label="Unidad (opcional)" value={nueva.unidad} onChangeText={v => setNueva(n => ({ ...n, unidad: v }))} />
            {esUsd ? (
              <Entrada testID="revision-agregar-precio" label="Costo unitario (opcional)" value={nueva.precio} keyboardType="decimal-pad" onChangeText={v => setNueva(n => ({ ...n, precio: v }))} />
            ) : (
              <Texto testID="revision-agregar-precio-oculto" small tone="warning">{oculto}</Texto>
            )}
            <Entrada testID="revision-agregar-iva" label="IVA % (opcional)" value={nueva.iva} keyboardType="decimal-pad" onChangeText={v => setNueva(n => ({ ...n, iva: v }))} />
            <Entrada testID="revision-agregar-motivo" label="Motivo para agregar este renglón" value={nueva.motivo} onChangeText={v => setNueva(n => ({ ...n, motivo: v }))} />
            <Boton testID="revision-agregar-manual" label="Agregar renglón omitido" disabled={nueva.descripcion.trim() === '' || nueva.motivo.trim() === ''} onPress={agregarRenglonOmitido} />
          </View>

          <View style={styles.bloque}>
            <Texto tone="primary">{esUsd ? 'CÁLCULO (USD)' : 'CÁLCULO (sin convertir)'}</Texto>
            <Texto testID="revision-totales">
              {!esUsd
                ? `Totales: ${oculto}.`
                : calculo.totales
                  ? `Base ${formatoUsdExacto(calculo.totales.base)} · IVA ${formatoUsdExacto(calculo.totales.iva)} · Total ${formatoUsdExacto(calculo.totales.total)}`
                  : 'Totales: desconocido, hay datos sin resolver. Un total parcial no se muestra.'}
            </Texto>
            <View testID="revision-por-tasa">
              {(calculo.porTasa ?? []).map(grupo => (
                <Texto key={grupo.tasa} small>
                  {esUsd ? `IVA ${grupo.tasa} %: base ${formatoUsdExacto(grupo.base)} · IVA ${formatoUsdExacto(grupo.iva)}` : `IVA ${grupo.tasa} %: ${oculto}`}
                </Texto>
              ))}
            </View>
            {calculo.diferencias.length > 0 ? (
              <View testID="revision-diferencias">
                {esUsd ? (
                  calculo.diferencias.map((d, i) => (
                    <Texto key={i} small tone={d.diferencia === '0.00' ? 'muted' : 'warning'}>
                      {`${d.lineaId ? `Renglón ${numeroPorLinea.get(d.lineaId) ?? ''} ` : ''}${d.campo}: impreso ${d.impreso ?? 'sin dato'} · calculado ${d.calculado ?? 'desconocido'} · diferencia ${d.diferencia ?? 'desconocida'}`}
                    </Texto>
                  ))
                ) : (
                  <Texto small tone="warning">{`Diferencias entre importes impresos y calculados: ${oculto}`}</Texto>
                )}
              </View>
            ) : null}
            <Texto testID="revision-pos" small tone="muted">POS: no verificado. La precisión y la emisión al POS no están verificadas.</Texto>
          </View>

          <View testID="revision-bloqueos" style={styles.bloque}>
            <Texto tone="primary">BLOQUEOS</Texto>
            {bloqueos.length === 0 ? <Texto tone="success">Sin bloqueos</Texto> : bloqueos.map((texto, i) => <Texto key={i} tone="warning">{`• ${texto}`}</Texto>)}
          </View>

          <View style={styles.bloque}>
            <Entrada testID="revision-motivo-guardado" label="Motivo de esta revisión (opcional)" value={motivoGuardado} onChangeText={setMotivoGuardado} />
            <Boton
              testID="revision-guardar"
              label={control.ocupado === 'guardando' ? 'Guardando…' : 'Guardar revisión'}
              disabled={!control.puedeGuardar}
              onPress={() => {
                void control.guardar(motivoGuardado).then(guardada => {
                  if (guardada) setMotivoGuardado('');
                });
              }}
            />
            <Boton testID="revision-aprobar" label="Aprobar revisión" disabled={!control.puedeAprobar} onPress={() => void control.aprobar()} />
            <Texto small tone="muted">La aprobación es solo un registro de revisión humana: no es autoridad de compra.</Texto>
          </View>
        </>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  raiz: { borderWidth: 0.5, borderRadius: 12, padding: 12, gap: 12 },
  bloque: { gap: 8 },
  aviso: { borderWidth: 0.5, borderRadius: 10, padding: 10 },
});
