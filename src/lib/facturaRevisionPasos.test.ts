import {
  aplicarEdicion,
  calcularRevision,
  crearRevisionDesdeExtraccion,
  resolverFactura,
  type Edicion,
  type EstadoCodigoBarras,
  type RevisionContenido,
} from './facturaRevision';
import type { ExtraidaLinea, FacturaExtraccionPayload } from './facturaExtractionContract';
import type { Bloqueo, CodigoBloqueo } from './facturaRevision';
import {
  accionPrincipal,
  agruparBloqueos,
  edicionFactorUno,
  edicionDescuentoFactura,
  edicionesElegirProducto,
  edicionesIvaFactura,
  edicionIvaManual,
  estadoIvaFactura,
  estadoLinea,
  leerPorcentajesFactura,
  lineasSinPrecioVenta,
  precioCatalogo,
  resumenDescuentoFactura,
  lineasConBloqueo,
  pendientesDeLinea,
  ETIQUETA_ESTADO_LINEA,
  resumenLineas,
  siguientePorRevisar,
  type EstadoLinea,
  type SituacionRevision,
  type VerificacionCodigo,
} from './facturaRevisionPasos';

const EXTRACCION_ID = '0a0a0a0a-0a0a-4a0a-8a0a-0a0a0a0a0a0a';

function ids(): () => string {
  let n = 0;
  return () => `10000000-0000-4000-8000-${String(++n).padStart(12, '0')}`;
}

function linea(numeroLinea: number, over: Partial<ExtraidaLinea> = {}): ExtraidaLinea {
  return {
    numeroLinea,
    pagina: 1,
    codigoProveedor: `COD-${numeroLinea}`,
    descripcion: `Articulo ${numeroLinea}`,
    cantidad: '10',
    unidad: 'UND',
    precioUnitario: '0.80',
    descuentos: [],
    tasaIva: '16',
    total: null,
    incertidumbre: null,
    ...over,
  };
}

function extraccion(lineas: ExtraidaLinea[]): FacturaExtraccionPayload {
  return {
    version: 1,
    cabecera: {
      proveedorNombre: 'Proveedor Uno',
      proveedorRif: null,
      numeroDocumento: 'DOC-001',
      numeroControl: null,
      fechaEmision: '2026-10-15',
      moneda: 'USD',
      tasaCambio: null,
      subtotal: null,
      descuentos: [],
      impuestos: [],
      total: null,
    },
    lineas,
    metadatos: { totalPaginas: 1, paginasProcesadas: [1], documentoCompleto: true, advertencias: [], confianzaGlobal: null },
  } as FacturaExtraccionPayload;
}

const EXT = extraccion([linea(1), linea(2, { cantidad: null })]);

function contenidoInicial(): RevisionContenido {
  const creada = crearRevisionDesdeExtraccion(EXT, EXTRACCION_ID, ids());
  if (!creada.ok) throw new Error('fixture');
  return creada.contenido;
}

function conEdiciones(...ediciones: Array<(contenido: RevisionContenido) => Edicion>): RevisionContenido {
  return ediciones.reduce((actual, hacer) => {
    const resultado = aplicarEdicion(actual, EXT, hacer(actual), ids());
    if (!resultado.ok) throw new Error('edit failed');
    return resultado.contenido;
  }, contenidoInicial());
}

const confirmar = (n: number) => (c: RevisionContenido): Edicion => ({
  tipo: 'asociacion',
  lineaId: c.lineas[n].lineaId,
  asociacion: { tipo: 'confirmado', codigoInterno: `SKU-${n + 1}`, evidencia: 'manual', motivo: 'Mismo articulo' },
});
const nuevo = (n: number) => (c: RevisionContenido): Edicion => ({
  tipo: 'asociacion',
  lineaId: c.lineas[n].lineaId,
  asociacion: { tipo: 'producto_nuevo', codigoInterno: null, evidencia: 'manual', motivo: 'No esta en el inventario' },
});
const iva = (n: number) => (c: RevisionContenido): Edicion => ({ tipo: 'linea_escalar', lineaId: c.lineas[n].lineaId, campo: 'tasaIva', valor: '16', motivo: 'IVA indicado manualmente: 16 %' });
const factor = (n: number) => (c: RevisionContenido): Edicion => ({ tipo: 'factor_conversion', lineaId: c.lineas[n].lineaId, valor: '1' });
const escaneado = (n: number) => (c: RevisionContenido): Edicion => ({ tipo: 'codigo_barras_escaneado', lineaId: c.lineas[n].lineaId, valor: '7591234567890' });
const precio = (n: number) => (c: RevisionContenido): Edicion => ({ tipo: 'precio_venta', lineaId: c.lineas[n].lineaId, valor: '18' });
const usarImpreso = (n: number) => (c: RevisionContenido): Edicion => ({ tipo: 'codigo_barras', lineaId: c.lineas[n].lineaId, usarCodigoFactura: true });

function estadoDe(contenido: RevisionContenido, n: number, barras: Record<string, EstadoCodigoBarras> = {}, verificacion?: VerificacionCodigo): EstadoLinea {
  const calculo = calcularRevision({ extraccion: EXT, contenido, estadosCodigoBarras: barras });
  return estadoLinea(contenido.lineas[n], calculo, verificacion);
}

describe('estadoLinea: what the person must do next on one line', () => {
  it('asks for a product while the association is pending, before any other gap', () => {
    expect(estadoDe(contenidoInicial(), 0)).toBe('elegir_producto');
  });

  it('asks for the VAT rate once the product is chosen, because VAT is never inferred', () => {
    expect(estadoDe(conEdiciones(confirmar(0)), 0)).toBe('falta_iva');
  });

  it('asks for the units factor after the VAT rate', () => {
    expect(estadoDe(conEdiciones(confirmar(0), iva(0)), 0)).toBe('faltan_unidades');
  });

  it('is ready with product, VAT and factor, even while document-level confirmations are still missing', () => {
    expect(estadoDe(conEdiciones(confirmar(0), iva(0), factor(0), precio(0)), 0)).toBe('listo');
  });

  it('keeps a new product pending until a physical code is captured, after VAT and factor', () => {
    expect(estadoDe(conEdiciones(nuevo(0)), 0)).toBe('falta_iva');
    expect(estadoDe(conEdiciones(nuevo(0), iva(0), factor(0)), 0)).toBe('falta_codigo');
    expect(estadoDe(conEdiciones(nuevo(0), iva(0), factor(0), escaneado(0)), 0, {}, { tipo: 'sin_coincidencias' })).toBe('listo');
  });

  describe('a captured code is only ready after a complete, clean lookup', () => {
    const conCodigo = () => conEdiciones(nuevo(0), iva(0), factor(0), escaneado(0));

    it('is not ready while the lookup has not answered yet, or is still running', () => {
      expect(estadoDe(conCodigo(), 0)).toBe('verificando_codigo');
      expect(estadoDe(conCodigo(), 0, {}, { tipo: 'cargando' })).toBe('verificando_codigo');
    });

    it('is not ready when the lookup was incomplete or failed', () => {
      expect(estadoDe(conCodigo(), 0, {}, { tipo: 'incompleta' })).toBe('codigo_sin_verificar');
    });

    it('is not ready when another product already uses the code', () => {
      expect(estadoDe(conCodigo(), 0, {}, { tipo: 'colision', skus: ['4411'] })).toBe('codigo_en_uso');
    });

    it('keeps the missing-code state whatever the lookup says', () => {
      expect(estadoDe(conEdiciones(nuevo(0), iva(0), factor(0)), 0, {}, { tipo: 'sin_coincidencias' })).toBe('falta_codigo');
    });

    it('never asks an existing product for a code lookup', () => {
      expect(estadoDe(conEdiciones(confirmar(0), iva(0), factor(0), precio(0)), 0, {}, { tipo: 'colision', skus: ['4411'] })).toBe('listo');
    });

    it('still reports the VAT and units gaps before the lookup', () => {
      expect(estadoDe(conEdiciones(nuevo(0), escaneado(0)), 0, {}, { tipo: 'colision', skus: ['4411'] })).toBe('falta_iva');
    });
  });

  it('does not ask an existing product for a barcode capture', () => {
    expect(estadoDe(conEdiciones(confirmar(0), iva(0), factor(0), precio(0)), 0)).toBe('listo');
  });

  it('sends any other line blocker to review instead of showing the line as ready', () => {
    // Line 2 has no quantity in the document: "dato_faltante" on that line only.
    expect(estadoDe(conEdiciones(confirmar(1), iva(1), factor(1)), 1)).toBe('revisar');
  });

  it('sends an unverified printed-code reuse on an existing product to review', () => {
    const contenido = conEdiciones(confirmar(0), iva(0), factor(0), precio(0), usarImpreso(0));
    expect(estadoDe(contenido, 0, { [contenido.lineas[0].lineaId]: 'colision' })).toBe('revisar');
    expect(estadoDe(contenido, 0, { [contenido.lineas[0].lineaId]: 'unico_verificado' })).toBe('listo');
  });

  it('labels every state in neutral Spanish', () => {
    expect(ETIQUETA_ESTADO_LINEA).toEqual({
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
    });
  });
});

describe('resumenLineas and siguientePorRevisar', () => {
  const estados: Array<{ lineaId: string; estado: EstadoLinea }> = [
    { lineaId: 'a', estado: 'listo' },
    { lineaId: 'b', estado: 'falta_iva' },
    { lineaId: 'c', estado: 'listo' },
    { lineaId: 'd', estado: 'elegir_producto' },
  ];

  it('counts ready lines against the total', () => {
    expect(resumenLineas(estados.map(e => e.estado))).toEqual({ total: 4, listas: 2, porRevisar: 2 });
    expect(resumenLineas([])).toEqual({ total: 0, listas: 0, porRevisar: 0 });
  });

  it('finds the next line to review after the current one and wraps around', () => {
    expect(siguientePorRevisar(estados, 'a')).toBe('b');
    expect(siguientePorRevisar(estados, 'b')).toBe('d');
    expect(siguientePorRevisar(estados, 'd')).toBe('b');
    expect(siguientePorRevisar(estados, null)).toBe('b');
  });

  it('returns null when every line is ready', () => {
    expect(siguientePorRevisar([{ lineaId: 'a', estado: 'listo' }], 'a')).toBeNull();
    expect(siguientePorRevisar([], null)).toBeNull();
  });
});

describe('accionPrincipal: one primary action per state, with the reason when it is disabled', () => {
  const base: SituacionRevision = {
    etapa: 'leer',
    carga: 'listo',
    hayContenido: false,
    porRevisar: 0,
    hayExtraccionUsable: false,
    intentoFallido: false,
    ocupado: null,
    puedeExtraer: true,
    razonNoExtraer: null,
    conflicto: false,
    sucio: false,
    editorDirty: false,
    puedeGuardar: false,
    puedeAprobar: false,
    puedeMaterializar: false,
    materializando: false,
    hayBorradorPrecio: false,
    sinBloqueos: false,
    aprobada: false,
  };
  const con = (over: Partial<SituacionRevision>): SituacionRevision => ({ ...base, ...over });

  describe('leer', () => {
    it('offers the explicit read when nothing was read yet', () => {
      expect(accionPrincipal(base)).toEqual({ id: 'leer', etiqueta: 'Buscar productos', deshabilitada: false, razon: null });
    });

    it('says why the read is unavailable', () => {
      expect(accionPrincipal(con({ puedeExtraer: false, razonNoExtraer: 'Guarda la factura antes de extraer datos.' }))).toEqual({
        id: 'leer',
        etiqueta: 'Buscar productos',
        deshabilitada: true,
        razon: 'Guarda la factura antes de extraer datos.',
      });
    });

    it('shows progress while reading and disables the button', () => {
      expect(accionPrincipal(con({ ocupado: 'extrayendo', puedeExtraer: false }))).toEqual({ id: 'leer', etiqueta: 'Buscando productos…', deshabilitada: true, razon: null });
    });

    it('offers an explicit retry after a failed read', () => {
      expect(accionPrincipal(con({ intentoFallido: true }))).toMatchObject({ id: 'leer', etiqueta: 'Intentar de nuevo', deshabilitada: false });
    });

    it('starts the review from a usable extraction only on an explicit press', () => {
      expect(accionPrincipal(con({ hayExtraccionUsable: true }))).toEqual({ id: 'revisar_leido', etiqueta: 'Ver productos encontrados', deshabilitada: false, razon: null });
    });

    it('moves on to the products once there is content', () => {
      expect(accionPrincipal(con({ hayContenido: true, hayExtraccionUsable: true }))).toEqual({ id: 'continuar_compra', etiqueta: 'Seguir a la compra', deshabilitada: false, razon: null });
    });

    it.each(['cargando', 'no_disponible', 'error', 'sin_sesion'] as const)('offers no footer action while the load state is %s', carga => {
      expect(accionPrincipal(con({ carga }))).toBeNull();
    });
  });

  describe('productos', () => {
    it('continues to the purchase step', () => {
      expect(accionPrincipal(con({ etapa: 'productos', hayContenido: true }))).toEqual({ id: 'continuar_compra', etiqueta: 'Seguir a la compra', deshabilitada: false, razon: null });
    });

    it('sends the person back to reading when there is no content yet', () => {
      expect(accionPrincipal(con({ etapa: 'productos' }))).toEqual({ id: 'leer', etiqueta: 'Buscar productos', deshabilitada: false, razon: null });
      expect(accionPrincipal(con({ etapa: 'compra' }))).toMatchObject({ id: 'ir_leer' });
    });
  });

  describe('compra', () => {
    const compra = (over: Partial<SituacionRevision>): SituacionRevision => con({ etapa: 'compra', hayContenido: true, ...over });

    it('saves first when there are unsaved changes', () => {
      expect(accionPrincipal(compra({ sucio: true, puedeGuardar: true }))).toEqual({ id: 'guardar', etiqueta: 'Guardar cambios', deshabilitada: false, razon: null });
    });

    it('explains an invalid selling price that blocks saving', () => {
      expect(accionPrincipal(compra({ sucio: true, puedeGuardar: true, hayBorradorPrecio: true }))).toMatchObject({
        id: 'guardar',
        deshabilitada: true,
        razon: 'Corrige o borra el precio de venta no válido para guardar.',
      });
    });

    it('explains a stale-revision conflict', () => {
      expect(accionPrincipal(compra({ sucio: true, conflicto: true }))).toMatchObject({
        id: 'guardar',
        deshabilitada: true,
        razon: 'Hay una versión más reciente en el servidor: recárgala para continuar.',
      });
    });

    it('waits for the selling price of existing products before confirming or preparing the draft (S6)', () => {
      const razon = 'Falta el precio de venta de 2 productos existentes: usa el precio actual o escribe uno.';
      expect(accionPrincipal(compra({ puedeAprobar: true, sinBloqueos: true, preciosPendientes: 2 }))).toEqual({ id: 'aprobar', etiqueta: 'Confirmar revisión', deshabilitada: true, razon });
      expect(accionPrincipal(compra({ aprobada: true, puedeMaterializar: true, preciosPendientes: 1 }))).toEqual({
        id: 'preparar', etiqueta: 'Crear borrador de compra', deshabilitada: true, razon: 'Falta el precio de venta de 1 producto existente: usa el precio actual o escribe uno.',
      });
      // Saving is never blocked by it: adopting a price is itself an edit that must be saved.
      expect(accionPrincipal(compra({ sucio: true, puedeGuardar: true, preciosPendientes: 2 }))).toMatchObject({ id: 'guardar', deshabilitada: false });
    });

    it('approves the saved review when it has no blockers', () => {
      expect(accionPrincipal(compra({ puedeAprobar: true, sinBloqueos: true }))).toEqual({ id: 'aprobar', etiqueta: 'Confirmar revisión', deshabilitada: false, razon: null });
    });

    it('never approves while an invalid selling price is still typed, even when the saved review could be approved', () => {
      expect(accionPrincipal(compra({ puedeAprobar: true, sinBloqueos: true, hayBorradorPrecio: true }))).toEqual({
        id: 'aprobar',
        etiqueta: 'Confirmar revisión',
        deshabilitada: true,
        razon: 'Corrige o borra el precio de venta no válido para confirmar.',
      });
    });

    it('says the blockers must be resolved before approving', () => {
      expect(accionPrincipal(compra({ sinBloqueos: false }))).toMatchObject({
        id: 'aprobar',
        deshabilitada: true,
        razon: 'Completa los datos que faltan para confirmar.',
      });
    });

    it('says the manual invoice changes must be saved before approving', () => {
      expect(accionPrincipal(compra({ sinBloqueos: true, editorDirty: true }))).toMatchObject({
        id: 'aprobar',
        deshabilitada: true,
        razon: 'Guarda los cambios de la factura antes de confirmar.',
      });
    });

    it('prepares the purchase draft once the approval is valid', () => {
      expect(accionPrincipal(compra({ aprobada: true, sinBloqueos: true, puedeMaterializar: true }))).toEqual({ id: 'preparar', etiqueta: 'Crear borrador de compra', deshabilitada: false, razon: null });
    });

    it('keeps preparing disabled, with the reason, when the approval is no longer valid', () => {
      expect(accionPrincipal(compra({ aprobada: true, sinBloqueos: true, puedeMaterializar: false }))).toMatchObject({
        id: 'preparar',
        deshabilitada: true,
        razon: 'Cambiaste la factura: guarda los cambios y confirma de nuevo.',
      });
    });

    it('shows progress while saving, approving and preparing', () => {
      expect(accionPrincipal(compra({ sucio: true, ocupado: 'guardando' }))).toEqual({ id: 'guardar', etiqueta: 'Guardando…', deshabilitada: true, razon: null });
      expect(accionPrincipal(compra({ ocupado: 'aprobando' }))).toEqual({ id: 'aprobar', etiqueta: 'Confirmando…', deshabilitada: true, razon: null });
      expect(accionPrincipal(compra({ aprobada: true, materializando: true }))).toEqual({ id: 'preparar', etiqueta: 'Preparando borrador…', deshabilitada: true, razon: null });
    });
  });
});

// ── Post-E2E corrections: grouped blockers and explicit batch targets ───────

const bloqueo = (codigo: CodigoBloqueo, lineaId: string | null = null, detalle: string | null = null): Bloqueo => ({
  codigo,
  ambito: lineaId === null ? 'documento' : 'linea',
  lineaId,
  detalle,
});

/** The exact screenshot-11 sequence: per line association, VAT, factor, emitted one line after the other. */
function secuenciaCaptura(lineas: readonly string[]): Bloqueo[] {
  return [
    bloqueo('documento_completitud_no_confirmada'),
    bloqueo('recepcion_no_confirmada'),
    bloqueo('iva_inclusion_desconocida'),
    ...lineas.flatMap(id => [bloqueo('asociacion_pendiente', id), bloqueo('iva_tasa_desconocida', id), bloqueo('conversion_no_confirmada', id)]),
  ];
}

describe('agruparBloqueos', () => {
  const orden = ['L1', 'L2', 'L3', 'L4', 'L5', 'L6', 'L7', 'L8'];

  it('keeps every reason of a line with that line, in line order, and the document blockers first (screenshot 11)', () => {
    const grupos = agruparBloqueos(secuenciaCaptura(orden.slice(1)), orden);
    expect(grupos.documento.map(b => b.codigo)).toEqual(['documento_completitud_no_confirmada', 'recepcion_no_confirmada', 'iva_inclusion_desconocida']);
    expect(grupos.lineas.map(g => g.lineaId)).toEqual(['L2', 'L3', 'L4', 'L5', 'L6', 'L7', 'L8']);
    for (const grupo of grupos.lineas) {
      expect(grupo.bloqueos.map(b => b.codigo)).toEqual(['asociacion_pendiente', 'iva_tasa_desconocida', 'conversion_no_confirmada']);
      expect(grupo.bloqueos.every(b => b.lineaId === grupo.lineaId)).toBe(true);
    }
  });

  it('follows the line order even when the blockers arrive interleaved, and keeps unknown lines last', () => {
    const grupos = agruparBloqueos(
      [bloqueo('iva_tasa_desconocida', 'L3'), bloqueo('moneda_desconocida'), bloqueo('asociacion_pendiente', 'L1'), bloqueo('conversion_no_confirmada', 'L3'), bloqueo('dato_faltante', 'X9', 'cantidad'), bloqueo('iva_tasa_desconocida', 'L1')],
      ['L1', 'L2', 'L3']
    );
    expect(grupos.documento.map(b => b.codigo)).toEqual(['moneda_desconocida']);
    expect(grupos.lineas.map(g => [g.lineaId, g.bloqueos.map(b => b.codigo)])).toEqual([
      ['L1', ['asociacion_pendiente', 'iva_tasa_desconocida']],
      ['L3', ['iva_tasa_desconocida', 'conversion_no_confirmada']],
      ['X9', ['dato_faltante']],
    ]);
    expect(grupos.lineas[2].bloqueos[0].detalle).toBe('cantidad');
  });

  it('returns empty groups when nothing is blocked', () => {
    expect(agruparBloqueos([], ['L1'])).toEqual({ documento: [], lineas: [] });
  });
});

describe('pendientesDeLinea', () => {
  it('names what a line still needs in short words, once each, in the blocker order', () => {
    expect(pendientesDeLinea([bloqueo('asociacion_pendiente', 'L1'), bloqueo('iva_tasa_desconocida', 'L1'), bloqueo('conversion_no_confirmada', 'L1')])).toEqual(['producto', 'IVA', 'unidades']);
    expect(pendientesDeLinea([bloqueo('dato_faltante', 'L1', 'cantidad'), bloqueo('valor_invalido', 'L1', 'precioUnitario')])).toEqual(['datos']);
  });
});

describe('batch targets and edits', () => {
  const orden = ['L1', 'L2', 'L3'];

  it('targets only the lines that currently carry the matching blocker, in line order', () => {
    const bloqueos = [bloqueo('iva_tasa_desconocida', 'L3'), bloqueo('conversion_no_confirmada', 'L2'), bloqueo('iva_tasa_desconocida', 'L1'), bloqueo('iva_inclusion_desconocida')];
    expect(lineasConBloqueo(bloqueos, 'iva_tasa_desconocida', orden)).toEqual(['L1', 'L3']);
    expect(lineasConBloqueo(bloqueos, 'conversion_no_confirmada', orden)).toEqual(['L2']);
    expect(lineasConBloqueo([], 'iva_tasa_desconocida', orden)).toEqual([]);
  });

  it('builds exactly the edits of the per-line VAT and factor chips', () => {
    expect(edicionIvaManual('L1', '16')).toEqual({ tipo: 'linea_escalar', lineaId: 'L1', campo: 'tasaIva', valor: '16', motivo: 'IVA indicado manualmente: 16 %' });
    expect(edicionIvaManual('L2', '0')).toEqual({ tipo: 'linea_escalar', lineaId: 'L2', campo: 'tasaIva', valor: '0', motivo: 'IVA indicado manualmente: 0 %' });
    expect(edicionFactorUno('L3')).toEqual({ tipo: 'factor_conversion', lineaId: 'L3', valor: '1' });
  });

  it('a batch over the unresolved lines leaves an explicit zero and an explicit factor untouched', () => {
    const corregida = conEdiciones(c => edicionIvaManual(c.lineas[0].lineaId, '0'), c => ({ tipo: 'factor_conversion', lineaId: c.lineas[1].lineaId, valor: '2' }));
    const calculo = calcularRevision({ extraccion: EXT, contenido: corregida, estadosCodigoBarras: {} });
    const [primera, segunda] = corregida.lineas.map(l => l.lineaId);
    expect(lineasConBloqueo(calculo.bloqueos, 'iva_tasa_desconocida', [primera, segunda])).toEqual([segunda]);
    expect(lineasConBloqueo(calculo.bloqueos, 'conversion_no_confirmada', [primera, segunda])).toEqual([primera]);
  });
});

 describe('work-leading products', () => {
  const state = { carga: 'listo', etapa: 'productos', hayContenido: true, porRevisar: 5 } as SituacionRevision;
  it('opens pending work before leaving products', () => {
    expect(accionPrincipal(state)).toMatchObject({ id: 'siguiente_producto', etiqueta: 'Revisar siguiente (5 faltan)' });
    expect(accionPrincipal({ ...state, porRevisar: 0 })).toMatchObject({ id: 'continuar_compra', etiqueta: 'Seguir a la compra' });
  });
  it('treats legacy leer as the same products body', () => {
    expect(accionPrincipal({ ...state, etapa: 'leer' })).toEqual(accionPrincipal(state));
  });
});

describe('invoice-wide VAT (S4): one answer for the invoice, written through the per-line field', () => {
  const lineasDe = (contenido: RevisionContenido) => resolverFactura(EXT, contenido).lineas;
  const ivaDe = (n: number, tasa: string) => (c: RevisionContenido): Edicion => edicionIvaManual(c.lineas[n].lineaId, tasa);

  it('reads unknown, uniform and mixed states from the explicit per-line decisions only', () => {
    // The extraction prints 16 on both lines, but a printed rate is never a decision.
    expect(estadoIvaFactura(lineasDe(contenidoInicial()))).toEqual({ total: 2, faltan: 2, tasas: [] });
    expect(estadoIvaFactura(lineasDe(conEdiciones(ivaDe(0, '16'), ivaDe(1, '16.0'))))).toEqual({ total: 2, faltan: 0, tasas: ['16'] });
    expect(estadoIvaFactura(lineasDe(conEdiciones(ivaDe(1, '16'), ivaDe(0, '0'))))).toEqual({ total: 2, faltan: 0, tasas: ['0', '16'] });
    expect(estadoIvaFactura(lineasDe(conEdiciones(ivaDe(0, '0'))))).toEqual({ total: 2, faltan: 1, tasas: ['0'] });
  });

  it('fills only the lines without VAT unless an overwrite was explicitly chosen, with the manual-path payload', () => {
    const mixta = conEdiciones(ivaDe(0, '0'));
    const lineas = lineasDe(mixta);
    expect(edicionesIvaFactura(lineas, '16', 'faltan')).toEqual([edicionIvaManual(mixta.lineas[1].lineaId, '16')]);
    expect(edicionesIvaFactura(lineas, '16', 'todas')).toEqual([edicionIvaManual(mixta.lineas[0].lineaId, '16'), edicionIvaManual(mixta.lineas[1].lineaId, '16')]);
    // A line already at the chosen rate is left alone, so its saved motive never changes.
    expect(edicionesIvaFactura(lineas, '0', 'todas')).toEqual([edicionIvaManual(mixta.lineas[1].lineaId, '0')]);
    expect(edicionesIvaFactura(lineasDe(conEdiciones(ivaDe(0, '16'), ivaDe(1, '16'))), '16.00', 'todas')).toEqual([]);
  });
});

describe('invoice-wide percentage discount (S4)', () => {
  const global = (orden: number, porcentaje: string | null, over: Record<string, unknown> = {}) =>
    ({ orden, porcentaje, monto: null, alcance: 'global' as const, incluidoEnPrecio: false, ...over });

  it('summarises the header discounts the calculation can apply, the included ones and anything else', () => {
    expect(resumenDescuentoFactura([])).toEqual({ tipo: 'ninguno' });
    expect(resumenDescuentoFactura([global(2, '5'), global(1, '20')])).toEqual({ tipo: 'porcentajes', porcentajes: ['20', '5'] });
    expect(resumenDescuentoFactura([global(1, '10', { incluidoEnPrecio: true })])).toEqual({ tipo: 'incluidos' });
    expect(resumenDescuentoFactura([global(1, null, { monto: '3.00' })])).toEqual({ tipo: 'otro' });
    expect(resumenDescuentoFactura([global(1, '10', { alcance: null })])).toEqual({ tipo: 'otro' });
    expect(resumenDescuentoFactura([global(1, '10'), global(2, '5', { incluidoEnPrecio: true })])).toEqual({ tipo: 'otro' });
  });

  it('reads a typed cascade with the purchase discount parser and keeps each step as exact text', () => {
    expect(leerPorcentajesFactura('20+5')).toEqual({ ok: true, porcentajes: ['20', '5'] });
    expect(leerPorcentajesFactura(' 12,5 % ')).toEqual({ ok: true, porcentajes: ['12.5'] });
    expect(leerPorcentajesFactura('')).toEqual({ ok: false, error: 'Escribe un porcentaje, por ejemplo 10 o 20+5.' });
    expect(leerPorcentajesFactura('100')).toEqual({ ok: false, error: 'Debe ser menor a 100%' });
    expect(leerPorcentajesFactura('abc')).toEqual({ ok: false, error: 'Descuento inválido' });
    expect(leerPorcentajesFactura('1+1+1+1+1+1+1')).toEqual({ ok: false, error: 'Máximo 6 descuentos seguidos.' });
  });

  it('writes the existing header correction, global and not included, in the typed order', () => {
    expect(edicionDescuentoFactura(['20', '5'])).toEqual({
      tipo: 'cabecera_descuentos',
      valor: [global(1, '20'), global(2, '5')],
      motivo: 'Descuento de la factura indicado manualmente: 20 % + 5 %',
    });
    expect(edicionDescuentoFactura([])).toEqual({ tipo: 'cabecera_descuentos', valor: [], motivo: 'Factura sin descuento, indicado manualmente' });
  });
});

describe('existing-product selling price (S6)', () => {
  const asociacion = (codigoInterno: string) => ({ tipo: 'confirmado' as const, codigoInterno, evidencia: 'manual' as const, motivo: 'Mismo articulo' });

  it('reads the current catalog price as exact decimal text, never rounding or inventing one', () => {
    expect(precioCatalogo({ precio_venta: 12.5 })).toBe('12.5');
    expect(precioCatalogo({ precio_venta: 18 })).toBe('18');
    expect(precioCatalogo({ precio_venta: '7.25' as unknown as number })).toBe('7.25');
    for (const malo of [0, -1, Number.NaN, Number.POSITIVE_INFINITY, 1e-9, 1234567890123, 12.123456789, undefined, null, 'abc']) {
      expect(precioCatalogo({ precio_venta: malo as unknown as number })).toBeNull();
    }
    expect(precioCatalogo(undefined)).toBeNull();
  });

  it('adopts the chosen product price with its association, as one batch', () => {
    const linea = contenidoInicial().lineas[0];
    expect(edicionesElegirProducto(linea, asociacion('SKU-9'), { precio_venta: 18 })).toEqual([
      { tipo: 'asociacion', lineaId: linea.lineaId, asociacion: asociacion('SKU-9') },
      { tipo: 'precio_venta', lineaId: linea.lineaId, valor: '18' },
    ]);
  });

  it('keeps a typed price when the same product is chosen again', () => {
    const contenido = conEdiciones(confirmar(0), c => ({ tipo: 'precio_venta', lineaId: c.lineas[0].lineaId, valor: '20' }));
    const linea = contenido.lineas[0];
    const otraEvidencia = { tipo: 'confirmado' as const, codigoInterno: 'SKU-1', evidencia: 'sugerencia' as const, motivo: null };
    expect(edicionesElegirProducto(linea, otraEvidencia, { precio_venta: 18 })).toEqual([{ tipo: 'asociacion', lineaId: linea.lineaId, asociacion: otraEvidencia }]);
  });

  it('never carries the previous product price to another product or a new one', () => {
    const linea = conEdiciones(confirmar(0), precio(0)).lineas[0];
    expect(edicionesElegirProducto(linea, asociacion('SKU-2'), { precio_venta: 0 })).toEqual([
      { tipo: 'asociacion', lineaId: linea.lineaId, asociacion: asociacion('SKU-2') },
      { tipo: 'precio_venta', lineaId: linea.lineaId, valor: null },
    ]);
    const nuevoProducto = { tipo: 'producto_nuevo' as const, codigoInterno: null, evidencia: 'manual' as const, motivo: 'No esta en el inventario' };
    expect(edicionesElegirProducto(linea, nuevoProducto, null)).toEqual([
      { tipo: 'asociacion', lineaId: linea.lineaId, asociacion: nuevoProducto },
      { tipo: 'precio_venta', lineaId: linea.lineaId, valor: null },
    ]);
  });

  it('marks an existing product without a saved selling price as not ready; a new product keeps its suggestion', () => {
    expect(estadoDe(conEdiciones(confirmar(0), iva(0), factor(0)), 0)).toBe('falta_precio');
    expect(ETIQUETA_ESTADO_LINEA.falta_precio).toBe('Falta el precio de venta');
    expect(estadoDe(conEdiciones(nuevo(0), iva(0), factor(0), escaneado(0)), 0, {}, { tipo: 'sin_coincidencias' })).toBe('listo');
  });

  it('lists the existing products that still need a selling price, in line order', () => {
    const contenido = conEdiciones(confirmar(0), confirmar(1), precio(1), nuevo(1));
    expect(lineasSinPrecioVenta(contenido.lineas)).toEqual([contenido.lineas[0].lineaId]);
    expect(lineasSinPrecioVenta(conEdiciones(confirmar(0), precio(0)).lineas)).toEqual([]);
  });
});

describe('primary action count wording (NEW-V3)', () => {
  const productos = { carga: 'listo', etapa: 'productos', hayContenido: true } as SituacionRevision;
  it('says falta for one product and faltan for several', () => {
    expect(accionPrincipal({ ...productos, porRevisar: 1 })).toMatchObject({ etiqueta: 'Revisar siguiente (1 falta)' });
    expect(accionPrincipal({ ...productos, porRevisar: 2 })).toMatchObject({ etiqueta: 'Revisar siguiente (2 faltan)' });
  });
});
