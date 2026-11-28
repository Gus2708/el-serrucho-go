import { MAX_DESCUENTO_STEPS, parseDescuentoTexto } from './compraDescuentos';
import { cmpDecimal, parseDecimal } from './facturaDecimal';
import type { ExtraidoDescuento } from './facturaExtractionContract';
import { precioVentaValido } from './facturaRevision';
import type { AsociacionRevision, Bloqueo, CalculoRevision, CodigoBloqueo, Edicion, LineaEfectiva, LineaRevision } from './facturaRevision';

/** The three bodies of the guided review; the outer shell owns the stepper and may control which one is shown. */
export type EtapaRevision = 'leer' | 'productos' | 'compra';

/** What the person must do next on one line. Presentation only: the domain calculation decides the real blockers. */
export type EstadoLinea =
  | 'elegir_producto'
  | 'falta_iva'
  | 'faltan_unidades'
  | 'falta_codigo'
  | 'verificando_codigo'
  | 'codigo_sin_verificar'
  | 'codigo_en_uso'
  | 'falta_precio'
  | 'revisar'
  | 'listo';

export const ETIQUETA_ESTADO_LINEA: Readonly<Record<EstadoLinea, string>> = {
  elegir_producto: 'Elige el producto',
  falta_iva: 'Falta IVA',
  faltan_unidades: 'Faltan unidades por paquete',
  falta_codigo: 'Nuevo: escanea el código',
  verificando_codigo: 'Verificando código',
  codigo_sin_verificar: 'No se pudo verificar el código',
  codigo_en_uso: 'Código ya usado',
  falta_precio: 'Falta el precio de venta',
  revisar: 'Revisa los datos',
  listo: 'Listo',
};

/** Result of looking a captured code up in the catalog; `skus` lists the products that already use it. */
export interface VerificacionCodigo {
  readonly tipo: 'cargando' | 'incompleta' | 'sin_coincidencias' | 'colision';
  readonly skus?: readonly string[];
}

function estadoDeCodigoNuevo(verificacion: VerificacionCodigo | undefined): EstadoLinea | null {
  switch (verificacion?.tipo) {
    case 'sin_coincidencias':
      return null;
    case 'incompleta':
      return 'codigo_sin_verificar';
    case 'colision':
      return 'codigo_en_uso';
    default:
      return 'verificando_codigo';
  }
}

/**
 * Reads the line's own blockers from the existing calculation. Document-level blockers (completeness, receipt, VAT
 * inclusion) never mark a line. A new product needs a captured physical code, and that code is ready only after a
 * complete lookup found no other product using it (`verificacion`, for this exact code; absent means not answered yet).
 * Neither is a calculation blocker, but the purchase draft cannot use a missing code, so the line stays pending here.
 */
export function estadoLinea(linea: LineaRevision, calculo: CalculoRevision, verificacion?: VerificacionCodigo): EstadoLinea {
  const propios = new Set(calculo.bloqueos.filter(bloqueo => bloqueo.lineaId === linea.lineaId).map(bloqueo => bloqueo.codigo));
  if (linea.asociacion.tipo === 'pendiente') return 'elegir_producto';
  if (propios.has('iva_tasa_desconocida')) return 'falta_iva';
  if (propios.has('conversion_no_confirmada')) return 'faltan_unidades';
  if (linea.asociacion.tipo === 'producto_nuevo') {
    if (!linea.codigoBarras.codigoEscaneado) return 'falta_codigo';
    const pendiente = estadoDeCodigoNuevo(verificacion);
    if (pendiente) return pendiente;
  }
  if (propios.size > 0) return 'revisar';
  // An existing product sells at a saved price; only a new product falls back to the cost-based suggestion.
  return linea.asociacion.tipo === 'confirmado' && linea.precioVenta === undefined ? 'falta_precio' : 'listo';
}

export function resumenLineas(estados: readonly EstadoLinea[]): { total: number; listas: number; porRevisar: number } {
  const listas = estados.filter(estado => estado === 'listo').length;
  return { total: estados.length, listas, porRevisar: estados.length - listas };
}

/** The next line, other than `desdeLineaId`, that is not ready (wrapping around), or null when there is none. */
export function siguientePorRevisar(estados: ReadonlyArray<{ lineaId: string; estado: EstadoLinea }>, desdeLineaId: string | null): string | null {
  const inicio = desdeLineaId === null ? 0 : estados.findIndex(item => item.lineaId === desdeLineaId) + 1;
  for (let paso = 0; paso < estados.length; paso++) {
    const candidata = estados[(inicio + paso) % estados.length];
    if (candidata.estado !== 'listo' && candidata.lineaId !== desdeLineaId) return candidata.lineaId;
  }
  return null;
}

export type AccionPrincipalId = 'siguiente_producto' | 'leer' | 'revisar_leido' | 'continuar_productos' | 'continuar_compra' | 'ir_leer' | 'guardar' | 'aprobar' | 'preparar';

export interface AccionPrincipal {
  readonly id: AccionPrincipalId;
  readonly etiqueta: string;
  readonly deshabilitada: boolean;
  /** Why the action is disabled; null when enabled or when the label itself says it (progress). */
  readonly razon: string | null;
}

/** Flags the view already reads from the review hook; nothing here is recomputed. */
export interface SituacionRevision {
  readonly etapa: EtapaRevision;
  readonly carga: 'cargando' | 'listo' | 'no_disponible' | 'error' | 'sin_sesion';
  readonly hayContenido: boolean;
  readonly porRevisar?: number;
  readonly hayExtraccionUsable: boolean;
  readonly intentoFallido: boolean;
  readonly ocupado: 'guardando' | 'aprobando' | 'extrayendo' | null;
  readonly puedeExtraer: boolean;
  readonly razonNoExtraer: string | null;
  readonly conflicto: boolean;
  readonly sucio: boolean;
  readonly editorDirty: boolean;
  readonly puedeGuardar: boolean;
  readonly puedeAprobar: boolean;
  readonly puedeMaterializar: boolean;
  readonly materializando: boolean;
  readonly hayBorradorPrecio: boolean;
  /** Existing products without a saved selling price: approval and the purchase draft wait for them. */
  readonly preciosPendientes?: number;
  readonly sinBloqueos: boolean;
  /** The latest saved revision carries an approval (it may no longer be valid for the current invoice version). */
  readonly aprobada: boolean;
}

function accion(id: AccionPrincipalId, etiqueta: string, deshabilitada = false, razon: string | null = null): AccionPrincipal {
  return { id, etiqueta, deshabilitada, razon };
}

function razonPreciosPendientes(cantidad: number): string {
  const productos = cantidad === 1 ? '1 producto existente' : `${cantidad} productos existentes`;
  return `Falta el precio de venta de ${productos}: usa el precio actual o escribe uno.`;
}

function accionCompra(s: SituacionRevision): AccionPrincipal {
  const preciosPendientes = s.preciosPendientes ?? 0;
  if (s.materializando) return accion('preparar', 'Preparando borrador…', true);
  if (s.ocupado === 'guardando') return accion('guardar', 'Guardando…', true);
  if (s.ocupado === 'aprobando') return accion('aprobar', 'Confirmando…', true);
  if (s.sucio) {
    if (s.conflicto) return accion('guardar', 'Guardar cambios', true, 'Hay una versión más reciente en el servidor: recárgala para continuar.');
    if (s.hayBorradorPrecio) return accion('guardar', 'Guardar cambios', true, 'Corrige o borra el precio de venta no válido para guardar.');
    return accion('guardar', 'Guardar cambios', !s.puedeGuardar, s.puedeGuardar ? null : 'Ahora no se puede guardar: espera a que termine la operación en curso o revisa la sesión.');
  }
  if (!s.aprobada) {
    if (s.hayBorradorPrecio) return accion('aprobar', 'Confirmar revisión', true, 'Corrige o borra el precio de venta no válido para confirmar.');
    if (preciosPendientes > 0) return accion('aprobar', 'Confirmar revisión', true, razonPreciosPendientes(preciosPendientes));
    if (s.puedeAprobar) return accion('aprobar', 'Confirmar revisión');
    if (s.conflicto) return accion('aprobar', 'Confirmar revisión', true, 'Hay una versión más reciente en el servidor: recárgala para continuar.');
    if (!s.sinBloqueos) return accion('aprobar', 'Confirmar revisión', true, 'Completa los datos que faltan para confirmar.');
    if (s.editorDirty) return accion('aprobar', 'Confirmar revisión', true, 'Guarda los cambios de la factura antes de confirmar.');
    return accion('aprobar', 'Confirmar revisión', true, 'Ahora no se puede confirmar: guarda los cambios o revisa la sesión.');
  }
  if (preciosPendientes > 0) return accion('preparar', 'Crear borrador de compra', true, razonPreciosPendientes(preciosPendientes));
  if (s.puedeMaterializar) return accion('preparar', 'Crear borrador de compra');
  if (s.editorDirty) return accion('preparar', 'Crear borrador de compra', true, 'Guarda los cambios de la factura antes de preparar la compra.');
  return accion('preparar', 'Crear borrador de compra', true, 'Cambiaste la factura: guarda los cambios y confirma de nuevo.');
}

/** The single next step of the current stage. Null when the screen shows its own recovery control instead. */
export function accionPrincipal(s: SituacionRevision): AccionPrincipal | null {
  if (s.carga !== 'listo') return null;
  if (s.etapa === 'leer' || s.etapa === 'productos') {
    if (s.ocupado === 'extrayendo') return accion('leer', 'Buscando productos…', true);
    if (s.hayContenido) {
      const pendientes = s.porRevisar ?? 0;
      return pendientes > 0
        ? accion('siguiente_producto', `Revisar siguiente (${pendientes} ${pendientes === 1 ? 'falta' : 'faltan'})`)
        : accion('continuar_compra', 'Seguir a la compra');
    }
    if (s.hayExtraccionUsable) return accion('revisar_leido', 'Ver productos encontrados');
    return accion('leer', s.intentoFallido ? 'Intentar de nuevo' : 'Buscar productos', !s.puedeExtraer, s.puedeExtraer ? null : s.razonNoExtraer);
  }
  if (!s.hayContenido) return accion('ir_leer', 'Ir a Productos');
  return accionCompra(s);
}

export interface GrupoBloqueosLinea {
  readonly lineaId: string;
  readonly bloqueos: readonly Bloqueo[];
}

export interface BloqueosAgrupados {
  readonly documento: readonly Bloqueo[];
  readonly lineas: readonly GrupoBloqueosLinea[];
}

/**
 * Splits the calculation's blockers into the document ones and one group per line, in the order the lines are shown,
 * so every reason stays next to the action that opens its own line. A line missing from the order keeps its group, last.
 */
export function agruparBloqueos(bloqueos: readonly Bloqueo[], lineasEnOrden: readonly string[]): BloqueosAgrupados {
  const porLinea = new Map<string, Bloqueo[]>();
  const documento: Bloqueo[] = [];
  for (const bloqueo of bloqueos) {
    if (bloqueo.lineaId === null) documento.push(bloqueo);
    else porLinea.set(bloqueo.lineaId, [...(porLinea.get(bloqueo.lineaId) ?? []), bloqueo]);
  }
  const orden = [...lineasEnOrden.filter(id => porLinea.has(id)), ...[...porLinea.keys()].filter(id => !lineasEnOrden.includes(id))];
  return { documento, lineas: orden.map(lineaId => ({ lineaId, bloqueos: porLinea.get(lineaId) ?? [] })) };
}

const PENDIENTE_CORTO: Partial<Record<CodigoBloqueo, string>> = {
  asociacion_pendiente: 'producto',
  iva_tasa_desconocida: 'IVA',
  conversion_no_confirmada: 'unidades',
  codigo_barras_no_verificado: 'código de barras',
  cantidad_cero: 'cantidad',
};

/** Short words for what a line still needs, once each; the full reasons stay listed under them. */
export function pendientesDeLinea(bloqueos: readonly Bloqueo[]): string[] {
  return [...new Set(bloqueos.map(bloqueo => PENDIENTE_CORTO[bloqueo.codigo] ?? 'datos'))];
}

/** Lines that carry this blocker right now, in display order: the only targets an explicit batch may touch. */
export function lineasConBloqueo(bloqueos: readonly Bloqueo[], codigo: CodigoBloqueo, lineasEnOrden: readonly string[]): string[] {
  const conBloqueo = new Set(bloqueos.filter(bloqueo => bloqueo.codigo === codigo && bloqueo.lineaId !== null).map(bloqueo => bloqueo.lineaId));
  return lineasEnOrden.filter(id => conBloqueo.has(id));
}

/** The edit of the per-line VAT chips: same field and motive, so a saved review never shows which control was used. */
export function edicionIvaManual(lineaId: string, tasa: string): Edicion {
  return { tipo: 'linea_escalar', lineaId, campo: 'tasaIva', valor: tasa, motivo: `IVA indicado manualmente: ${tasa} %` };
}

/** The edit of the per-line "1 por 1" chip. */
export function edicionFactorUno(lineaId: string): Edicion {
  return { tipo: 'factor_conversion', lineaId, valor: '1' };
}

// ── Invoice-wide VAT and percentage discount ────────────────────────────────

/** VAT decided for the invoice, read from the explicit per-line decisions (a printed rate is never a decision). */
export interface EstadoIvaFactura {
  readonly total: number;
  /** Lines without an explicit VAT decision. */
  readonly faltan: number;
  /** Distinct decided rates, ascending. */
  readonly tasas: readonly string[];
}

function tasaIndicada(linea: LineaEfectiva): string | null {
  const iva = linea.campos.tasaIva;
  return iva.corregido && iva.valor !== null ? iva.valor : null;
}

function compararTasas(a: string, b: string): number {
  const x = parseDecimal(a);
  const y = parseDecimal(b);
  if (x === null || y === null) return a.localeCompare(b);
  return cmpDecimal(x, y);
}

const mismaTasa = (a: string, b: string): boolean => compararTasas(a, b) === 0;

export function estadoIvaFactura(lineas: readonly LineaEfectiva[]): EstadoIvaFactura {
  const tasas: string[] = [];
  let faltan = 0;
  for (const linea of lineas) {
    const tasa = tasaIndicada(linea);
    if (tasa === null) faltan += 1;
    else if (!tasas.some(t => mismaTasa(t, tasa))) tasas.push(tasa);
  }
  return { total: lineas.length, faltan, tasas: tasas.sort(compararTasas) };
}

/**
 * The per-line edits of one invoice-wide VAT answer, with the manual-path payload. `faltan` only fills lines without a
 * decision, so an exempt or other explicit rate survives; `todas` is the explicit overwrite. A line already at `tasa`
 * is never rewritten, so its saved motive stays as it was.
 */
export function edicionesIvaFactura(lineas: readonly LineaEfectiva[], tasa: string, alcance: 'faltan' | 'todas'): Edicion[] {
  return lineas
    .filter(linea => {
      const actual = tasaIndicada(linea);
      return actual === null || (alcance === 'todas' && !mismaTasa(actual, tasa));
    })
    .map(linea => edicionIvaManual(linea.lineaId, tasa));
}

export type ResumenDescuentoFactura =
  | { readonly tipo: 'ninguno' }
  | { readonly tipo: 'porcentajes'; readonly porcentajes: readonly string[] }
  | { readonly tipo: 'incluidos' }
  | { readonly tipo: 'otro' };

/** `porcentajes` is exactly what the calculation applies without a policy; anything else needs a person to look. */
export function resumenDescuentoFactura(descuentos: readonly ExtraidoDescuento[]): ResumenDescuentoFactura {
  if (descuentos.length === 0) return { tipo: 'ninguno' };
  if (descuentos.every(d => d.alcance === 'global' && d.incluidoEnPrecio === true)) return { tipo: 'incluidos' };
  const ordenados = [...descuentos].sort((a, b) => a.orden - b.orden);
  if (ordenados.every(d => d.alcance === 'global' && d.incluidoEnPrecio === false && d.porcentaje !== null && d.monto === null)) {
    return { tipo: 'porcentajes', porcentajes: ordenados.map(d => d.porcentaje as string) };
  }
  return { tipo: 'otro' };
}

const PORCENTAJE_EXACTO = /^[0-9]{1,2}(\.[0-9]{1,4})?$/;

/**
 * Reads typed invoice percentages ("10", "20+5", "12,5 %") with the purchase-discount parser. Each step must stay an
 * exact decimal the review contract accepts, so nothing is rounded on the way.
 */
export function leerPorcentajesFactura(texto: string): { readonly ok: true; readonly porcentajes: readonly string[] } | { readonly ok: false; readonly error: string } {
  const pasos = texto.replace(/[%\s]/g, '').split('+').filter(paso => paso !== '');
  if (pasos.length > MAX_DESCUENTO_STEPS) return { ok: false, error: `Máximo ${MAX_DESCUENTO_STEPS} descuentos seguidos.` };
  const leido = parseDescuentoTexto(texto);
  if (leido.error) return { ok: false, error: leido.error };
  const porcentajes = [...leido.committed, ...(leido.draftValue === null ? [] : [leido.draftValue])].map(String);
  if (porcentajes.length === 0) return { ok: false, error: 'Escribe un porcentaje, por ejemplo 10 o 20+5.' };
  if (!porcentajes.every(p => PORCENTAJE_EXACTO.test(p))) return { ok: false, error: 'Usa hasta 4 decimales en cada porcentaje.' };
  return { ok: true, porcentajes };
}

/** The existing header discount correction: global, not included in the price, applied in the typed order. */
export function edicionDescuentoFactura(porcentajes: readonly string[]): Edicion {
  if (porcentajes.length === 0) return { tipo: 'cabecera_descuentos', valor: [], motivo: 'Factura sin descuento, indicado manualmente' };
  return {
    tipo: 'cabecera_descuentos',
    valor: porcentajes.map((porcentaje, index) => ({ orden: index + 1, porcentaje, monto: null, alcance: 'global', incluidoEnPrecio: false })),
    motivo: `Descuento de la factura indicado manualmente: ${porcentajes.map(p => `${p} %`).join(' + ')}`,
  };
}

// ── Existing-product selling price ──────────────────────────────────────────

/**
 * The catalog selling price (IVA included) as exact review decimal text, or null when it is missing, not positive or
 * not representable without rounding. Never multiplied by a markup or by IVA: it is already the shelf price.
 */
export function precioCatalogo(producto: { readonly precio_venta?: unknown } | undefined): string | null {
  const valor = producto?.precio_venta;
  let texto: string | null = null;
  if (typeof valor === 'number' && Number.isFinite(valor)) texto = String(valor);
  else if (typeof valor === 'string') texto = valor.trim();
  return texto !== null && precioVentaValido(texto) ? texto : null;
}

/**
 * The edits of one explicit product choice, applied together. Choosing the same product again keeps any typed price;
 * any other choice takes that product's current catalog price (or none), so the previous product's price never carries
 * over. A new product has no catalog price: its existing cost-based suggestion applies.
 */
export function edicionesElegirProducto(
  linea: Pick<LineaRevision, 'lineaId' | 'asociacion'>,
  asociacion: AsociacionRevision,
  producto: { readonly precio_venta?: unknown } | null
): Edicion[] {
  const ediciones: Edicion[] = [{ tipo: 'asociacion', lineaId: linea.lineaId, asociacion }];
  const mismoProducto = asociacion.tipo === 'confirmado' && linea.asociacion.tipo === 'confirmado' && linea.asociacion.codigoInterno === asociacion.codigoInterno;
  if (mismoProducto) return ediciones;
  const valor = asociacion.tipo === 'confirmado' ? precioCatalogo(producto ?? undefined) : null;
  return [...ediciones, { tipo: 'precio_venta', lineaId: linea.lineaId, valor }];
}

/** Existing products still without a saved selling price: approval and the purchase draft wait for them. */
export function lineasSinPrecioVenta(lineas: readonly LineaRevision[]): string[] {
  return lineas.filter(linea => linea.asociacion.tipo === 'confirmado' && linea.precioVenta === undefined).map(linea => linea.lineaId);
}
