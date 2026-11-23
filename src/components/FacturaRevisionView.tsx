import * as React from 'react';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../theme/ThemeContext';
import { useDeviceSize } from '../hooks/useDeviceSize';
import { newUuid } from '../lib/facturaDocumentoPicker';
import type { ExtraccionRow, FacturaRevisionRepository } from '../lib/facturaRevisionRepository';
import type { Bloqueo, CodigoBloqueo, CorreccionesLinea, DecisionCabecera, FacturaEfectiva, RevisionContenido } from '../lib/facturaRevision';
import {
  accionPrincipal,
  agruparBloqueos,
  edicionFactorUno,
  edicionIvaManual,
  estadoLinea,
  lineasConBloqueo,
  pendientesDeLinea,
  resumenLineas,
  siguientePorRevisar,
  type AccionPrincipalId,
  type EstadoLinea,
  type EtapaRevision,
  type SituacionRevision,
  type VerificacionCodigo,
} from '../lib/facturaRevisionPasos';
import { facturaRevisionRepository, useFacturaRevision, type EstadoVisible, type UseFacturaRevisionParams } from '../hooks/useFacturaRevision';
import { getFacturaSessionUid } from '../hooks/useFacturasProveedor';
import { supabase } from '../lib/supabase';
import { notify } from '../lib/notify';
import { reanudarBorradorCompra } from '../hooks/useBorradores';
import FacturaRevisionCabecera, { Boton, BotonDespliegue, ConfirmacionesCompra, Entrada, ListasTecnicasCabecera, Texto, avisoImporteOculto, formatoUsdExacto } from './FacturaRevisionCabecera';
import FacturaRevisionLinea from './FacturaRevisionLinea';
import FacturaRevisionPos from './FacturaRevisionPos';

export type { EtapaRevision } from '../lib/facturaRevisionPasos';

export interface CabeceraLeida {
  proveedorNombre: string | null;
  numeroDocumento: string | null;
  fechaEmision: string | null;
}

export interface FacturaRevisionViewProps {
  /** Current effective source values for display; receiving them must never mutate the invoice draft. */
  onCabeceraLeida?: (cabecera: CabeceraLeida | null) => void;
  /** Opens the shell's context-bound document viewer without starting extraction. */
  onVerDocumento?: () => void;
  /**
   * Stage the shell shows. When absent the review keeps its own stage; either way every change is reported.
   * Layout contract: the review owns its scrolling body and its sticky footer (the root is `flex: 1`), so the host must
   * not wrap it in another ScrollView. Keep it mounted between steps: unsaved edits and typed prices live inside it.
   */
  etapa?: EtapaRevision;
  onEtapaChange?: (etapa: EtapaRevision) => void;
  /** Offered next to a failed or unavailable reading so the person can continue with the manual invoice. */
  onSeguirManual?: () => void;
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
  /** Stock reader for the read-only Hybrid impact; defaults to the shared `fetchExistencias`. */
  leerExistencias?: UseFacturaRevisionParams['leerExistencias'];
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

type FiltroLineas = 'todos' | 'pendientes' | 'listos';
type LineasEfectivas = FacturaEfectiva['lineas'];

/** Document blockers answered by the checklist at the top of Compra; the others are answered in Leer. */
const RESUELTOS_EN_COMPRA: ReadonlySet<CodigoBloqueo> = new Set(['documento_completitud_no_confirmada', 'recepcion_no_confirmada']);

const AVISO_CATALOGO_PARCIAL = 'Catálogo parcial: no se pudo revisar todo el inventario. Si no ves el producto, búscalo por SKU; márcalo como nuevo solo si confirmas que no existe.';

function renglones(cantidad: number): string {
  return cantidad === 1 ? '1 renglón' : `${cantidad} renglones`;
}

/** Offsets inside the stage scroll, measured by layout, to bring a line into view on a phone. */
interface Posiciones {
  etapa: number | null;
  filas: number | null;
  porLinea: Map<string, number>;
}

function razonBloqueo(bloqueo: Bloqueo): string {
  const detalle = bloqueo.detalle && (bloqueo.codigo === 'dato_faltante' || bloqueo.codigo === 'valor_invalido') ? ` (${bloqueo.detalle})` : '';
  return `${BLOQUEOS[bloqueo.codigo]}${detalle}`;
}

function tonoEstado(estado: EstadoVisible): 'success' | 'warning' | 'text' {
  switch (estado) {
    case 'Validada':
      return 'success';
    case 'Con bloqueos':
    case 'Aprobación desactualizada':
      return 'warning';
    default:
      return 'text';
  }
}

/** The footer action keeps the stable id of the control that used to do the same thing; navigation uses a generic one. */
function idDeAccion(id: AccionPrincipalId, extraccionId: string | undefined): string {
  switch (id) {
    case 'leer':
      return 'revision-extraer';
    case 'revisar_leido':
      return `revision-iniciar-${extraccionId ?? ''}`;
    case 'guardar':
      return 'revision-guardar';
    case 'aprobar':
      return 'revision-aprobar';
    case 'preparar':
      return 'revision-materializar';
    default:
      return 'revision-accion-principal';
  }
}

function lineaVisible(estado: EstadoLinea | undefined, filtro: FiltroLineas): boolean {
  if (filtro === 'todos') return true;
  return filtro === 'listos' ? estado === 'listo' : estado !== 'listo';
}

const SIN_VERIFICACION = new Map<string, VerificacionCodigo>();

/**
 * Catalog lookup of every captured code of a new-product line, owned here (not by the open line) so the readiness of a
 * collapsed row, or of a saved review nobody opened, never claims more than was verified. An answer is stored under the
 * exact context, line and code it was asked for, and is dropped when the context or session changed meanwhile, so a late
 * or stale answer can never mark another code, line or account ready.
 */
function useVerificacionCodigos(entrada: {
  contenido: RevisionContenido | null;
  habilitado: boolean;
  contexto: string;
  contextoVigente: () => string;
  sesionVigente: () => boolean;
  leer: FacturaRevisionRepository['leerColisionesBarras'];
}): ReadonlyMap<string, VerificacionCodigo> {
  const { contenido, habilitado, contexto } = entrada;
  const vivo = useRef(entrada);
  vivo.current = entrada;
  const montado = useRef(true);
  const pedidas = useRef(new Set<string>());
  const [respuestas, setRespuestas] = useState<Record<string, VerificacionCodigo>>({});
  const origen = contenido?.extraccion_id ?? null;
  const clave = (lineaId: string, codigo: string): string => JSON.stringify([contexto, origen, lineaId, codigo]);
  const capturas = habilitado && contenido
    ? contenido.lineas.flatMap(linea => (linea.asociacion.tipo === 'producto_nuevo' && linea.codigoBarras.codigoEscaneado
        ? [{ lineaId: linea.lineaId, codigo: linea.codigoBarras.codigoEscaneado }]
        : []))
    : [];
  const firma = JSON.stringify([contexto, origen, capturas]);

  useEffect(() => {
    montado.current = true;
    return () => { montado.current = false; };
  }, []);

  useEffect(() => {
    for (const { lineaId, codigo } of capturas) {
      const pedida = clave(lineaId, codigo);
      if (pedidas.current.has(pedida)) continue;
      pedidas.current.add(pedida);
      const vigente = (): boolean => montado.current && vivo.current.contextoVigente() === contexto && vivo.current.sesionVigente();
      const guardar = (resultado: VerificacionCodigo): void => {
        if (vigente()) setRespuestas(actual => ({ ...actual, [pedida]: resultado }));
        else pedidas.current.delete(pedida);
      };
      void Promise.resolve()
        .then(() => vivo.current.leer([codigo]))
        .then(resultado => {
          const lectura = resultado[codigo];
          const valida = lectura && Array.isArray(lectura.productos) && !lectura.productos.some(producto => !producto || typeof producto.codigoInterno !== 'string' || producto.codigoInterno === '');
          if (!valida) return guardar({ tipo: 'incompleta' });
          const skus = lectura.productos.map(producto => producto.codigoInterno);
          if (skus.length > 0) return guardar({ tipo: 'colision', skus });
          return guardar({ tipo: lectura.completo === true ? 'sin_coincidencias' : 'incompleta' });
        }, () => guardar({ tipo: 'incompleta' }));
    }
    // The signature carries every input that decides which lookups are needed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [firma]);

  if (capturas.length === 0) return SIN_VERIFICACION;
  const porLinea = new Map<string, VerificacionCodigo>();
  for (const { lineaId, codigo } of capturas) {
    const respuesta = respuestas[clave(lineaId, codigo)];
    if (respuesta) porLinea.set(lineaId, respuesta);
  }
  return porLinea;
}

export default function FacturaRevisionView(props: FacturaRevisionViewProps): React.JSX.Element {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { isDesktop } = useDeviceSize();
  const { facturaId, ownerId, facturaVersion, documento, editorDirty, onDirtyChange, onEtapaChange, onSeguirManual } = props;
  const control = useFacturaRevision({
    repository: props.repository ?? facturaRevisionRepository,
    facturaId,
    ownerId,
    facturaVersion,
    documentoSha256: documento?.sha256 ?? null,
    editorDirty,
    getSessionUid: props.getSessionUid ?? getFacturaSessionUid,
    newId: props.newId ?? newUuid,
    leerExistencias: props.leerExistencias,
  });
  const [materializando, setMaterializando] = useState(false);
  const [motivoGuardado, setMotivoGuardado] = useState('');
  const [motivoReemplazo, setMotivoReemplazo] = useState('');
  const [nueva, setNueva] = useState({ descripcion: '', codigo: '', cantidad: '', unidad: '', precio: '', iva: '', motivo: '' });
  const [etapaInterna, setEtapaInterna] = useState<EtapaRevision>('leer');
  const [lineaAbierta, setLineaAbierta] = useState<string | null>(null);
  const [filtro, setFiltro] = useState<FiltroLineas>('todos');
  const [agregarAbierto, setAgregarAbierto] = useState(false);
  const [detalles, setDetalles] = useState({ leer: false, compra: false });
  const [loteIva, setLoteIva] = useState<{ tasa: '0' | '16' | 'otro'; contexto: string } | null>(null);
  const [otraTasa, setOtraTasa] = useState('');
  const [loteFactor, setLoteFactor] = useState<{ contexto: string } | null>(null);
  const etapa = props.etapa ?? etapaInterna;
  const cuerpoRef = useRef<ScrollView>(null);
  const posiciones = useRef<Posiciones>({ etapa: null, filas: null, porLinea: new Map() });
  const lineaPorMostrar = useRef<string | null>(null);

  // Each stage starts at its top: one shared scroll offset must not carry over. Runs before layout so the offsets
  // measured for the new stage are never cleared afterwards.
  useLayoutEffect(() => {
    posiciones.current = { etapa: null, filas: null, porLinea: new Map() };
    cuerpoRef.current?.scrollTo({ y: 0, animated: false });
  }, [etapa]);

  // Another invoice is another review: nothing of the previous one (stage, open line, filter) carries over.
  useEffect(() => {
    setEtapaInterna('leer');
    setLineaAbierta(null);
    setFiltro('todos');
    setAgregarAbierto(false);
    setLoteIva(null);
    setOtraTasa('');
    setLoteFactor(null);
    lineaPorMostrar.current = null;
  }, [facturaId]);

  const { efectiva, calculo, contenido } = control;
  const puedeMaterializar = control.estadoVisible === 'Validada' && !editorDirty && !control.sucio && calculo?.sinBloqueos === true && control.ultimaFila?.aprobadoEn !== null && control.ultimaFila !== null;
  const numeroPorLinea = new Map(calculo?.lineas.map((l, i) => [l.lineaId, l.numeroLinea ?? `m${i + 1}`]) ?? []);
  const llavePorLinea = new Map(efectiva?.lineas.map((l, i) => [l.lineaId, l.numeroLinea !== null ? String(l.numeroLinea) : `m${i + 1}`]) ?? []);
  const bloqueos = (calculo?.bloqueos ?? []).map(b => ({
    lineaId: b.lineaId,
    texto: `${b.lineaId ? `Renglón ${numeroPorLinea.get(b.lineaId) ?? ''}: ` : ''}${razonBloqueo(b)}`,
  }));
  const bloqueosPorLinea = new Map<string, string[]>();
  for (const bloqueo of calculo?.bloqueos ?? []) {
    if (bloqueo.lineaId) bloqueosPorLinea.set(bloqueo.lineaId, [...(bloqueosPorLinea.get(bloqueo.lineaId) ?? []), razonBloqueo(bloqueo)]);
  }
  const sesionVigente = (): boolean => (props.getSessionUid ?? getFacturaSessionUid)() === ownerId;
  const verificaciones = useVerificacionCodigos({
    contenido,
    habilitado: control.carga === 'listo',
    contexto: control.contextoActual(),
    contextoVigente: control.contextoActual,
    sesionVigente,
    leer: (props.repository ?? facturaRevisionRepository).leerColisionesBarras,
  });
  const estados = contenido && calculo
    ? contenido.lineas.map(linea => ({ lineaId: linea.lineaId, estado: estadoLinea(linea, calculo, verificaciones.get(linea.lineaId)) }))
    : [];
  const estadoPorLinea = new Map(estados.map(item => [item.lineaId, item.estado]));
  const resumen = resumenLineas(estados.map(item => item.estado));
  const decisiones: Record<DecisionCabecera, boolean | null> = {
    documentoCompletoConfirmado: contenido?.cabecera.documentoCompletoConfirmado ?? null,
    recepcionCompleta: contenido?.cabecera.recepcionCompleta ?? null,
    precioIncluyeIva: contenido?.cabecera.precioIncluyeIva ?? null,
  };
  const tonoAviso = control.aviso ? { ok: 'success', warning: 'warning', error: 'danger' }[control.aviso.tipo] as 'success' | 'warning' | 'danger' : 'muted';
  const motivoOk = motivoReemplazo.trim() !== '';
  const esUsd = calculo?.moneda === 'USD';
  const oculto = avisoImporteOculto(calculo?.moneda ?? null);

  // PVP text that cannot be stored (see FacturaRevisionLinea), per line. It dies with the context it was typed in:
  // another invoice, a reload, a lost session or a currency whose amounts are hidden.
  const [borradoresPrecio, setBorradoresPrecio] = useState<Record<string, string>>({});
  const setBorradorPrecio = useCallback((lineaId: string, texto: string | null): void => {
    setBorradoresPrecio(actual => {
      if (texto === null) {
        if (!(lineaId in actual)) return actual;
        const resto = { ...actual };
        delete resto[lineaId];
        return resto;
      }
      return actual[lineaId] === texto ? actual : { ...actual, [lineaId]: texto };
    });
  }, []);
  const descartarBorradoresPrecio = (): void => setBorradoresPrecio({});
  const sinContextoPrecio = control.carga !== 'listo' || contenido === null || !esUsd;
  useEffect(() => {
    if (sinContextoPrecio) setBorradoresPrecio(actual => (Object.keys(actual).length === 0 ? actual : {}));
  }, [sinContextoPrecio]);
  const lineasConBorrador = efectiva && esUsd ? efectiva.lineas.filter(l => borradoresPrecio[l.lineaId] !== undefined) : [];
  const hayBorradorPrecio = lineasConBorrador.length > 0;

  useEffect(() => {
    onDirtyChange?.(control.sucio || hayBorradorPrecio);
  }, [control.sucio, hayBorradorPrecio, onDirtyChange]);

  // The shell shows what was read next to its own fields, as read from the CURRENT photo. So it is reported only while the
  // review's own extraction row was read from exactly this document: a review left from a replaced or removed photo
  // reports null, also while it reloads. Reported again only when the document or the values change (compared as text),
  // so a parent that stores them and passes a new callback each render never loops.
  const filaFuente = contenido?.extraccion_id ? control.extracciones.find(fila => fila.id === contenido.extraccion_id) : undefined;
  const fuenteEsDocumento = documento !== null && filaFuente !== undefined && filaFuente.documentoSha256 === documento.sha256;
  const cabeceraLeida: CabeceraLeida | null = control.carga === 'listo' && contenido && efectiva && fuenteEsDocumento && sesionVigente()
    ? { proveedorNombre: efectiva.campos.proveedorNombre.valor, numeroDocumento: efectiva.campos.numeroDocumento.valor, fechaEmision: efectiva.campos.fechaEmision.valor }
    : null;
  const claveCabecera = JSON.stringify([documento?.sha256 ?? null, cabeceraLeida]);
  const avisarCabecera = useRef(props.onCabeceraLeida);
  avisarCabecera.current = props.onCabeceraLeida;
  useEffect(() => {
    const [, cabecera] = JSON.parse(claveCabecera) as [string | null, CabeceraLeida | null];
    avisarCabecera.current?.(cabecera);
  }, [claveCabecera]);

  const ordenLineas = contenido?.lineas.map(linea => linea.lineaId) ?? [];
  const sinIva = lineasConBloqueo(calculo?.bloqueos ?? [], 'iva_tasa_desconocida', ordenLineas);
  const sinFactor = lineasConBloqueo(calculo?.bloqueos ?? [], 'conversion_no_confirmada', ordenLineas);
  const puedeLote = control.carga === 'listo' && control.ocupado === null && !control.conflicto && sesionVigente();
  const tasaLote = loteIva === null ? '' : loteIva.tasa === 'otro' ? otraTasa.trim() : loteIva.tasa;
  const puedeVerDocumento = props.onVerDocumento !== undefined && documento !== null;

  const intentoFallido = contenido === null && control.extraccionesUsables.length === 0 && control.extracciones.some(fila => fila.estado === 'fallido' || fila.estado === 'cuarentena');
  const situacion: SituacionRevision = {
    etapa,
    carga: control.carga,
    hayContenido: contenido !== null,
    hayExtraccionUsable: control.extraccionesUsables.length > 0,
    intentoFallido,
    ocupado: control.ocupado,
    puedeExtraer: control.puedeExtraer,
    razonNoExtraer: control.razonNoExtraer,
    conflicto: control.conflicto,
    sucio: control.sucio,
    editorDirty,
    puedeGuardar: control.puedeGuardar,
    puedeAprobar: control.puedeAprobar,
    puedeMaterializar,
    materializando,
    hayBorradorPrecio,
    sinBloqueos: calculo?.sinBloqueos === true,
    aprobada: control.ultimaFila !== null && control.ultimaFila.aprobadoEn !== null,
  };
  const accion = accionPrincipal(situacion);
  const masReciente = [...control.extraccionesUsables].sort((a, b) => b.iniciadoEn.localeCompare(a.iniciadoEn))[0];

  function irA(siguiente: EtapaRevision): void {
    if (siguiente === etapa) return;
    if (props.etapa === undefined) setEtapaInterna(siguiente);
    onEtapaChange?.(siguiente);
  }

  function abrirLinea(lineaId: string): void {
    setFiltro('todos');
    setLineaAbierta(lineaId);
    lineaPorMostrar.current = lineaId;
    irA('productos');
  }

  /** Scrolls a phone to the line asked for by "Ir al renglón", once every offset it needs has been measured. */
  function mostrarLineaPedida(): void {
    const destino = lineaPorMostrar.current;
    const { etapa: yEtapa, filas: yFilas, porLinea } = posiciones.current;
    const yFila = destino === null ? undefined : porLinea.get(destino);
    if (yEtapa === null || yFilas === null || yFila === undefined) return;
    lineaPorMostrar.current = null;
    cuerpoRef.current?.scrollTo({ y: yEtapa + yFilas + yFila, animated: true });
  }

  function medir(donde: 'etapa' | 'filas', evento: LayoutChangeEvent): void {
    posiciones.current[donde] = evento.nativeEvent.layout.y;
    mostrarLineaPedida();
  }

  function medirFila(lineaId: string, evento: LayoutChangeEvent): void {
    posiciones.current.porLinea.set(lineaId, evento.nativeEvent.layout.y);
    mostrarLineaPedida();
  }

  function aplicarLoteIva(): void {
    if (loteIva === null || tasaLote === '' || !puedeLote) return;
    if (control.editarVarios(sinIva.map(lineaId => edicionIvaManual(lineaId, tasaLote)), loteIva.contexto).ok) {
      setLoteIva(null);
      setOtraTasa('');
    }
  }

  function aplicarLoteFactor(): void {
    if (loteFactor === null || !puedeLote) return;
    if (control.editarVarios(sinFactor.map(edicionFactorUno), loteFactor.contexto).ok) setLoteFactor(null);
  }

  async function materializarCompra(): Promise<void> {
    const revision = control.ultimaFila;
    if (!revision || !puedeMaterializar || materializando) return;
    setMaterializando(true);
    try {
      const { data, error } = await supabase.functions.invoke('materializar-compra-factura', {
        body: { facturaId, revision: revision.revision, fingerprint: revision.fingerprint, versionEsperada: revision.facturaVersion },
      });
      if (error) throw error;
      if (!data || !Number.isSafeInteger(data.compraId)) throw new Error('El servidor no devolvió una compra vinculada válida.');
      await reanudarBorradorCompra(data.compraId);
      notify('Borrador de compra listo', 'La compra vinculada quedó editable. La emisión requiere una acción explícita y está bloqueada por la regla de inventario pendiente.');
    } catch (error) {
      notify('No se pudo preparar la compra', error instanceof Error ? error.message : 'Error desconocido.');
    } finally {
      setMaterializando(false);
    }
  }

  function guardarRevision(): void {
    if (hayBorradorPrecio) return;
    void control.guardar(motivoGuardado).then(guardada => {
      if (guardada) setMotivoGuardado('');
    });
  }

  function revisarLeido(): void {
    if (!masReciente) return;
    descartarBorradoresPrecio();
    control.aplicarExtraccion(masReciente.id, null);
  }

  function ejecutar(id: AccionPrincipalId): void {
    switch (id) {
      case 'leer':
        void control.extraer();
        return;
      case 'revisar_leido':
        revisarLeido();
        return;
      case 'continuar_productos':
        irA('productos');
        return;
      case 'continuar_compra':
        irA('compra');
        return;
      case 'ir_leer':
        irA('leer');
        return;
      case 'guardar':
        guardarRevision();
        return;
      case 'aprobar':
        void control.aprobar();
        return;
      case 'preparar':
        void materializarCompra();
        return;
    }
  }

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

  function renderSinContenido(): React.JSX.Element | null {
    if (control.carga !== 'listo') return null;
    if (control.ocupado === 'extrayendo') {
      return <Texto testID="revision-leyendo" tone="primary" live>Leyendo la factura…</Texto>;
    }
    if (intentoFallido) {
      return (
        <View style={styles.bloque}>
          <Texto testID="revision-lectura-fallida" tone="danger" live>No se pudo leer la factura.</Texto>
          <Texto small tone="muted">Inténtalo de nuevo o sigue a mano. El detalle del intento está en «Detalles técnicos».</Texto>
        </View>
      );
    }
    if (control.extraccionesUsables.length > 0) {
      return <Texto>Hay una lectura lista. Revísala para ver lo que se leyó: nada se aplica hasta que lo pidas.</Texto>;
    }
    return (
      <View style={styles.bloque}>
        <Texto tone="primary">Leer la factura</Texto>
        <Texto>El sistema lee la factura guardada y propone los productos. Tú decides cada uno.</Texto>
        <Texto small tone="muted">Usa un servicio externo y puede tener costo. Solo se hace cuando tú lo pides.</Texto>
      </View>
    );
  }

  function renderBotonExtraccion(fila: ExtraccionRow): React.JSX.Element | null {
    if (contenido === null) {
      // The most recent reading is the footer's primary action; the others stay here as explicit choices.
      if (accion?.id === 'revisar_leido' && fila.id === masReciente?.id) return null;
      return <Boton key={fila.id} testID={`revision-iniciar-${fila.id}`} label="Iniciar revisión con esta extracción" onPress={() => { descartarBorradoresPrecio(); control.aplicarExtraccion(fila.id, null); }} />;
    }
    if (fila.id === contenido.extraccion_id) return null;
    return (
      <Boton
        key={fila.id}
        testID={`revision-aplicar-${fila.id}`}
        label="Aplicar esta extracción"
        disabled={!motivoOk}
        onPress={() => {
          if (control.aplicarExtraccion(fila.id, motivoReemplazo).ok) {
            setMotivoReemplazo('');
            descartarBorradoresPrecio();
          }
        }}
      />
    );
  }

  function renderDetallesLeer(): React.JSX.Element {
    return (
      <View style={styles.bloque}>
        <BotonDespliegue testID="revision-detalles-tecnicos" label="Detalles técnicos" abierto={detalles.leer} onPress={() => setDetalles(actual => ({ ...actual, leer: !actual.leer }))} />
        {detalles.leer ? (
          <View style={styles.bloque}>
            <Texto small tone="muted">Extracción</Texto>
            {accion?.id !== 'leer' ? (
              <>
                <Boton testID="revision-extraer" label={control.ocupado === 'extrayendo' ? 'Extrayendo…' : 'Extraer datos'} disabled={!control.puedeExtraer} onPress={() => void control.extraer()} />
                {control.razonNoExtraer ? <Texto small tone="warning">{control.razonNoExtraer}</Texto> : null}
              </>
            ) : null}
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
            {control.extraccionesUsables.map(renderBotonExtraccion)}
            {efectiva && calculo ? <ListasTecnicasCabecera efectiva={efectiva} calculo={calculo} onEditar={control.editar} /> : null}
          </View>
        ) : null}
      </View>
    );
  }

  function renderLeer(): React.JSX.Element {
    const seguirManual = onSeguirManual !== undefined && contenido === null && (intentoFallido || control.carga === 'no_disponible' || control.carga === 'error');
    return (
      <View testID="revision-etapa-leer" style={styles.etapa}>
        {renderVerDocumento()}
        {contenido && efectiva && calculo ? (
          <FacturaRevisionCabecera efectiva={efectiva} decisiones={decisiones} tipoDocumento={contenido.cabecera.tipoDocumento ?? null} calculo={calculo} onEditar={control.editar} />
        ) : (
          renderSinContenido()
        )}
        {seguirManual ? <Boton testID="revision-seguir-manual" label="Seguir a mano" onPress={() => onSeguirManual?.()} /> : null}
        {renderDetallesLeer()}
      </View>
    );
  }

  function renderFormularioOmitido(): React.JSX.Element {
    return (
      <View style={styles.bloque}>
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
    );
  }

  function renderLinea(linea: NonNullable<typeof efectiva>['lineas'][number], index: number, modo: 'completo' | 'fila' | 'detalle'): React.JSX.Element | null {
    if (!contenido || !calculo) return null;
    const estado = estadoPorLinea.get(linea.lineaId);
    if (estado === undefined) return null;
    const llave = llavePorLinea.get(linea.lineaId) ?? `m${index + 1}`;
    const origen = control.extraccion?.lineas.find(l => l.numeroLinea === linea.numeroLinea) ?? null;
    const contextoCaptura = control.contextoActual();
    const seleccionar = modo === 'fila' ? () => setLineaAbierta(linea.lineaId) : () => setLineaAbierta(actual => (actual === linea.lineaId ? null : linea.lineaId));
    // Side by side the detail stays open: with nothing left to review the selection simply stays where it is.
    const siguiente = (): void => setLineaAbierta(siguientePorRevisar(estados, linea.lineaId) ?? (modo === 'completo' ? null : linea.lineaId));
    return (
      <FacturaRevisionLinea
        key={`${linea.lineaId}-${modo}`}
        llave={llave}
        modo={modo}
        numero={linea.numeroLinea !== null ? String(linea.numeroLinea) : String(index + 1)}
        pagina={origen?.pagina ?? null}
        efectiva={linea}
        calculo={calculo.lineas.find(l => l.lineaId === linea.lineaId)}
        match={linea.numeroLinea !== null ? control.candidatos[linea.numeroLinea] : undefined}
        catalogoParcial={control.catalogoParcial}
        moneda={calculo.moneda}
        esUsd={esUsd}
        estadoBarras={control.estadosBarras[linea.lineaId]}
        tipoDocumento={contenido.cabecera.tipoDocumento ?? null}
        precioVenta={contenido.lineas.find(l => l.lineaId === linea.lineaId)?.precioVenta ?? null}
        borradorPrecio={borradoresPrecio[linea.lineaId]}
        onBorradorPrecio={setBorradorPrecio}
        onEditar={control.editar}
        onElegirCandidato={codigo => control.elegirCandidato(linea.numeroLinea ?? 0, linea.lineaId, codigo)}
        capturaCodigo={control.carga === 'listo' && control.ocupado === null && !control.conflicto ? {
          contexto: `${contextoCaptura}|${contenido.extraccion_id}|${control.ultimaFila?.revision ?? 0}`,
          codigo: contenido.lineas.find(l => l.lineaId === linea.lineaId)?.codigoBarras.codigoEscaneado,
          verificacion: verificaciones.get(linea.lineaId),
          estaVigente: () => control.contextoActual() === contextoCaptura && (props.getSessionUid ?? getFacturaSessionUid)() === ownerId,
          onCapturar: valor => control.capturarCodigoNuevo(linea.lineaId, valor, contextoCaptura),
        } : undefined}
        estado={estado}
        bloqueos={bloqueosPorLinea.get(linea.lineaId) ?? []}
        abierta={lineaAbierta === linea.lineaId}
        onAlternar={seleccionar}
        onSiguiente={siguiente}
      />
    );
  }

  function renderVerDocumento(): React.JSX.Element | null {
    return puedeVerDocumento ? <Boton testID="revision-ver-documento" label="Ver factura" onPress={() => props.onVerDocumento?.()} /> : null;
  }

  function renderLote(): React.JSX.Element | null {
    if (sinIva.length === 0 && sinFactor.length === 0) return null;
    const elegirIva = (tasa: '0' | '16' | 'otro'): void => setLoteIva({ tasa, contexto: control.contextoActual() });
    const etiquetaIva = tasaLote === '' ? `Aplicar IVA a ${renglones(sinIva.length)} sin IVA` : `Aplicar ${tasaLote} % a ${renglones(sinIva.length)} sin IVA`;
    return (
      <View testID="revision-lote" style={[styles.grupo, { borderColor: colors.border, backgroundColor: colors.surface }]}>
        <Texto tone="primary">Aplicar a renglones pendientes</Texto>
        <Texto small tone="muted">No cambia los renglones que ya tienen IVA o unidades.</Texto>
        {sinIva.length > 0 ? (
          <View style={styles.bloque}>
            <Texto small>{`IVA de ${renglones(sinIva.length)} sin IVA`}</Texto>
            <View style={styles.filaFiltros}>
              <Boton testID="revision-lote-iva-0" label="0 %" selected={loteIva?.tasa === '0'} disabled={!puedeLote} onPress={() => elegirIva('0')} />
              <Boton testID="revision-lote-iva-16" label="16 %" selected={loteIva?.tasa === '16'} disabled={!puedeLote} onPress={() => elegirIva('16')} />
              <Boton testID="revision-lote-iva-otro" label="Otro…" selected={loteIva?.tasa === 'otro'} disabled={!puedeLote} onPress={() => elegirIva('otro')} />
            </View>
            {loteIva?.tasa === 'otro' ? (
              <Entrada testID="revision-lote-iva-valor" label="IVA % para estos renglones" value={otraTasa} keyboardType="decimal-pad" onChangeText={setOtraTasa} />
            ) : null}
            {loteIva ? <Boton testID="revision-lote-iva-aplicar" label={etiquetaIva} disabled={!puedeLote || tasaLote === ''} onPress={aplicarLoteIva} /> : null}
          </View>
        ) : null}
        {sinFactor.length > 0 ? (
          <View style={styles.bloque}>
            <Texto small>{`Unidades de ${renglones(sinFactor.length)} sin factor`}</Texto>
            <View style={styles.filaFiltros}>
              <Boton testID="revision-lote-factor-uno" label="1 por 1" selected={loteFactor !== null} disabled={!puedeLote} onPress={() => setLoteFactor({ contexto: control.contextoActual() })} />
            </View>
            {loteFactor ? (
              <Boton testID="revision-lote-factor-aplicar" label={`Aplicar 1 por 1 a ${renglones(sinFactor.length)} sin factor`} disabled={!puedeLote} onPress={aplicarLoteFactor} />
            ) : null}
          </View>
        ) : null}
      </View>
    );
  }

  function renderTituloProductos(): React.JSX.Element {
    return (
      <View style={styles.bloque}>
        <Texto tone="primary">Productos</Texto>
        <Texto testID="revision-productos-resumen">{`${resumen.listas} de ${resumen.total} listos`}</Texto>
        {renderVerDocumento()}
      </View>
    );
  }

  function renderControlesProductos(): React.JSX.Element {
    return (
      <View style={styles.etapa}>
        {control.catalogoParcial ? <Texto testID="revision-catalogo-parcial" small tone="warning">{AVISO_CATALOGO_PARCIAL}</Texto> : null}
        <View style={styles.filaFiltros}>
          <Boton testID="revision-filtro-todos" label={`Todos (${resumen.total})`} selected={filtro === 'todos'} onPress={() => setFiltro('todos')} />
          <Boton testID="revision-filtro-pendientes" label={`Por revisar (${resumen.porRevisar})`} selected={filtro === 'pendientes'} onPress={() => setFiltro('pendientes')} />
          <Boton testID="revision-filtro-listos" label={`Listos (${resumen.listas})`} selected={filtro === 'listos'} onPress={() => setFiltro('listos')} />
        </View>
        {renderLote()}
      </View>
    );
  }

  function renderAgregar(): React.JSX.Element {
    return (
      <>
        <BotonDespliegue testID="revision-agregar-abrir" label="Agregar un renglón que falta" abierto={agregarAbierto} onPress={() => setAgregarAbierto(actual => !actual)} />
        {agregarAbierto ? renderFormularioOmitido() : null}
      </>
    );
  }

  function lineasVisibles(lineas: LineasEfectivas): Array<{ linea: LineasEfectivas[number]; index: number }> {
    return lineas.map((linea, index) => ({ linea, index })).filter(({ linea }) => lineaVisible(estadoPorLinea.get(linea.lineaId), filtro));
  }

  function renderProductos(): React.JSX.Element {
    if (!contenido || !efectiva || !calculo) {
      return (
        <View testID="revision-etapa-productos" style={styles.etapa}>
          <Texto tone="muted">Todavía no hay productos: primero lee la factura.</Texto>
        </View>
      );
    }
    return (
      <View testID="revision-etapa-productos" style={styles.etapa} onLayout={evento => medir('etapa', evento)}>
        {renderTituloProductos()}
        {renderControlesProductos()}
        <View testID="revision-productos-filas" style={styles.bloque} onLayout={evento => medir('filas', evento)}>
          {lineasVisibles(efectiva.lineas).map(({ linea, index }) => (
            <View key={linea.lineaId} testID={`revision-fila-${llavePorLinea.get(linea.lineaId) ?? `m${index + 1}`}`} onLayout={evento => medirFila(linea.lineaId, evento)}>
              {renderLinea(linea, index, 'completo')}
            </View>
          ))}
        </View>
        {renderAgregar()}
      </View>
    );
  }

  /**
   * Expanded screens: the list and the selected detail each own a full-height scroll outside the stage scroll, so no row
   * hides behind a height-limited list nested in another scrolling page.
   */
  function renderProductosDividido(lineas: LineasEfectivas): React.JSX.Element {
    const seleccionada = lineas.findIndex(linea => linea.lineaId === lineaAbierta);
    return (
      <View testID="revision-etapa-productos" style={styles.dividido}>
        <View style={styles.cabeceraDividida}>
          {renderEncabezado()}
          {renderTituloProductos()}
        </View>
        <View testID="revision-productos-paneles" style={styles.paneles}>
          <ScrollView testID="revision-productos-lista" style={styles.panelLista} contentContainerStyle={styles.contenidoPanel} keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets>
            {renderControlesProductos()}
            {lineasVisibles(lineas).map(({ linea, index }) => renderLinea(linea, index, 'fila'))}
            {renderAgregar()}
          </ScrollView>
          <ScrollView
            key={lineaAbierta ?? 'ninguna'}
            testID="revision-productos-detalle"
            style={styles.panelDetalle}
            contentContainerStyle={styles.contenidoPanel}
            keyboardShouldPersistTaps="handled"
            automaticallyAdjustKeyboardInsets
          >
            {seleccionada >= 0 ? renderLinea(lineas[seleccionada], seleccionada, 'detalle') : <Texto tone="muted">Elige un renglón de la lista para ver su detalle.</Texto>}
          </ScrollView>
        </View>
      </View>
    );
  }

  function renderDetallesCompra(calculoActual: NonNullable<typeof calculo>): React.JSX.Element {
    return (
      <View style={styles.bloque}>
        <BotonDespliegue testID="revision-detalles-tecnicos" label="Detalles técnicos" abierto={detalles.compra} onPress={() => setDetalles(actual => ({ ...actual, compra: !actual.compra }))} />
        {detalles.compra ? (
          <View style={styles.bloque}>
            {calculoActual.diferencias.length > 0 ? (
              <View testID="revision-diferencias">
                {esUsd ? (
                  calculoActual.diferencias.map((d, i) => (
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
            {control.representacionPos ? (
              <FacturaRevisionPos representacion={control.representacionPos} estadoExistencias={control.estadoExistencias} moneda={calculoActual.moneda} />
            ) : null}
          </View>
        ) : null}
      </View>
    );
  }

  function renderCompra(): React.JSX.Element {
    if (!contenido || !efectiva || !calculo) {
      return (
        <View testID="revision-etapa-compra" style={styles.etapa}>
          <Texto tone="muted">Todavía no hay una revisión: primero lee la factura.</Texto>
        </View>
      );
    }
    const grupos = agruparBloqueos(calculo.bloqueos, ordenLineas);
    return (
      <View testID="revision-etapa-compra" style={styles.etapa}>
        <Texto tone="primary">Compra</Texto>
        <ConfirmacionesCompra decisiones={decisiones} onEditar={control.editar} />

        <View style={styles.bloque}>
          <Texto tone="primary">{esUsd ? 'Totales (USD)' : 'Totales (sin convertir)'}</Texto>
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
        </View>

        <View testID="revision-bloqueos" style={styles.bloque}>
          <Texto tone="primary">Pendiente antes de aprobar</Texto>
          {calculo.bloqueos.length === 0 ? <Texto tone="success">Sin bloqueos</Texto> : null}
          {grupos.documento.length > 0 ? (
            <View testID="revision-bloqueos-documento" style={[styles.grupo, { borderColor: colors.border }]}>
              <Texto tone="warning">Documento</Texto>
              {grupos.documento.map((bloqueo, i) => <Texto key={i} small tone="muted">{`• ${razonBloqueo(bloqueo)}`}</Texto>)}
              {grupos.documento.some(bloqueo => RESUELTOS_EN_COMPRA.has(bloqueo.codigo)) ? (
                <Texto small tone="muted">Responde arriba si el documento está completo y si recibiste toda la mercancía.</Texto>
              ) : null}
              {grupos.documento.some(bloqueo => !RESUELTOS_EN_COMPRA.has(bloqueo.codigo)) ? <Boton testID="revision-ir-leer" label="Ir a Leer" onPress={() => irA('leer')} /> : null}
            </View>
          ) : null}
          {grupos.lineas.map(grupo => {
            const numero = numeroPorLinea.get(grupo.lineaId) ?? '';
            const llave = llavePorLinea.get(grupo.lineaId) ?? '';
            return (
              <View key={grupo.lineaId} testID={`revision-bloqueos-linea-${llave}`} style={[styles.grupo, { borderColor: colors.border }]}>
                <Texto tone="warning">{`Renglón ${numero} · Pendiente: ${pendientesDeLinea(grupo.bloqueos).join(', ')}`}</Texto>
                {grupo.bloqueos.map((bloqueo, i) => <Texto key={i} small tone="muted">{`• Renglón ${numero}: ${razonBloqueo(bloqueo)}`}</Texto>)}
                <Boton testID={`revision-ir-linea-${llave}`} label={`Ir al renglón ${numero}`} onPress={() => abrirLinea(grupo.lineaId)} />
              </View>
            );
          })}
        </View>

        <View style={styles.bloque}>
          <Entrada testID="revision-motivo-guardado" label="Motivo de esta revisión (opcional)" value={motivoGuardado} onChangeText={setMotivoGuardado} />
          {hayBorradorPrecio ? (
            <Texto testID="revision-pvp-pendiente" tone="danger">
              {`Corrige el precio de venta del renglón ${lineasConBorrador.map(l => numeroPorLinea.get(l.lineaId) ?? '').join(', ')} (o bórralo para usar el sugerido) antes de guardar o aprobar.`}
            </Texto>
          ) : null}
          <Texto small tone="muted">La aprobación es solo un registro de revisión humana: no es autoridad de compra.</Texto>
          <Texto small tone="muted">La emisión al POS sigue bloqueada: aquí solo se prepara un borrador editable de compra.</Texto>
        </View>

        {renderDetallesCompra(calculo)}
      </View>
    );
  }

  function renderCuerpo(): React.JSX.Element {
    switch (etapa) {
      case 'productos':
        return renderProductos();
      case 'compra':
        return renderCompra();
      default:
        return renderLeer();
    }
  }

  function renderEncabezado(): React.JSX.Element {
    return (
      <>
        <View style={styles.bloque}>
          <Texto testID="revision-estado" tone={tonoEstado(control.estadoVisible)}>{control.estadoVisible}</Texto>
          <Texto small tone="muted">Lo leído de la factura es una sugerencia: nada se compra ni cambia inventario desde aquí.</Texto>
        </View>

        {control.carga === 'cargando' ? <ActivityIndicator color={colors.primary} /> : null}
        {control.carga === 'no_disponible' || control.carga === 'sin_sesion' ? <Texto tone="warning" live>{RAZON_CARGA[control.carga]}</Texto> : null}
        {control.carga === 'error' ? (
          <View testID="revision-error" style={styles.bloque}>
            <Texto tone="danger" live>{RAZON_CARGA.error}</Texto>
            <Boton testID="revision-reintentar" label="Reintentar lectura" onPress={() => { descartarBorradoresPrecio(); void control.recargar(); }} />
          </View>
        ) : null}

        {control.aviso ? (
          <View testID="revision-aviso" style={[styles.aviso, { borderColor: colors.border, backgroundColor: colors.surface }]}>
            <Texto tone={tonoAviso} live>{control.aviso.texto}</Texto>
          </View>
        ) : null}
        {control.conflicto ? (
          <Boton testID="revision-recargar" label="Recargar versión del servidor (descarta mis cambios sin guardar)" danger onPress={() => { descartarBorradoresPrecio(); void control.recargar(); }} />
        ) : null}
      </>
    );
  }

  const hayPie = accion !== null || etapa !== 'leer';
  const lineasDivididas = isDesktop && etapa === 'productos' && contenido && calculo && efectiva ? efectiva.lineas : null;

  return (
    <KeyboardAvoidingView testID="factura-revision" style={[styles.raiz, { backgroundColor: colors.bg }]} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      {lineasDivididas ? (
        renderProductosDividido(lineasDivididas)
      ) : (
        <ScrollView ref={cuerpoRef} testID="revision-cuerpo" style={styles.cuerpo} contentContainerStyle={styles.contenido} keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets>
          {renderEncabezado()}
          {renderCuerpo()}
        </ScrollView>
      )}

      {hayPie ? (
        <View testID="revision-pie" style={[styles.pie, { borderTopColor: colors.border, backgroundColor: colors.bg, paddingBottom: Math.max(insets.bottom, 12) }]}>
          {accion?.razon ? <Texto testID="revision-accion-razon" small tone="warning" live>{accion.razon}</Texto> : null}
          <View style={styles.filaPie}>
            {etapa !== 'leer' ? (
              <Boton testID="revision-volver" label={etapa === 'compra' ? 'Volver a Productos' : 'Volver a Leer'} onPress={() => irA(etapa === 'compra' ? 'productos' : 'leer')} />
            ) : null}
            {accion ? (
              <View style={styles.accionPrincipal}>
                <Boton primary testID={idDeAccion(accion.id, masReciente?.id)} label={accion.etiqueta} disabled={accion.deshabilitada} onPress={() => ejecutar(accion.id)} />
              </View>
            ) : null}
          </View>
        </View>
      ) : null}
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  raiz: { flex: 1 },
  cuerpo: { flex: 1 },
  contenido: { padding: 16, gap: 12, paddingBottom: 24 },
  etapa: { gap: 12 },
  bloque: { gap: 8 },
  filaFiltros: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  grupo: { gap: 6, borderWidth: 0.5, borderRadius: 12, padding: 12 },
  dividido: { flex: 1 },
  cabeceraDividida: { paddingHorizontal: 16, paddingTop: 16, paddingBottom: 8, gap: 12 },
  paneles: { flex: 1, flexDirection: 'row', gap: 16, paddingHorizontal: 16 },
  panelLista: { flexGrow: 4, flexShrink: 1, flexBasis: 0, minWidth: 280 },
  panelDetalle: { flexGrow: 6, flexShrink: 1, flexBasis: 0, minWidth: 320 },
  contenidoPanel: { gap: 8, paddingBottom: 24 },
  aviso: { borderWidth: 0.5, borderRadius: 10, padding: 10 },
  pie: { borderTopWidth: 0.5, paddingHorizontal: 16, paddingTop: 10, gap: 8 },
  filaPie: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  accionPrincipal: { flexGrow: 1, flexShrink: 1, flexBasis: 0 },
});
