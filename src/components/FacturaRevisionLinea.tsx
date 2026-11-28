import * as React from 'react';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { scaleFont } from '../theme/responsive';
import { useTheme } from '../theme/ThemeContext';
import type { ExtraidoDescuento } from '../lib/facturaExtractionContract';
import { cmpDecimal, parseDecimal } from '../lib/facturaDecimal';
import { describeCandidateSupport, isAbsentIdentifier, type CandidateSupport, type EvidenceSource, type LineMatch, type MatchCandidate } from '../lib/facturaMatching';
import { precioVentaValido, resolverPrecioVenta } from '../lib/facturaRevision';
import type { CalculoLinea, Edicion, EstadoCodigoBarras, LineaCampoEscalar, LineaEfectiva, TipoDocumento } from '../lib/facturaRevision';
import { ETIQUETA_ESTADO_LINEA, precioCatalogo as precioDeCatalogo, type EstadoLinea } from '../lib/facturaRevisionPasos';
import { Boton, BotonDespliegue, CampoCorregible, Entrada, FilasLista, Texto, avisoImporteOculto, etiquetaMonto, formatoUsdExacto } from './FacturaRevisionCabecera';
import FacturaCodigoBarrasNuevo, { type CapturaCodigoNuevoProps } from './FacturaCodigoBarrasNuevo';
import type { PrecioCatalogo } from '../hooks/useFacturaRevision';
import type { Producto } from '../lib/producto';

/** Printed values the person may correct; the VAT rate has its own quick control. */
const CAMPOS: ReadonlyArray<{ campo: LineaCampoEscalar; label: string; decimal?: boolean; monetario?: boolean }> = [
  { campo: 'codigoProveedor', label: 'Código impreso del proveedor' },
  { campo: 'descripcion', label: 'Descripción' },
  { campo: 'cantidad', label: 'Cantidad del documento', decimal: true },
  { campo: 'unidad', label: 'Unidad del documento' },
  { campo: 'precioUnitario', label: 'Costo unitario (USD)', decimal: true, monetario: true },
  { campo: 'total', label: 'Total impreso del producto (USD)', decimal: true, monetario: true },
];

const CAMPO_IVA = { campo: 'tasaIva' as const, label: 'IVA (%)' };
const TASAS_IVA = ['0', '16'] as const;

/** Candidates shown before the person asks for more; conflicting ones and the saved choice are always added. */
const CANDIDATOS_INICIALES = 3;

const ESTADO_BARRAS: Record<EstadoCodigoBarras, string> = {
  sin_codigo: 'Sin código impreso que usar.',
  unico_verificado: 'Único verificado: ningún producto lo usa (lectura completa).',
  ya_asignado_a_este_producto: 'Ya asignado a este mismo producto.',
  colision: 'Colisión: otro producto ya usa este código.',
  reemplazo_requiere_confirmacion: 'Reemplazaría el código de barras actual del producto: no se hace sin confirmación.',
  no_verificable: 'No verificado: la lectura del catálogo fue parcial o falló, así que no se puede afirmar que sea único.',
};

export interface FacturaRevisionLineaProps {
  llave: string;
  numero: string;
  pagina: number | null;
  efectiva: LineaEfectiva;
  calculo: CalculoLinea | undefined;
  match: LineMatch | undefined;
  catalogoParcial: boolean | null;
  /** Document currency when it is not confirmed USD (null when USD is confirmed or the currency is unknown, see esUsd). */
  moneda: string | null;
  esUsd: boolean;
  estadoBarras: EstadoCodigoBarras | undefined;
  /** Header document type chosen by the person (null = undecided). */
  tipoDocumento: TipoDocumento | null;
  /** PVP typed and stored for this line (null = none: the suggestion applies). */
  precioVenta: string | null;
  /** Typed PVP text that cannot be stored yet; the view blocks saving while it exists. */
  borradorPrecio: string | undefined;
  onBorradorPrecio: (lineaId: string, texto: string | null) => void;
  onEditar: (edicion: Edicion) => { ok: boolean };
  onElegirCandidato: (codigoInterno: string) => void;
  /** Current catalog selling price (IVA included) of the chosen existing product; null for a pending or new one. */
  precioCatalogo: PrecioCatalogo | null;
  /** Retained catalog row of the chosen existing product, used only to name it; null when none was read. */
  productoElegido: Producto | null;
  /** Explicitly adopts the current catalog price as this line's saved selling price. */
  onUsarPrecioActual: () => void;
  /** The shared inventory search for a manual choice: the product picked for this line (not applied yet) and a stale-choice notice. */
  inventario: { producto: Producto | null; aviso: string | null; onBuscar: () => void };
  /** Applies the picked inventory product with this motive, through the view's fenced batch. */
  onAsociarManual: (motivo: string) => { ok: boolean };
  /** Marks the line as a new product through the view's fenced batch (the previous product's price never carries over). */
  onMarcarNuevo: (motivo: string) => { ok: boolean };
  capturaCodigo?: Omit<CapturaCodigoNuevoProps, 'id'> & { contexto: string };
  /** What the person must do next on this line, from the review calculation. */
  estado: EstadoLinea;
  /** Reasons of the line's own blockers, already worded. */
  bloqueos: readonly string[];
  /** Open (accordion) or selected (side-by-side panes). */
  abierta: boolean;
  /**
   * `completo`: row plus its detail when open (one column). `fila`: the row only, for the list pane. `detalle`: the
   * detail only, for the detail pane. The detail is mounted once, in one of the two, so it never has two scanners.
   */
  modo?: 'completo' | 'fila' | 'detalle';
  onAlternar: () => void;
  /** Closes this line and opens the next one that is not ready. */
  onSiguiente: () => void;
}

function decisionTexto(efectiva: LineaEfectiva): string {
  const { tipo, codigoInterno, evidencia, motivo } = efectiva.asociacion;
  if (tipo === 'pendiente') return 'Sin decidir: ningún producto está asociado todavía.';
  if (tipo === 'producto_nuevo') return `Producto nuevo (sin crear). Motivo: ${motivo ?? ''}`;
  return `Asociado a ${codigoInterno} (evidencia: ${evidencia === 'sugerencia' ? 'sugerencia' : 'manual'})${motivo ? `. Motivo: ${motivo}` : ''}`;
}

function colorEstado(estado: EstadoLinea, colors: { success: string; danger: string; warning: string }): string {
  switch (estado) {
    case 'listo':
      return colors.success;
    case 'revisar':
    case 'codigo_en_uso':
      return colors.danger;
    default:
      return colors.warning;
  }
}

function EstadoChip({ testID, estado }: { testID: string; estado: EstadoLinea }): React.JSX.Element {
  const { colors } = useTheme();
  const color = colorEstado(estado, colors);
  return (
    <View style={[styles.chip, { borderColor: color }]}>
      <Feather name={estado === 'listo' ? 'check-circle' : 'alert-circle'} size={14} color={color} />
      <Text testID={testID} style={[styles.chipTexto, { color }]}>{ETIQUETA_ESTADO_LINEA[estado]}</Text>
    </View>
  );
}

const CHIP_CODIGO = 'Código impreso coincide';

/** Chips come only from the matcher evidence of this candidate; retrieval-only candidates carry no evidence at all. */
function etiquetasEvidencia(candidato: MatchCandidate): string[] {
  if (candidato.evidence.length === 0) return ['Encontrado por la búsqueda'];
  const fuentes = new Set(candidato.evidence.map(e => e.source));
  return [
    fuentes.has('alias') ? 'Alias del proveedor' : null,
    ['codigo_interno', 'codigo_barras', 'referencia'].some(f => fuentes.has(f as EvidenceSource)) ? CHIP_CODIGO : null,
    fuentes.has('descripcion') ? 'Descripción parecida' : null,
  ].filter((e): e is string => e !== null);
}

const tieneEvidenciaDeCodigo = (candidato: MatchCandidate): boolean => candidato.evidence.some(e => e.source !== 'descripcion');

/** The saved decision in a few lines: the product name (when known from the matcher or the catalog), its code and any motive. */
function resumenElegido(asociacion: LineaEfectiva['asociacion'], descripcion: string | null): string[] {
  const { tipo, codigoInterno, evidencia, motivo } = asociacion;
  if (tipo === 'producto_nuevo') return ['Producto nuevo (sin crear)', `Motivo: ${motivo ?? ''}`];
  const lineas = [...(descripcion ? [descripcion] : []), `Código ${codigoInterno ?? ''}`];
  if (evidencia === 'manual') return [...lineas, `Elegido a mano. Motivo: ${motivo ?? ''}`];
  return motivo ? [...lineas, `Motivo: ${motivo}`] : lineas;
}

/** Exact comparison of two decimal texts; an unreadable one is never "the same". */
function mismoDecimal(a: string, b: string | null): boolean {
  const x = parseDecimal(a);
  const y = b === null ? null : parseDecimal(b);
  return x !== null && y !== null && cmpDecimal(x, y) === 0;
}

const SUPPORT_LABELS: Record<CandidateSupport['support'], string> = {
  codigo_coincidente: 'Código coincidente',
  en_conflicto: 'Datos en conflicto',
  pista_descripcion: 'Pista por descripción',
  pista_busqueda: 'Pista de búsqueda',
};

const ATTRIBUTE_LABELS: Readonly<Record<string, string>> = {
  size: 'tamaño', voltage: 'voltaje', power: 'potencia', gauge: 'calibre',
  material: 'material', presentation: 'presentación', model: 'modelo',
  weight: 'peso', torque: 'torque', amperage: 'amperaje',
  amperage_configuration: 'configuración de amperaje', unit: 'unidad',
};

function TarjetaCandidato(props: { id: string; candidato: MatchCandidate; support: CandidateSupport; recomendado: boolean; elegido: boolean; onElegir: () => void }): React.JSX.Element {
  const { colors } = useTheme();
  const { id, candidato, support, recomendado, elegido, onElegir } = props;
  return (
    <View testID={`${id}-tarjeta-${candidato.codigoInterno}`} style={[styles.candidato, { borderColor: elegido ? colors.primary : colors.border, backgroundColor: colors.surface }]}>
      <Texto>{candidato.descripcion}</Texto>
      <View style={styles.fila}>
        <Texto small tone="muted">{`Código ${candidato.codigoInterno}`}</Texto>
        <Texto small tone={support.support === 'en_conflicto' ? 'danger' : 'muted'}>{SUPPORT_LABELS[support.support]}</Texto>
      </View>
      {support.unknowns.length > 0 ? (
        <Texto small tone="muted">{`No comparado: ${support.unknowns.map(kind => ATTRIBUTE_LABELS[kind] ?? kind).join(', ')}`}</Texto>
      ) : null}
      <View style={styles.fila}>
        {recomendado ? <Texto small tone="primary">Recomendado</Texto> : null}
        {etiquetasEvidencia(candidato).map(etiqueta => (
          <View key={etiqueta} style={[styles.chip, { borderColor: colors.border }]}>
            <Text style={[styles.chipTexto, { color: colors.textMuted }]}>{etiqueta}</Text>
          </View>
        ))}
        <Pressable
          testID={`${id}-candidato-${candidato.codigoInterno}`}
          accessibilityRole="button"
          accessibilityLabel={`Confirmar ${candidato.descripcion}, código ${candidato.codigoInterno}`}
          accessibilityState={{ selected: elegido }}
          onPress={onElegir}
          style={({ pressed }) => [
            styles.confirmar,
            {
              borderColor: elegido ? colors.primary : colors.border,
              backgroundColor: elegido ? colors.primaryFaded : colors.surface,
              opacity: pressed ? 0.7 : 1,
            },
          ]}
        >
          <Text style={[styles.chipTexto, { color: elegido ? colors.primary : colors.text }]}>Sí, es este</Text>
        </Pressable>
      </View>
    </View>
  );
}

function Seccion({ testID, titulo, children }: { testID?: string; titulo: string; children: React.ReactNode }): React.JSX.Element {
  const { colors } = useTheme();
  return (
    <View testID={testID} style={[styles.seccion, { borderTopColor: colors.border }]}>
      <Texto tone="primary">{titulo}</Texto>
      {children}
    </View>
  );
}

export default function FacturaRevisionLinea(props: FacturaRevisionLineaProps): React.JSX.Element {
  const { colors } = useTheme();
  const { llave, numero, pagina, efectiva, calculo, match, catalogoParcial, moneda, esUsd, estadoBarras, tipoDocumento, precioVenta, borradorPrecio, onBorradorPrecio, onEditar, onElegirCandidato } = props;
  const { estado, bloqueos, abierta, onAlternar, onSiguiente, precioCatalogo, productoElegido, onUsarPrecioActual, inventario, onAsociarManual, onMarcarNuevo } = props;
  const modo = props.modo ?? 'completo';
  const id = `revision-linea-${llave}`;
  const lineaId = efectiva.lineaId;
  const [factor, setFactor] = useState('');
  const [manualMotivo, setManualMotivo] = useState('');
  const [nuevoMotivo, setNuevoMotivo] = useState('');
  const [panelProducto, setPanelProducto] = useState<'manual' | 'nuevo' | null>(null);
  const [cambiandoDesde, setCambiandoDesde] = useState<string | null>(null);
  const [verOtras, setVerOtras] = useState(false);
  const [otroIva, setOtroIva] = useState(false);
  const [otroFactor, setOtroFactor] = useState(false);
  const [cambiarFactor, setCambiarFactor] = useState(false);
  const [corregir, setCorregir] = useState(false);
  const [mas, setMas] = useState(false);
  const codigo = efectiva.campos.codigoProveedor.valor;
  const confianza = efectiva.lecturaOcr?.confianza ?? null;
  const esManual = efectiva.numeroLinea === null;
  const esNuevo = efectiva.asociacion.tipo === 'producto_nuevo';
  const iva = efectiva.campos.tasaIva;
  const ivaIndicado = iva.corregido && iva.valor !== null;
  // Unconverted amounts stay internal: no figure is shown until a conversion to USD is approved.
  const oculto = esUsd ? null : avisoImporteOculto(moneda);
  const monto = (valor: string | null): string => oculto ?? formatoUsdExacto(valor);
  const costoNetoUnitario = calculo?.costoNetoUnitarioStock ?? null;
  const costoNetoDistinto = costoNetoUnitario !== null && !mismoDecimal(costoNetoUnitario, efectiva.campos.precioUnitario.valor);
  // An existing product sells at its own shelf price (IVA included); only a new product gets the cost-based suggestion.
  const existente = efectiva.asociacion.tipo === 'confirmado';
  const actual = existente && precioCatalogo?.estado === 'listo' ? precioCatalogo.valor : null;
  const sugerido = existente ? null : resolverPrecioVenta({ tipoDocumento, costoNetoUnitario, precioVenta: null });
  const aplicado = resolverPrecioVenta({ tipoDocumento, costoNetoUnitario, precioVenta });
  const descripcion = efectiva.campos.descripcion.valor;
  const cantidad = efectiva.campos.cantidad.valor;
  const titulo = `${esManual ? 'Manual' : '#'}${numero} ${descripcion ?? 'Sin descripción'}`;
  // Changing is tied to the decision it started from: any new saved decision closes the choice again.
  const firmaAsociacion = JSON.stringify(efectiva.asociacion);
  const cambiandoProducto = cambiandoDesde === firmaAsociacion;

  function cambiarProducto(): void {
    setPanelProducto(null);
    setCambiandoDesde(firmaAsociacion);
  }

  // Valid text (or a blank, which restores the default) is stored at once, so Guardar never depends on a blur.
  // Text that cannot be stored stays here as a draft the view uses to block saving: it is never replaced by the suggestion.
  function cambiarPrecio(entrada: string): void {
    const texto = entrada.trim();
    if (texto !== '' && !precioVentaValido(texto)) {
      onBorradorPrecio(lineaId, entrada);
      return;
    }
    const { ok } = onEditar({ tipo: 'precio_venta', lineaId, valor: texto === '' ? null : texto });
    onBorradorPrecio(lineaId, ok ? null : entrada);
  }

  function estadoPrecioExistente(): { texto: string; tono: 'danger' | 'muted' | 'warning' } {
    if (precioVenta !== null && actual !== null && mismoDecimal(precioVenta, actual)) {
      return { texto: `Precio actual del inventario (IVA incluido): ${formatoUsdExacto(actual)}`, tono: 'muted' };
    }
    if (precioVenta !== null) {
      return { texto: `Se usará tu precio: ${formatoUsdExacto(precioVenta)}${actual === null ? '' : `. Precio actual del inventario: ${formatoUsdExacto(actual)}.`}`, tono: 'muted' };
    }
    if (actual !== null) return { texto: `Precio actual del inventario sin aplicar: ${formatoUsdExacto(actual)}. Úsalo o escribe otro precio antes de confirmar.`, tono: 'warning' };
    if (precioCatalogo?.estado === 'no_disponible') return { texto: 'No se pudo leer el precio actual del inventario: escribe el precio de venta.', tono: 'warning' };
    return { texto: 'Leyendo el precio actual del inventario…', tono: 'muted' };
  }

  function estadoPrecio(): { texto: string; tono: 'danger' | 'muted' | 'warning' } {
    if (borradorPrecio !== undefined) {
      return { texto: 'Precio no válido. Usa punto decimal, mayor que 0, hasta 12 enteros y 8 decimales. Corrígelo o bórralo para continuar.', tono: 'danger' };
    }
    if (existente) return estadoPrecioExistente();
    if (aplicado?.origen === 'usuario') return { texto: `Se usará tu precio: ${formatoUsdExacto(aplicado.valor)}`, tono: 'muted' };
    if (aplicado) return { texto: `Se usará el precio sugerido: ${formatoUsdExacto(aplicado.valor)}. Escribe un precio para cambiarlo.`, tono: 'muted' };
    if (tipoDocumento === null) return { texto: 'Elige el tipo de documento (factura o nota de entrega) para ver un precio sugerido.', tono: 'warning' };
    return { texto: 'Sin costo neto calculado para este producto: no hay precio sugerido.', tono: 'warning' };
  }
  const estadoDelPrecio = estadoPrecio();

  // The chips send exactly the edits of the manual path (same fields, same motive text), so a saved review never shows
  // which control was used.
  function indicarIva(tasa: string): void {
    onEditar({ tipo: 'linea_escalar', lineaId, campo: 'tasaIva', valor: tasa, motivo: `IVA indicado manualmente: ${tasa} %` });
  }

  function alternarPanel(panel: 'manual' | 'nuevo'): void {
    setPanelProducto(actual => (actual === panel ? null : panel));
  }

  const mostrarCodigoImpreso = !esNuevo || efectiva.usarCodigoFactura;
  const codigoImpreso = (codigo ?? '').trim();

  /** The saved decision in a few words; `conCambiar` adds the explicit way back to the options. */
  function renderElegido(conCambiar: boolean): React.JSX.Element {
    const candidato = match?.candidates.find(c => c.codigoInterno === efectiva.asociacion.codigoInterno);
    const descripcionElegida = candidato?.descripcion ?? productoElegido?.descripcion ?? null;
    return (
      <View testID={`${id}-elegido`} style={[styles.candidato, { borderColor: colors.primary, backgroundColor: colors.surface }]}>
        {resumenElegido(efectiva.asociacion, descripcionElegida).map((texto, i) => <Texto key={i} small={i > 0} tone={i > 0 ? 'muted' : 'text'}>{texto}</Texto>)}
        {conCambiar ? <BotonDespliegue testID={`${id}-cambiar-producto`} label="Cambiar producto" abierto={false} onPress={cambiarProducto} /> : null}
      </View>
    );
  }

  /** The first candidates, plus every conflicting one and the saved choice, so no warning hides behind "more". */
  function candidatosVisibles(lista: LineMatch): MatchCandidate[] {
    if (verOtras) return [...lista.candidates];
    const enConflicto = new Set(lista.conflicts.flatMap(c => c.codigosInternos));
    return lista.candidates.filter((c, i) => i < CANDIDATOS_INICIALES || enConflicto.has(c.codigoInterno) || c.codigoInterno === efectiva.asociacion.codigoInterno);
  }

  function renderProducto(): React.JSX.Element {
    const decidido = efectiva.asociacion.tipo !== 'pendiente';
    if (decidido && !cambiandoProducto) return <Seccion titulo="Producto">{renderElegido(true)}</Seccion>;
    const visibles = match ? candidatosVisibles(match) : [];
    const ocultos = (match?.candidates.length ?? 0) - visibles.length;
    // While changing, a chosen candidate is already its own highlighted card: the summary is only for a choice outside them.
    const elegidoEnLista = visibles.some(c => c.codigoInterno === efectiva.asociacion.codigoInterno);
    let encabezado: React.JSX.Element | null = <Texto small tone="muted">Elige el producto del inventario o indica que no está.</Texto>;
    if (decidido) encabezado = elegidoEnLista ? null : renderElegido(false);
    return (
      <Seccion titulo="¿Qué producto es?">
        {encabezado}
        {match?.feedback ? (
          <Texto testID={`${id}-feedback`} small tone="warning">
            {match.feedback.decision === 'producto_nuevo'
              ? 'Marcado como nuevo en una revisión anterior. Comprueba el catálogo antes de crear un producto.'
              : `Coincidencia guardada anteriormente: ${match.feedback.codigoInterno}. Revisa y confirma el producto.`}
          </Texto>
        ) : null}
        {match && match.candidates.length > 0 ? (
          <>
            {visibles.map(candidato => {
              const support = describeCandidateSupport(candidato, match);
              return (
                <TarjetaCandidato
                  key={candidato.codigoInterno}
                  id={id}
                  candidato={candidato}
                  support={support}
                  recomendado={candidato === match.candidates[0] && match.status === 'suggested' && support.identifiers.length > 0 && support.support !== 'en_conflicto' && support.unknowns.length === 0}
                  elegido={efectiva.asociacion.codigoInterno === candidato.codigoInterno}
                  onElegir={() => onElegirCandidato(candidato.codigoInterno)}
                />
              );
            })}
            {ocultos > 0 ? <BotonDespliegue testID={`${id}-ver-otras`} label={`Ver otras opciones (${ocultos})`} abierto={false} onPress={() => setVerOtras(true)} /> : null}
            {!isAbsentIdentifier(codigoImpreso) && !match.candidates.some(tieneEvidenciaDeCodigo) ? (
              <Texto testID={`${id}-codigo-sin-coincidencia`} small tone="muted">{`Entre estos candidatos, ninguno tiene el código impreso ${codigoImpreso}.`}</Texto>
            ) : null}
          </>
        ) : match ? (
          <>
              <Texto testID={`${id}-sin-candidatos`} small tone="warning">{catalogoParcial ? 'No se revisó todo el inventario: no encontrarlo aquí no prueba que el producto no exista. Búscalo por su código antes de marcarlo como nuevo.' : 'No se encontraron productos en esta búsqueda. Falta que elijas uno o indiques que es nuevo.'}</Texto>
            {catalogoParcial ? <Boton testID={`${id}-sin-candidatos-sku`} label="Es otro producto" onPress={() => setPanelProducto('manual')} /> : null}
          </>
        ) : null}
        {match && match.conflicts.length > 0 ? <Texto small tone="danger">Hay señales en conflicto entre código y descripción: revisa con cuidado.</Texto> : null}
        <View style={styles.fila}>
          <BotonDespliegue testID={`${id}-manual-abrir`} label="Es otro producto" abierto={panelProducto === 'manual'} onPress={() => alternarPanel('manual')} />
          <BotonDespliegue testID={`${id}-nuevo-abrir`} label="No está en el inventario" abierto={panelProducto === 'nuevo'} onPress={() => alternarPanel('nuevo')} />
        </View>
        {panelProducto === 'manual' ? renderManual() : null}
        {panelProducto === 'nuevo' ? (
          <View style={styles.panel}>
            <Texto small tone="muted">No se crea el producto ahora.</Texto>
            <Boton testID={`${id}-nuevo-motivo-sugerido`} label="No existe en el inventario" onPress={() => setNuevoMotivo('No existe en el inventario')} />
            <Entrada testID={`${id}-nuevo-motivo`} label="Motivo: es un producto nuevo" value={nuevoMotivo} onChangeText={setNuevoMotivo} />
            <Boton
              testID={`${id}-nuevo-aplicar`}
              label="Marcar como nuevo"
              disabled={nuevoMotivo.trim() === ''}
              onPress={() => {
                if (onMarcarNuevo(nuevoMotivo.trim()).ok) setNuevoMotivo('');
              }}
            />
          </View>
        ) : null}
        {decidido ? (
          <View style={styles.fila}>
            <Boton testID={`${id}-cambiar-cancelar`} label="Mantener elección" onPress={() => setCambiandoDesde(null)} />
            <Boton testID={`${id}-pendiente`} label="Deshacer elección" danger onPress={() => onEditar({ tipo: 'asociacion', lineaId, asociacion: { tipo: 'pendiente', codigoInterno: null, evidencia: null, motivo: null } })} />
          </View>
        ) : null}
      </Seccion>
    );
  }

  /** A product from the shared inventory search, applied only with a motive: nothing is chosen until Usar este producto. */
  function renderManual(): React.JSX.Element {
    const elegido = inventario.producto;
    return (
      <View style={styles.panel}>
        <Boton testID={`${id}-manual-buscar`} label={elegido ? 'Buscar otro' : 'Buscar en inventario'} onPress={inventario.onBuscar} />
        {inventario.aviso ? <Texto testID={`${id}-manual-aviso`} small tone="warning">{inventario.aviso}</Texto> : null}
        {elegido ? (
          <View testID={`${id}-manual-elegido`} style={[styles.candidato, { borderColor: colors.primary, backgroundColor: colors.surface }]}>
            <Texto>{elegido.descripcion}</Texto>
            <Texto small tone="muted">{`Código ${elegido.codigo_interno} · Existencia ${elegido.existencia} ${elegido.unidad || 'uds'}`}</Texto>
            {esUsd ? <Texto small tone="muted">{`Precio actual: ${formatoUsdExacto(precioDeCatalogo(elegido))} (IVA incluido)`}</Texto> : null}
          </View>
        ) : null}
        <Boton testID={`${id}-manual-motivo-sugerido`} label="La sugerencia era otro producto" onPress={() => setManualMotivo('La sugerencia era otro producto')} />
        <Entrada testID={`${id}-manual-motivo`} label="Por qué elegiste este producto" value={manualMotivo} onChangeText={setManualMotivo} />
        <Boton
          testID={`${id}-manual-aplicar`}
          label="Usar este producto"
          disabled={elegido === null || manualMotivo.trim() === ''}
          onPress={() => {
            if (onAsociarManual(manualMotivo.trim()).ok) setManualMotivo('');
          }}
        />
      </View>
    );
  }

  /** Secondary exception: the invoice-wide answer is the primary path; this keeps a saved mixed invoice editable. */
  function renderIva(): React.JSX.Element {
    return (
      <View style={[styles.caja, { borderColor: colors.border }]}>
        <Texto small tone="muted">IVA solo de este producto (excepción)</Texto>
        <Texto testID={`revision-iva-${llave}-estado`} tone={ivaIndicado ? 'text' : 'warning'}>
          {ivaIndicado ? `Indicado: ${iva.valor} %` : 'Sin definir'}
        </Texto>
        {iva.original !== null ? <Texto small tone="muted">{`El documento indica IVA ${iva.original}. Es solo referencia: confírmalo tú.`}</Texto> : null}
        <View style={styles.fila}>
          {TASAS_IVA.map(tasa => (
            <Boton key={tasa} testID={`revision-iva-${llave}-${tasa}`} label={`${tasa} %`} selected={iva.corregido && iva.valor === tasa} onPress={() => indicarIva(tasa)} />
          ))}
          <BotonDespliegue testID={`revision-iva-${llave}-otro`} label="Otro…" abierto={otroIva} onPress={() => setOtroIva(actual => !actual)} />
        </View>
        {otroIva ? (
          <CampoCorregible
            base={`${id}-${CAMPO_IVA.campo}`}
            label={CAMPO_IVA.label}
            efectivo={iva}
            keyboardType="decimal-pad"
            onAplicar={(valor, motivo) => onEditar({ tipo: 'linea_escalar', lineaId, campo: CAMPO_IVA.campo, valor, motivo })}
            onRevertir={() => onEditar({ tipo: 'revertir_linea', lineaId, campo: CAMPO_IVA.campo })}
          />
        ) : null}
      </View>
    );
  }

  function renderUnidades(): React.JSX.Element {
    const decidido = efectiva.factorConversion !== null;
    const estadoFactor = (
      <Texto testID={`revision-factor-${llave}-estado`} tone={decidido ? 'text' : 'warning'}>
        {decidido ? `Confirmado: ${efectiva.factorConversion}` : 'Sin confirmar'}
      </Texto>
    );
    // A decided factor is one line; its controls come back only on request (package exceptions stay reachable).
    if (decidido && !cambiarFactor) {
      return (
        <Seccion titulo="Unidades por cada una de la factura">
          <View style={styles.fila}>
            {estadoFactor}
            <BotonDespliegue testID={`revision-factor-${llave}-cambiar`} label="Cambiar" abierto={false} onPress={() => setCambiarFactor(true)} />
          </View>
        </Seccion>
      );
    }
    return (
      <Seccion titulo="Unidades por cada una de la factura">
        {estadoFactor}
        <View style={styles.fila}>
          <Boton
            testID={`revision-factor-${llave}-uno`}
            label="1"
            selected={efectiva.factorConversion === '1'}
            onPress={() => onEditar({ tipo: 'factor_conversion', lineaId, valor: '1' })}
          />
          <BotonDespliegue testID={`revision-factor-${llave}-otro`} label="Otra…" abierto={otroFactor} onPress={() => setOtroFactor(actual => !actual)} />
        </View>
        {otroFactor ? (
          <View style={styles.panel}>
            <Entrada testID={`${id}-factor-valor`} label="Unidades que trae cada una" value={factor} keyboardType="decimal-pad" onChangeText={setFactor} />
            <Boton testID={`${id}-factor-aplicar`} label="Guardar" disabled={factor.trim() === ''} onPress={() => { onEditar({ tipo: 'factor_conversion', lineaId, valor: factor.trim() }); setFactor(''); }} />
          </View>
        ) : null}
      </Seccion>
    );
  }

  function renderPrecioVenta(): React.JSX.Element {
    return (
      <Seccion testID={`${id}-precio`} titulo="Costo y precio de venta">
        <Texto testID={`${id}-lectura`} small tone="muted">{`Leído de la factura: cantidad ${cantidad ?? 'sin dato'} · costo unitario ${monto(efectiva.campos.precioUnitario.valor)}`}</Texto>
        {oculto ? (
          <Texto testID={`${id}-pvp-oculto`} small tone="warning">{oculto}</Texto>
        ) : (
          <>
            {costoNetoDistinto ? (
              <Texto testID={`${id}-pvp-costo-neto`} small>{`Costo neto por unidad de inventario (sin IVA, con descuentos): ${formatoUsdExacto(costoNetoUnitario)}`}</Texto>
            ) : null}
            <Entrada
              testID={`${id}-pvp-valor`}
              label="Precio de venta (USD)"
              hint={existente ? 'Precio con IVA incluido.' : 'Déjalo vacío para usar el precio sugerido.'}
              placeholder={placeholderPrecio()}
              legible
              // Only a saved or typed price is the value: an unapplied catalog price stays the placeholder, so clearing
              // the field leaves it empty instead of snapping back to the catalog figure.
              value={borradorPrecio ?? precioVenta ?? ''}
              keyboardType="decimal-pad"
              onChangeText={cambiarPrecio}
            />
            <Texto testID={`${id}-pvp-estado`} small tone={estadoDelPrecio.tono}>{estadoDelPrecio.texto}</Texto>
            {actual !== null && borradorPrecio === undefined && (precioVenta === null || !mismoDecimal(precioVenta, actual)) ? (
              <Boton testID={`${id}-pvp-usar-actual`} label="Usar precio actual" onPress={onUsarPrecioActual} />
            ) : null}
          </>
        )}
      </Seccion>
    );
  }

  function placeholderPrecio(): string {
    if (existente) return actual === null ? 'Escribe el precio de venta' : formatoUsdExacto(actual);
    return sugerido ? formatoUsdExacto(sugerido.valor) : 'Sin precio sugerido';
  }

  function renderMasOpciones(): React.JSX.Element {
    return (
      <View style={styles.panel}>
        <Texto testID={`${id}-pagina`} small tone="muted">{pagina === null ? 'Página: sin dato' : `Página ${pagina}`}</Texto>
        <Texto testID={`${id}-ocr`} small tone="muted">
          {confianza === null ? 'Lectura OCR: sin dato de confianza' : `Lectura OCR: ${Math.round(confianza * 100)} %`}
        </Texto>
        {efectiva.lecturaOcr?.campoDudoso.length ? <Texto small tone="warning">{`Campos dudosos: ${efectiva.lecturaOcr.campoDudoso.join(', ')}`}</Texto> : null}

        {renderIva()}

        <View style={[styles.caja, { borderColor: colors.border }]}>
          <Texto small tone="muted">{esUsd ? 'Importes calculados (USD, exactos)' : 'Importes calculados (sin convertir)'}</Texto>
          <Texto testID={`${id}-importe-final`}>{`Importe tras descuentos: ${monto(calculo?.importeFinal ?? null)}`}</Texto>
          <Texto testID={`${id}-base`} small>{esUsd ? `Base sin IVA: ${monto(calculo?.base ?? null)} · IVA: ${monto(calculo?.iva ?? null)}` : `Base sin IVA e IVA: ${oculto}`}</Texto>
          <Texto testID={`${id}-costo-unitario`}>{`Costo neto por unidad de inventario: ${monto(calculo?.costoNetoUnitarioStock ?? null)}`}</Texto>
          <Texto small tone="muted">{`Cantidad en inventario: ${calculo?.cantidadStock ?? 'desconocida'} · Cantidad del documento: ${calculo?.cantidadDocumento ?? 'sin dato'}`}</Texto>
        </View>

        <FilasLista
          base={`${id}-descuentos`}
          tipo="descuentos"
          titulo="Descuentos del producto (en orden)"
          oculto={oculto}
          efectivo={efectiva.descuentos}
          onAplicar={(valor, motivo) => onEditar({ tipo: 'linea_descuentos', lineaId, valor: valor as ExtraidoDescuento[], motivo })}
        />

        {mostrarCodigoImpreso ? (
          <View style={[styles.caja, { borderColor: colors.border }]}>
            <Texto small tone="muted">Código de barras propuesto: el código impreso, tal cual</Texto>
            <Texto testID={`${id}-barras-codigo`}>{codigo ?? ''}</Texto>
            {esNuevo ? <Texto small tone="warning">En un producto nuevo el código impreso va en Referencia, no como código de barras. Desactívalo.</Texto> : null}
            <Boton
              testID={`${id}-barras-usar`}
              label={efectiva.usarCodigoFactura ? 'Usar el código impreso: sí' : 'Usar el código impreso: no'}
              selected={efectiva.usarCodigoFactura}
              onPress={() => onEditar({ tipo: 'codigo_barras', lineaId, usarCodigoFactura: !efectiva.usarCodigoFactura })}
            />
            {efectiva.usarCodigoFactura ? (
              <Texto testID={`${id}-barras-estado`} small tone={estadoBarras === 'unico_verificado' || estadoBarras === 'ya_asignado_a_este_producto' ? 'success' : 'warning'}>
                {efectiva.asociacion.tipo === 'pendiente' ? 'Elige primero el producto del inventario.' : ESTADO_BARRAS[estadoBarras ?? 'no_verificable']}
              </Texto>
            ) : null}
          </View>
        ) : null}

        {esManual ? <Boton testID={`${id}-quitar`} label="Quitar producto agregado a mano" danger onPress={() => onEditar({ tipo: 'quitar_linea_manual', lineaId })} /> : null}
      </View>
    );
  }

  function renderDetalle(): React.JSX.Element {
    return (
      <View testID={`${id}-detalle`} style={modo === 'detalle' ? [styles.tarjeta, { backgroundColor: colors.surface, borderColor: colors.primary }] : styles.detalle}>
        {modo === 'detalle' ? <Texto tone="primary">{titulo}</Texto> : null}
        {estado === 'revisar' && bloqueos.length > 0 ? bloqueos.map((texto, i) => <Texto key={i} small tone="danger">{`• ${texto}`}</Texto>) : null}
        {renderProducto()}
        {estado === 'falta_codigo' ? <Texto small tone="warning">Escanea o escribe el código de barras del producto nuevo: sin él no se puede preparar el borrador de compra.</Texto> : null}
        {esNuevo && props.capturaCodigo ? <FacturaCodigoBarrasNuevo key={props.capturaCodigo.contexto} {...props.capturaCodigo} id={id} /> : null}
        {ivaIndicado ? null : <Texto testID={`${id}-iva-factura-aviso`} small tone="warning">Falta el IVA: indícalo una vez en &quot;IVA de la factura&quot;, arriba.</Texto>}
        {renderUnidades()}
        {renderPrecioVenta()}
        <BotonDespliegue testID={`${id}-corregir`} label="Corregir lectura" abierto={corregir} onPress={() => setCorregir(actual => !actual)} />
        {corregir
          ? CAMPOS.map(({ campo, label, decimal, monetario }) => (
              <CampoCorregible
                key={campo}
                base={`${id}-${campo}`}
                label={etiquetaMonto(label, esUsd)}
                efectivo={efectiva.campos[campo]}
                keyboardType={decimal ? 'decimal-pad' : 'default'}
                oculto={monetario ? oculto : null}
                onAplicar={(valor, motivo) => onEditar({ tipo: 'linea_escalar', lineaId, campo, valor, motivo })}
                onRevertir={() => onEditar({ tipo: 'revertir_linea', lineaId, campo })}
              />
            ))
          : null}
        <BotonDespliegue testID={`${id}-mas`} label="Más opciones" abierto={mas} onPress={() => setMas(actual => !actual)} />
        {mas ? renderMasOpciones() : null}
        <Boton testID={`${id}-siguiente`} label="Siguiente producto" onPress={onSiguiente} />
      </View>
    );
  }

  if (modo === 'detalle') return renderDetalle();

  return (
    <View testID={id} style={[styles.tarjeta, { backgroundColor: colors.surface, borderColor: abierta ? colors.primary : colors.border }]}>
      <Pressable
        testID={`${id}-abrir`}
        accessibilityRole="button"
        accessibilityLabel={`${titulo}. ${ETIQUETA_ESTADO_LINEA[estado]}`}
        accessibilityState={modo === 'fila' ? { selected: abierta } : { expanded: abierta }}
        onPress={onAlternar}
        style={({ pressed }) => [styles.cabeza, { opacity: pressed ? 0.8 : 1 }]}
      >
        <View style={styles.cabezaTexto}>
          <Texto tone="primary">{titulo}</Texto>
          {/* Open in one column, the detail shows these values next to the selling price instead. */}
          {modo === 'completo' && abierta ? null : (
            <Texto small tone="muted">{`Cantidad ${cantidad ?? 'sin dato'}${esUsd ? ` · Costo ${formatoUsdExacto(efectiva.campos.precioUnitario.valor)}` : ''}`}</Texto>
          )}
          <View style={styles.filaCodigo}>
            <Texto small tone="muted">Código impreso:</Texto>
            <Texto testID={`${id}-codigo`}>{codigo ?? ''}</Texto>
          </View>
          <Texto testID={`${id}-decision`} small tone={efectiva.asociacion.tipo === 'pendiente' ? 'warning' : 'text'}>{decisionTexto(efectiva)}</Texto>
        </View>
        <View style={styles.cabezaEstado}>
          <EstadoChip testID={`${id}-estado`} estado={estado} />
          {modo === 'completo' ? <Feather name={abierta ? 'chevron-up' : 'chevron-down'} size={18} color={colors.textMuted} /> : null}
        </View>
      </Pressable>

      {modo === 'completo' && abierta ? renderDetalle() : null}
    </View>
  );
}

const styles = StyleSheet.create({
  tarjeta: { borderWidth: 0.5, borderRadius: 12, padding: 12, gap: 10 },
  cabeza: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, minHeight: 44 },
  cabezaTexto: { flexGrow: 1, flexShrink: 1, flexBasis: 0, gap: 3 },
  cabezaEstado: { alignItems: 'flex-end', gap: 6 },
  filaCodigo: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6 },
  candidato: { borderWidth: 0.5, borderRadius: 10, padding: 10, gap: 6 },
  confirmar: { borderWidth: 1, borderRadius: 8, minHeight: 44, paddingHorizontal: 14, alignItems: 'center', justifyContent: 'center' },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 4, borderWidth: 1, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 4 },
  chipTexto: { fontSize: scaleFont(11), fontFamily: 'JetBrainsMono_700Bold' },
  detalle: { gap: 12 },
  seccion: { gap: 8, borderTopWidth: 0.5, paddingTop: 12 },
  fila: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8 },
  panel: { gap: 8 },
  caja: { borderWidth: 0.5, borderRadius: 10, padding: 10, gap: 6 },
});
