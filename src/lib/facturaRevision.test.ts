import {
  aplicarEdicion,
  asociacionDesdeCandidato,
  calcularRevision,
  crearRevisionDesdeExtraccion,
  crearRevisionManual,
  estadoRevision,
  evaluarCodigoBarras,
  POLITICAS_PRODUCCION,
  resolverFactura,
  validarContenidoRevision,
  type CodigoBloqueo,
  type Edicion,
  type PoliticasCalculo,
  type RevisionContenido,
} from './facturaRevision';
import type {
  ExtraidaLinea,
  ExtraidoDescuento,
  FacturaExtraccionPayload,
} from './facturaExtractionContract';

// ── Fixtures ────────────────────────────────────────────────────────────────

const EXTRACCION_ID = '0a0a0a0a-0a0a-4a0a-8a0a-0a0a0a0a0a0a';

function ids(prefix = '10000000'): () => string {
  let n = 0;
  return () => {
    n += 1;
    return `${prefix}-0000-4000-8000-${String(n).padStart(12, '0')}`;
  };
}

function deepFreeze<T>(value: T): T {
  if (typeof value === 'object' && value !== null && !Object.isFrozen(value)) {
    Object.freeze(value);
    Object.values(value as Record<string, unknown>).forEach(deepFreeze);
  }
  return value;
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

function extraccion(
  lineas: ExtraidaLinea[],
  cabecera: Partial<FacturaExtraccionPayload['cabecera']> = {}
): FacturaExtraccionPayload {
  return deepFreeze({
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
      ...cabecera,
    },
    lineas,
    metadatos: { totalPaginas: 1, paginasProcesadas: [1], documentoCompleto: true, advertencias: [], confianzaGlobal: null },
  } as FacturaExtraccionPayload);
}

function aplicar(contenido: RevisionContenido, ext: FacturaExtraccionPayload | null, ...ediciones: Edicion[]): RevisionContenido {
  return ediciones.reduce((actual, edicion) => {
    const resultado = aplicarEdicion(actual, ext, edicion, ids('20000000'));
    if (!resultado.ok) throw new Error(`edit failed: ${JSON.stringify(resultado.error)}`);
    return resultado.contenido;
  }, contenido);
}

function crear(ext: FacturaExtraccionPayload): RevisionContenido {
  const resultado = crearRevisionDesdeExtraccion(ext, EXTRACCION_ID, ids());
  if (!resultado.ok) throw new Error(JSON.stringify(resultado.error));
  return resultado.contenido;
}

/** Every confirmation explicit: complete document, full receipt, IVA not included, 1:1 units, confirmed products. */
function confirmada(ext: FacturaExtraccionPayload, over: { incluyeIva?: boolean; factor?: string } = {}): RevisionContenido {
  const base = crear(ext);
  const ediciones: Edicion[] = [
    { tipo: 'decision_cabecera', campo: 'documentoCompletoConfirmado', valor: true },
    { tipo: 'decision_cabecera', campo: 'recepcionCompleta', valor: true },
    { tipo: 'decision_cabecera', campo: 'precioIncluyeIva', valor: over.incluyeIva ?? false },
    ...base.lineas.flatMap((l): Edicion[] => [
      { tipo: 'factor_conversion', lineaId: l.lineaId, valor: over.factor ?? '1' },
      { tipo: 'asociacion', lineaId: l.lineaId, asociacion: { tipo: 'confirmado', codigoInterno: `SKU-${l.origen?.numeroLinea}`, evidencia: 'sugerencia', motivo: null } },
    ]),
  ];
  return aplicar(base, ext, ...ediciones);
}

const codigos = (bloqueos: readonly { codigo: CodigoBloqueo }[]): CodigoBloqueo[] => bloqueos.map(b => b.codigo);

const desc = (over: Partial<ExtraidoDescuento> = {}): ExtraidoDescuento => ({
  orden: 1,
  porcentaje: '20',
  monto: null,
  alcance: 'renglon',
  incluidoEnPrecio: false,
  ...over,
});

// ── Creation and SQL-shape parity ───────────────────────────────────────────

describe('crearRevisionDesdeExtraccion', () => {
  it('creates one pending line per raw line, repeated supplier codes kept apart, nothing confirmed', () => {
    const ext = extraccion([linea(1, { codigoProveedor: '00123' }), linea(2, { codigoProveedor: '00123', precioUnitario: '0.95' })]);
    const generador = ids();
    const resultado = crearRevisionDesdeExtraccion(ext, EXTRACCION_ID, generador);
    expect(resultado.ok).toBe(true);
    if (!resultado.ok) return;
    const { contenido } = resultado;
    expect(contenido).toMatchObject({ review_schema: 1, calculo_version: 'calc-v1', matching_version: 'matching-v1', extraccion_id: EXTRACCION_ID });
    expect(contenido.cabecera).toEqual({ correcciones: {}, tasaConfirmada: null, precioIncluyeIva: null, recepcionCompleta: null, documentoCompletoConfirmado: null });
    expect(contenido.lineas.map(l => l.origen)).toEqual([{ numeroLinea: 1 }, { numeroLinea: 2 }]);
    expect(new Set(contenido.lineas.map(l => l.lineaId)).size).toBe(2);
    for (const l of contenido.lineas) {
      expect(l.asociacion).toEqual({ tipo: 'pendiente', codigoInterno: null, evidencia: null, motivo: null });
      expect(l.factorConversion).toBeNull();
      expect(l.codigoBarras).toEqual({ usarCodigoFactura: false });
      expect(l.correcciones).toEqual({});
    }
    expect(ext.lineas[0].codigoProveedor).toBe('00123');
  });

  it('uses the injected allocator in document order and rejects invalid or repeated IDs', () => {
    const ext = extraccion([linea(1), linea(2)]);
    const fijo = crearRevisionDesdeExtraccion(ext, EXTRACCION_ID, ids('30000000'));
    expect(fijo.ok && fijo.contenido.lineas.map(l => l.lineaId)).toEqual([
      '30000000-0000-4000-8000-000000000001',
      '30000000-0000-4000-8000-000000000002',
    ]);
    expect(crearRevisionDesdeExtraccion(ext, EXTRACCION_ID, () => 'not-a-uuid')).toMatchObject({ ok: false, error: { codigo: 'id_invalido' } });
    expect(crearRevisionDesdeExtraccion(ext, EXTRACCION_ID, () => '30000000-0000-4000-8000-000000000001')).toMatchObject({ ok: false, error: { codigo: 'id_invalido' } });
  });

  it('lets the caller hand back historical source IDs by numeroLinea (A / detach / A)', () => {
    const ext = extraccion([linea(1), linea(2), linea(3)]);
    const historia: Record<number, string> = {
      1: '60000000-0000-4000-8000-000000000001',
      2: '60000000-0000-4000-8000-000000000002',
      3: '60000000-0000-4000-8000-000000000003',
    };
    const vistos: Array<number | null> = [];
    const resultado = crearRevisionDesdeExtraccion(ext, EXTRACCION_ID, numeroLinea => {
      vistos.push(numeroLinea);
      return historia[numeroLinea as number];
    });
    expect(vistos).toEqual([1, 2, 3]);
    expect(resultado.ok && resultado.contenido.lineas.map(l => [l.origen?.numeroLinea, l.lineaId])).toEqual([
      [1, historia[1]],
      [2, historia[2]],
      [3, historia[3]],
    ]);
  });

  it('passes null to the allocator for a manual row', () => {
    const ext = extraccion([linea(1)]);
    const vistos: Array<number | null> = [];
    const generador = ids('70000000');
    aplicarEdicion(crear(ext), ext, { tipo: 'agregar_linea_manual', correcciones: { descripcion: { valor: 'x', motivo: 'm' } } }, numeroLinea => {
      vistos.push(numeroLinea);
      return generador();
    });
    expect(vistos).toEqual([null]);
  });

  it('creates a valid manual-only revision without lines', () => {
    expect(validarContenidoRevision(crearRevisionManual(), null)).toMatchObject({ ok: true });
  });
});

describe('validarContenidoRevision mirrors the SQL contract', () => {
  const ext = extraccion([linea(1), linea(2)]);
  const base = (): any => JSON.parse(JSON.stringify(crear(ext)));
  const corr = (valor: unknown, motivo: unknown = 'Motivo') => ({ valor, motivo });

  it('accepts typed arrays (including an explicit empty array) and literal codes', () => {
    const contenido = base();
    contenido.cabecera.correcciones = {
      descuentos: corr([desc({ alcance: 'global' })]),
      impuestos: corr([]),
      numeroDocumento: corr('00123A'),
    };
    contenido.lineas[0].correcciones = { descuentos: corr([]), codigoProveedor: corr('000123A') };
    expect(validarContenidoRevision(contenido, ext)).toMatchObject({ ok: true });
  });

  const rechazos: Array<[string, (c: any) => void]> = [
    ['unknown root key', c => { c.extra = 1; }],
    ['missing root key', c => { delete c.matching_version; }],
    ['wrong schema', c => { c.review_schema = 2; }],
    ['tasaConfirmada set', c => { c.cabecera.tasaConfirmada = '36.5'; }],
    ['decision as text', c => { c.cabecera.recepcionCompleta = 'si'; }],
    ['unknown header correction', c => { c.cabecera.correcciones = { aprobado: corr('1') }; }],
    ['correction without motivo', c => { c.cabecera.correcciones = { proveedorNombre: { valor: 'X' } }; }],
    ['correction with blank motivo', c => { c.cabecera.correcciones = { proveedorNombre: corr('X', '  ') }; }],
    ['numeric correction value', c => { c.cabecera.correcciones = { total: corr(5) }; }],
    ['malformed decimal', c => { c.lineas[0].correcciones = { cantidad: corr('1,5') }; }],
    ['bad date', c => { c.cabecera.correcciones = { fechaEmision: corr('2026-02-30') }; }],
    ['bad currency', c => { c.cabecera.correcciones = { moneda: corr('usd') }; }],
    ['discounts as JSON text', c => { c.lineas[0].correcciones = { descuentos: corr(JSON.stringify([desc()])) }; }],
    ['discounts null', c => { c.lineas[0].correcciones = { descuentos: corr(null) }; }],
    ['discount member with extra key', c => { c.lineas[0].correcciones = { descuentos: corr([{ ...desc(), x: 1 }]) }; }],
    ['duplicate discount order', c => { c.lineas[0].correcciones = { descuentos: corr([desc(), desc()]) }; }],
    ['discount percent too precise', c => { c.lineas[0].correcciones = { descuentos: corr([desc({ porcentaje: '5.12345' })]) }; }],
    ['tax member missing key', c => { c.cabecera.correcciones = { impuestos: corr([{ tasa: '16', base: '1', monto: '1' }]) }; }],
    ['impuestos on a line', c => { c.lineas[0].correcciones = { impuestos: corr([]) }; }],
    ['source line omitted', c => { c.lineas.pop(); }],
    ['duplicate source line', c => { c.lineas[1].origen = { numeroLinea: 1 }; }],
    ['unknown source line', c => { c.lineas[1].origen = { numeroLinea: 9 }; }],
    ['duplicate lineaId', c => { c.lineas[1].lineaId = c.lineas[0].lineaId; }],
    ['uppercase lineaId', c => { c.lineas[0].lineaId = c.lineas[0].lineaId.toUpperCase().replace(/-/g, '-'); c.lineas[0].lineaId = 'AAAAAAAA-0000-4000-8000-000000000009'; }],
    ['manual line without correction', c => { c.lineas.push({ ...c.lineas[0], lineaId: '40000000-0000-4000-8000-000000000001', origen: null }); }],
    ['factor zero', c => { c.lineas[0].factorConversion = '0'; }],
    ['factor text', c => { c.lineas[0].factorConversion = 'abc'; }],
    ['pendiente with product', c => { c.lineas[0].asociacion = { tipo: 'pendiente', codigoInterno: 'X', evidencia: null, motivo: null }; }],
    ['confirmado manual without motivo', c => { c.lineas[0].asociacion = { tipo: 'confirmado', codigoInterno: 'X', evidencia: 'manual', motivo: null }; }],
    ['producto_nuevo with product', c => { c.lineas[0].asociacion = { tipo: 'producto_nuevo', codigoInterno: 'X', evidencia: 'manual', motivo: 'm' }; }],
    ['producto_nuevo without motivo', c => { c.lineas[0].asociacion = { tipo: 'producto_nuevo', codigoInterno: null, evidencia: 'manual', motivo: null }; }],
    ['barcode intent as text', c => { c.lineas[0].codigoBarras = { usarCodigoFactura: 'si' }; }],
  ];

  it.each(rechazos)('rejects %s', (_nombre, mutar) => {
    const contenido = base();
    mutar(contenido);
    expect(validarContenidoRevision(contenido, ext)).toMatchObject({ ok: false, error: { codigo: 'contenido_invalido' } });
  });

  it('requires source references to match whether an extraction exists', () => {
    expect(validarContenidoRevision(base(), null)).toMatchObject({ ok: false });
    expect(validarContenidoRevision({ ...base(), extraccion_id: null }, ext)).toMatchObject({ ok: false });
  });

  it('never returns a result for garbage input', () => {
    for (const basura of [null, undefined, 5, 'x', [], {}]) {
      expect(validarContenidoRevision(basura, ext)).toMatchObject({ ok: false });
    }
  });
});

// ── Edits ───────────────────────────────────────────────────────────────────

describe('aplicarEdicion', () => {
  const ext = extraccion([linea(1, { codigoProveedor: '00123' }), linea(2, { codigoProveedor: '00123' })]);

  it('records a motivated scalar correction without touching the extraction or the previous revision', () => {
    const previo = deepFreeze(crear(ext));
    const resultado = aplicarEdicion(previo, ext, { tipo: 'linea_escalar', lineaId: previo.lineas[0].lineaId, campo: 'codigoProveedor', valor: '00123A', motivo: 'Codigo impreso completo' });
    expect(resultado).toMatchObject({ ok: true, cambio: true });
    if (!resultado.ok) return;
    expect(resultado.contenido).not.toBe(previo);
    expect(resultado.contenido.lineas[0].correcciones.codigoProveedor).toEqual({ valor: '00123A', motivo: 'Codigo impreso completo' });
    expect(previo.lineas[0].correcciones).toEqual({});
    expect(ext.lineas[0].codigoProveedor).toBe('00123');
    const efectiva = resolverFactura(ext, resultado.contenido);
    expect(efectiva.lineas[0].campos.codigoProveedor).toEqual({ valor: '00123A', original: '00123', corregido: true, motivo: 'Codigo impreso completo' });
    expect(efectiva.lineas[1].campos.codigoProveedor).toMatchObject({ valor: '00123', corregido: false });
  });

  it('records header scalar and typed array corrections, including an explicit clear of a wrong extraction', () => {
    const conDescuento = extraccion([linea(1), linea(2, { descuentos: [desc({ porcentaje: '7' })] })]);
    const previo = deepFreeze(crear(conDescuento));
    const sinCambio = aplicarEdicion(previo, conDescuento, { tipo: 'linea_descuentos', lineaId: previo.lineas[0].lineaId, valor: [], motivo: 'El original ya estaba vacio' });
    expect(sinCambio).toMatchObject({ ok: true, cambio: false });
    const conArrays = aplicar(
      previo,
      conDescuento,
      { tipo: 'cabecera_escalar', campo: 'moneda', valor: 'USD', motivo: 'Moneda impresa' },
      { tipo: 'cabecera_descuentos', valor: [desc({ alcance: 'global' })], motivo: 'Descuento global impreso' },
      { tipo: 'cabecera_impuestos', valor: [{ tasa: '16', base: '8.00', monto: '1.28', exento: false }], motivo: 'Resumen de IVA' },
      { tipo: 'linea_descuentos', lineaId: previo.lineas[1].lineaId, valor: [], motivo: 'La extraccion invento un descuento' }
    );
    expect(Array.isArray(conArrays.cabecera.correcciones.descuentos?.valor)).toBe(true);
    expect(conArrays.lineas[1].correcciones.descuentos).toEqual({ valor: [], motivo: 'La extraccion invento un descuento' });
    expect(previo.cabecera.correcciones).toEqual({});
  });

  it('treats a correction equal to the original as a no-op and an identical repeat as a no-op', () => {
    const previo = crear(ext);
    const igual = aplicarEdicion(previo, ext, { tipo: 'linea_escalar', lineaId: previo.lineas[0].lineaId, campo: 'unidad', valor: 'UND', motivo: 'Sin cambio' });
    expect(igual).toMatchObject({ ok: true, cambio: false });
    expect(igual.ok && igual.contenido).toBe(previo);

    const edicion: Edicion = { tipo: 'linea_escalar', lineaId: previo.lineas[0].lineaId, campo: 'cantidad', valor: '12', motivo: 'Cantidad ilegible' };
    const una = aplicarEdicion(previo, ext, edicion);
    const dos = una.ok ? aplicarEdicion(una.contenido, ext, edicion) : una;
    expect(dos).toMatchObject({ ok: true, cambio: false });
    expect(dos.ok && una.ok && dos.contenido === una.contenido).toBe(true);

    const nuevoMotivo = una.ok ? aplicarEdicion(una.contenido, ext, { ...edicion, motivo: 'Otra razon' }) : una;
    expect(nuevoMotivo).toMatchObject({ ok: true, cambio: true });
  });

  it('removes the correction when the value goes back to the original, and on explicit revert', () => {
    const previo = crear(ext);
    const id = previo.lineas[0].lineaId;
    const corregido = aplicar(previo, ext, { tipo: 'linea_escalar', lineaId: id, campo: 'cantidad', valor: '12', motivo: 'm' });
    const vuelto = aplicar(corregido, ext, { tipo: 'linea_escalar', lineaId: id, campo: 'cantidad', valor: '10', motivo: 'm' });
    expect(vuelto.lineas[0].correcciones).toEqual({});
    const revertido = aplicar(corregido, ext, { tipo: 'revertir_linea', lineaId: id, campo: 'cantidad' });
    expect(revertido.lineas[0].correcciones).toEqual({});
    expect(aplicar(previo, ext, { tipo: 'revertir_cabecera', campo: 'total' })).toBe(previo);
  });

  const invalidas: Array<[string, (id: string) => Edicion]> = [
    ['blank motivo', id => ({ tipo: 'linea_escalar', lineaId: id, campo: 'cantidad', valor: '1', motivo: '  ' })],
    ['malformed decimal', id => ({ tipo: 'linea_escalar', lineaId: id, campo: 'cantidad', valor: '1,5', motivo: 'm' })],
    ['unknown line', () => ({ tipo: 'linea_escalar', lineaId: '99999999-0000-4000-8000-000000000000', campo: 'cantidad', valor: '1', motivo: 'm' })],
    ['unknown field', id => ({ tipo: 'linea_escalar', lineaId: id, campo: 'codigoProducto' as 'cantidad', valor: '1', motivo: 'm' })],
    ['discount member with unknown key', id => ({ tipo: 'linea_descuentos', lineaId: id, valor: [{ ...desc(), extra: 1 } as ExtraidoDescuento], motivo: 'm' })],
    ['discounts as text', id => ({ tipo: 'linea_descuentos', lineaId: id, valor: '[]' as unknown as ExtraidoDescuento[], motivo: 'm' })],
    ['duplicate discount order', id => ({ tipo: 'linea_descuentos', lineaId: id, valor: [desc(), desc()], motivo: 'm' })],
    ['confirmed manual association without motive', id => ({ tipo: 'asociacion', lineaId: id, asociacion: { tipo: 'confirmado', codigoInterno: 'X', evidencia: 'manual', motivo: null } })],
    ['new product without motive', id => ({ tipo: 'asociacion', lineaId: id, asociacion: { tipo: 'producto_nuevo', codigoInterno: null, evidencia: 'manual', motivo: null } })],
    ['zero conversion factor', id => ({ tipo: 'factor_conversion', lineaId: id, valor: '0' })],
    ['removing a source line', id => ({ tipo: 'quitar_linea_manual', lineaId: id })],
  ];

  it.each(invalidas)('rejects %s and leaves the revision untouched', (_nombre, construir) => {
    const previo = deepFreeze(crear(ext));
    const resultado = aplicarEdicion(previo, ext, construir(previo.lineas[0].lineaId));
    expect(resultado).toMatchObject({ ok: false });
  });

  it('keeps pending distinct from an explicit new product', () => {
    const previo = crear(ext);
    expect(previo.lineas[0].asociacion.tipo).toBe('pendiente');
    const nuevo = aplicar(previo, ext, { tipo: 'asociacion', lineaId: previo.lineas[0].lineaId, asociacion: { tipo: 'producto_nuevo', codigoInterno: null, evidencia: 'manual', motivo: 'No existe en catalogo completo' } });
    expect(nuevo.lineas[0].asociacion.tipo).toBe('producto_nuevo');
    expect(nuevo.lineas[1].asociacion.tipo).toBe('pendiente');
  });

  it('adds and removes only manual lines, with a motivated correction and an injected UUID', () => {
    const previo = crear(ext);
    const sinGenerador = aplicarEdicion(previo, ext, { tipo: 'agregar_linea_manual', correcciones: { descripcion: { valor: 'Flete', motivo: 'Impreso a mano' } } });
    expect(sinGenerador).toMatchObject({ ok: false });
    const sinCorreccion = aplicarEdicion(previo, ext, { tipo: 'agregar_linea_manual', correcciones: {} }, ids('50000000'));
    expect(sinCorreccion).toMatchObject({ ok: false });
    const conManual = aplicar(previo, ext, { tipo: 'agregar_linea_manual', correcciones: { descripcion: { valor: 'Flete', motivo: 'Impreso a mano' } } });
    expect(conManual.lineas).toHaveLength(3);
    expect(conManual.lineas[2].origen).toBeNull();
    const sinManual = aplicar(conManual, ext, { tipo: 'quitar_linea_manual', lineaId: conManual.lineas[2].lineaId });
    expect(sinManual.lineas.map(l => l.lineaId)).toEqual(previo.lineas.map(l => l.lineaId));
  });

  it('keeps every lineaId stable across edits', () => {
    const previo = crear(ext);
    const editado = aplicar(previo, ext, { tipo: 'linea_escalar', lineaId: previo.lineas[1].lineaId, campo: 'cantidad', valor: '3', motivo: 'm' }, { tipo: 'factor_conversion', lineaId: previo.lineas[0].lineaId, valor: '12' });
    expect(editado.lineas.map(l => l.lineaId)).toEqual(previo.lineas.map(l => l.lineaId));
  });
});

describe('asociacionDesdeCandidato', () => {
  const match = { candidates: [{ codigoInterno: 'A-1', descripcion: 'x', evidence: [], similarity: null, unknownAttributes: [] }] };
  it('marks a suggested candidate as suggestion evidence', () => {
    expect(asociacionDesdeCandidato(match, 'A-1', null)).toEqual({ tipo: 'confirmado', codigoInterno: 'A-1', evidencia: 'sugerencia', motivo: null });
  });
  it('needs a manual motive for a product outside the candidates', () => {
    expect(asociacionDesdeCandidato(match, 'Z-9', null)).toBeNull();
    expect(asociacionDesdeCandidato(match, 'Z-9', '  ')).toBeNull();
    expect(asociacionDesdeCandidato(match, 'Z-9', 'Mismo articulo, otro codigo')).toEqual({ tipo: 'confirmado', codigoInterno: 'Z-9', evidencia: 'manual', motivo: 'Mismo articulo, otro codigo' });
  });
});

// ── Calculation ─────────────────────────────────────────────────────────────

describe('calcularRevision: a clean invoice', () => {
  const ext = extraccion([linea(1, { total: '8.00' })], {
    subtotal: '8.00',
    total: '9.28',
    impuestos: [{ tasa: '16.00', base: '8.00', monto: '1.28', exento: false }],
  });

  it('is reviewable with explicit confirmations and shows zero differences', () => {
    const calculo = calcularRevision({ extraccion: ext, contenido: confirmada(ext) });
    expect(calculo.bloqueos).toEqual([]);
    expect(calculo.sinBloqueos).toBe(true);
    expect(calculo.pos).toBe('no_verificado');
    expect(calculo.totales).toEqual({ base: '8.00', iva: '1.28', total: '9.28' });
    expect(calculo.porTasa).toEqual([{ tasa: '16', base: '8.00', iva: '1.28' }]);
    expect(calculo.lineas[0]).toMatchObject({ cantidadDocumento: '10', cantidadStock: '10', importeBruto: '8.00', importeFinal: '8.00', base: '8.00', iva: '1.28', totalConIva: '9.28', costoNetoUnitarioStock: '0.80' });
    expect(calculo.diferencias.every(d => d.diferencia === '0.00')).toBe(true);
    expect(calculo.diferencias.map(d => d.campo)).toEqual(['total', 'subtotal', 'total', 'impuestos[0].base', 'impuestos[0].monto']);
  });

  it('blocks without explicit confirmations, never defaulting them', () => {
    const calculo = calcularRevision({ extraccion: ext, contenido: crear(ext) });
    expect(codigos(calculo.bloqueos)).toEqual(expect.arrayContaining([
      'documento_completitud_no_confirmada',
      'recepcion_no_confirmada',
      'iva_inclusion_desconocida',
      'asociacion_pendiente',
      'conversion_no_confirmada',
    ]));
    expect(calculo.sinBloqueos).toBe(false);
  });

  it('blocks an incomplete receipt and an unconfirmed document', () => {
    const base = confirmada(ext);
    const parcial = aplicar(base, ext, { tipo: 'decision_cabecera', campo: 'recepcionCompleta', valor: false }, { tipo: 'decision_cabecera', campo: 'documentoCompletoConfirmado', valor: false });
    expect(codigos(calcularRevision({ extraccion: ext, contenido: parcial }).bloqueos)).toEqual(['documento_completitud_no_confirmada', 'recepcion_no_confirmada']);
  });

  it('does not run on pure extraction values: pending association alone blocks while amounts stay visible', () => {
    const base = aplicar(confirmada(ext), ext, { tipo: 'asociacion', lineaId: confirmada(ext).lineas[0].lineaId, asociacion: { tipo: 'pendiente', codigoInterno: null, evidencia: null, motivo: null } });
    const calculo = calcularRevision({ extraccion: ext, contenido: base });
    expect(codigos(calculo.bloqueos)).toEqual(['asociacion_pendiente']);
    expect(calculo.totales?.total).toBe('9.28');
  });
});

describe('calcularRevision: exact 0.1 + 0.2 and printed differences', () => {
  it('sums 0.1 + 0.2 to exactly 0.30', () => {
    const ext = extraccion([linea(1, { cantidad: '1', precioUnitario: '0.1', tasaIva: '0' }), linea(2, { cantidad: '1', precioUnitario: '0.2', tasaIva: '0' })]);
    const calculo = calcularRevision({ extraccion: ext, contenido: confirmada(ext) });
    expect(calculo.totales).toEqual({ base: '0.30', iva: '0.00', total: '0.30' });
  });

  it('shows exact line and header differences and blocks a mismatch', () => {
    const ext = extraccion([linea(1, { total: '8.10' })], { subtotal: '8.10', total: null });
    const calculo = calcularRevision({ extraccion: ext, contenido: confirmada(ext) });
    expect(calculo.diferencias).toEqual([
      { ambito: 'linea', lineaId: expect.any(String), campo: 'total', impreso: '8.10', calculado: '8.00', diferencia: '0.10' },
      { ambito: 'cabecera', lineaId: null, campo: 'subtotal', impreso: '8.10', calculado: '8.00', diferencia: '0.10' },
    ]);
    expect(codigos(calculo.bloqueos)).toEqual(['diferencia_documental', 'diferencia_documental']);
  });

  it('keeps unknown printed totals unknown instead of inventing a difference', () => {
    const ext = extraccion([linea(1, { total: null })], { subtotal: null, total: null });
    const calculo = calcularRevision({ extraccion: ext, contenido: confirmada(ext) });
    expect(calculo.diferencias).toEqual([]);
    expect(calculo.bloqueos).toEqual([]);
  });

  it('compares printed taxes per rate and blocks a wrong base', () => {
    const ext = extraccion([linea(1)], { impuestos: [{ tasa: '16', base: '9.00', monto: '1.28', exento: false }] });
    const calculo = calcularRevision({ extraccion: ext, contenido: confirmada(ext) });
    expect(calculo.diferencias.find(d => d.campo === 'impuestos[0].base')).toMatchObject({ impreso: '9.00', calculado: '8.00', diferencia: '1.00' });
    expect(calculo.diferencias.find(d => d.campo === 'impuestos[0].monto')?.diferencia).toBe('0.00');
    expect(codigos(calculo.bloqueos)).toEqual(['diferencia_documental']);
  });

  it('accepts a difference only inside an injected test tolerance, which still is never an approval', () => {
    const ext = extraccion([linea(1, { total: '8.01' })]);
    const calculo = calcularRevision({ extraccion: ext, contenido: confirmada(ext), politicas: { tolerancia: '0.02' } });
    expect(codigos(calculo.bloqueos)).toEqual(['politica_no_aprobada']);
  });
});

describe('calcularRevision: ordered discounts', () => {
  const unaLinea = (descuentos: ExtraidoDescuento[], over: Partial<ExtraidaLinea> = {}) =>
    extraccion([linea(1, { cantidad: '1', precioUnitario: '10', tasaIva: '0', descuentos, ...over })]);

  it('applies 10 x 0.80 x 0.95 = 7.60 and then x 0.97 = 7.372, in the order given', () => {
    const ext = unaLinea([desc({ orden: 3, porcentaje: '3' }), desc({ orden: 1, porcentaje: '20' }), desc({ orden: 2, porcentaje: '5' })]);
    const calculo = calcularRevision({ extraccion: ext, contenido: confirmada(ext) });
    expect(calculo.bloqueos).toEqual([]);
    expect(calculo.lineas[0].descuentosAplicados.map(d => [d.orden, d.importeDespues])).toEqual([[1, '8'], [2, '7.6'], [3, '7.372']]);
    expect(calculo.lineas[0]).toMatchObject({ importeBruto: '10.00', importeTrasDescuentos: '7.372', importeFinal: '7.372', base: '7.372' });
  });

  it('checks percent against amount but applies the discount once', () => {
    const consistente = unaLinea([desc({ porcentaje: '20', monto: '2.00' })]);
    const ok = calcularRevision({ extraccion: consistente, contenido: confirmada(consistente) });
    expect(ok.bloqueos).toEqual([]);
    expect(ok.lineas[0].importeFinal).toBe('8.00');
    expect(ok.lineas[0].descuentosAplicados).toHaveLength(1);

    const inconsistente = unaLinea([desc({ porcentaje: '20', monto: '3.00' })]);
    const mal = calcularRevision({ extraccion: inconsistente, contenido: confirmada(inconsistente) });
    expect(codigos(mal.bloqueos)).toEqual(['descuento_inconsistente']);
    expect(mal.lineas[0].importeFinal).toBeNull();
    expect(mal.totales).toBeNull();
  });

  it('applies an amount-only discount and rejects one larger than the line', () => {
    const solo = unaLinea([desc({ porcentaje: null, monto: '2.50' })]);
    expect(calcularRevision({ extraccion: solo, contenido: confirmada(solo) }).lineas[0].importeFinal).toBe('7.50');
    const grande = unaLinea([desc({ porcentaje: null, monto: '10.01' })]);
    expect(codigos(calcularRevision({ extraccion: grande, contenido: confirmada(grande) }).bloqueos)).toEqual(['descuento_excede_importe']);
  });

  it('skips a discount already included in the price and never discounts the net again', () => {
    const ext = unaLinea([desc({ incluidoEnPrecio: true })]);
    const calculo = calcularRevision({ extraccion: ext, contenido: confirmada(ext) });
    expect(calculo.bloqueos).toEqual([]);
    expect(calculo.lineas[0]).toMatchObject({ importeFinal: '10.00', descuentosAplicados: [], descuentosYaIncluidos: [1] });
  });

  it.each([
    ['unknown inclusion', desc({ incluidoEnPrecio: null }), 'descuento_inclusion_desconocida'],
    ['unknown scope', desc({ alcance: null }), 'descuento_alcance_desconocido'],
    ['global scope on a line', desc({ alcance: 'global' }), 'descuento_alcance_inconsistente'],
    ['no value', desc({ porcentaje: null, monto: null }), 'descuento_sin_valor'],
    ['percent over 100', desc({ porcentaje: '100.5' }), 'descuento_invalido'],
  ] as Array<[string, ExtraidoDescuento, CodigoBloqueo]>)('blocks a line discount with %s', (_nombre, descuento, codigo) => {
    const ext = unaLinea([descuento]);
    const calculo = calcularRevision({ extraccion: ext, contenido: confirmada(ext) });
    expect(codigos(calculo.bloqueos)).toEqual([codigo]);
    expect(calculo.lineas[0].importeFinal).toBeNull();
    expect(calculo.totales).toBeNull();
  });

  it('uses a motivated corrected discount array instead of the extracted one, original untouched', () => {
    const ext = unaLinea([desc({ porcentaje: '50' })]);
    const base = confirmada(ext);
    const corregido = aplicar(base, ext, { tipo: 'linea_descuentos', lineaId: base.lineas[0].lineaId, valor: [desc({ porcentaje: '20' })], motivo: 'OCR leyo 50 en lugar de 20' });
    expect(calcularRevision({ extraccion: ext, contenido: corregido }).lineas[0].importeFinal).toBe('8.00');
    const limpiado = aplicar(base, ext, { tipo: 'linea_descuentos', lineaId: base.lineas[0].lineaId, valor: [], motivo: 'No hay descuento' });
    expect(calcularRevision({ extraccion: ext, contenido: limpiado }).lineas[0].importeFinal).toBe('10.00');
    expect(ext.lineas[0].descuentos).toHaveLength(1);
  });
});

describe('calcularRevision: global discounts', () => {
  const global = (over: Partial<ExtraidoDescuento> = {}) => desc({ alcance: 'global', porcentaje: null, monto: '0.10', ...over });
  const tres = () => extraccion(
    [1, 2, 3].map(n => linea(n, { cantidad: '1', precioUnitario: '10', tasaIva: '0' })),
    { descuentos: [global()] }
  );

  it('blocks a global discount when no eligibility policy exists (production policies are empty)', () => {
    expect(POLITICAS_PRODUCCION).toEqual({});
    const ext = tres();
    const calculo = calcularRevision({ extraccion: ext, contenido: confirmada(ext) });
    expect(codigos(calculo.bloqueos)).toEqual(['descuento_global_sin_politica']);
    expect(calculo.totales).toBeNull();
  });

  it('spreads 0.10 as 0.04 / 0.03 / 0.03 by stable lineaId only with an injected policy, still blocked as not approved', () => {
    const ext = tres();
    const contenido = confirmada(ext);
    const politicas: PoliticasCalculo = { descuentoGlobal: { escala: 2, lineasElegibles: contenido.lineas.map(l => l.lineaId) } };
    const calculo = calcularRevision({ extraccion: ext, contenido, politicas });
    expect(calculo.lineas.map(l => l.descuentoGlobalAsignado)).toEqual(['0.04', '0.03', '0.03']);
    expect(calculo.lineas.map(l => l.importeFinal)).toEqual(['9.96', '9.97', '9.97']);
    expect(calculo.totales).toEqual({ base: '29.90', iva: '0.00', total: '29.90' });
    expect(codigos(calculo.bloqueos)).toEqual(['politica_no_aprobada']);
    expect(calculo.sinBloqueos).toBe(false);
  });

  it('allocates only across eligible lines and blocks a total that is not representable at the scale', () => {
    const ext = tres();
    const contenido = confirmada(ext);
    const dos = calcularRevision({ extraccion: ext, contenido, politicas: { descuentoGlobal: { escala: 2, lineasElegibles: [contenido.lineas[1].lineaId, contenido.lineas[2].lineaId] } } });
    expect(dos.lineas.map(l => l.descuentoGlobalAsignado)).toEqual([null, '0.05', '0.05']);
    const fino = extraccion([linea(1, { cantidad: '1', precioUnitario: '10', tasaIva: '0' })], { descuentos: [global({ monto: '0.105' })] });
    const c = confirmada(fino);
    const mal = calcularRevision({ extraccion: fino, contenido: c, politicas: { descuentoGlobal: { escala: 2, lineasElegibles: [c.lineas[0].lineaId] } } });
    expect(codigos(mal.bloqueos)).toContain('descuento_global_no_representable');
  });

  it.each([
    ['unknown inclusion', global({ incluidoEnPrecio: null }), 'descuento_inclusion_desconocida'],
    ['unknown scope', global({ alcance: null }), 'descuento_alcance_desconocido'],
    ['line scope in the header', global({ alcance: 'renglon' }), 'descuento_alcance_inconsistente'],
  ] as Array<[string, ExtraidoDescuento, CodigoBloqueo]>)('blocks a header discount with %s', (_nombre, descuento, codigo) => {
    const ext = extraccion([linea(1, { cantidad: '1', precioUnitario: '10', tasaIva: '0' })], { descuentos: [descuento] });
    expect(codigos(calcularRevision({ extraccion: ext, contenido: confirmada(ext) }).bloqueos)).toEqual([codigo]);
  });

  it('ignores a global discount already included in the price', () => {
    const ext = extraccion([linea(1, { cantidad: '1', precioUnitario: '10', tasaIva: '0' })], { descuentos: [global({ incluidoEnPrecio: true })] });
    const calculo = calcularRevision({ extraccion: ext, contenido: confirmada(ext) });
    expect(calculo.bloqueos).toEqual([]);
    expect(calculo.lineas[0].importeFinal).toBe('10.00');
  });
});

describe('calcularRevision: VAT per line', () => {
  it('keeps mixed 0 / 8 / 16 rates apart per line and per rate, never defaulting to 16', () => {
    const ext = extraccion([
      linea(1, { cantidad: '1', precioUnitario: '100', tasaIva: '16' }),
      linea(2, { cantidad: '1', precioUnitario: '100', tasaIva: '0' }),
      linea(3, { cantidad: '1', precioUnitario: '100', tasaIva: '8' }),
      linea(4, { cantidad: '1', precioUnitario: '50', tasaIva: '16' }),
    ]);
    const calculo = calcularRevision({ extraccion: ext, contenido: confirmada(ext) });
    expect(calculo.bloqueos).toEqual([]);
    expect(calculo.lineas.map(l => [l.tasaIva, l.iva])).toEqual([['16', '16.00'], ['0', '0.00'], ['8', '8.00'], ['16', '8.00']]);
    expect(calculo.porTasa).toEqual([
      { tasa: '0', base: '100.00', iva: '0.00' },
      { tasa: '8', base: '100.00', iva: '8.00' },
      { tasa: '16', base: '150.00', iva: '24.00' },
    ]);
    expect(calculo.totales).toEqual({ base: '350.00', iva: '32.00', total: '382.00' });
  });

  it('blocks an unknown rate instead of assuming 16 and withholds the totals', () => {
    const ext = extraccion([linea(1, { tasaIva: null }), linea(2)]);
    const calculo = calcularRevision({ extraccion: ext, contenido: confirmada(ext) });
    expect(codigos(calculo.bloqueos)).toEqual(['iva_tasa_desconocida']);
    expect(calculo.lineas[0]).toMatchObject({ tasaIva: null, iva: null, base: null });
    expect(calculo.totales).toBeNull();
    expect(calculo.porTasa).toBeNull();
  });

  it('divides included VAT exactly: 116.00 at 16% is 100.00 plus 16.00', () => {
    const ext = extraccion([linea(1, { cantidad: '1', precioUnitario: '116' })]);
    const calculo = calcularRevision({ extraccion: ext, contenido: confirmada(ext, { incluyeIva: true }) });
    expect(calculo.bloqueos).toEqual([]);
    expect(calculo.lineas[0]).toMatchObject({ importeFinal: '116.00', base: '100.00', iva: '16.00', totalConIva: '116.00' });
    expect(calculo.totales).toEqual({ base: '100.00', iva: '16.00', total: '116.00' });
  });

  it('blocks an inexact included-VAT division without an approved rounding policy', () => {
    const ext = extraccion([linea(1, { cantidad: '1', precioUnitario: '10' })]);
    const calculo = calcularRevision({ extraccion: ext, contenido: confirmada(ext, { incluyeIva: true }) });
    expect(codigos(calculo.bloqueos)).toEqual(['iva_incluido_division_inexacta']);
    expect(calculo.lineas[0].base).toBeNull();
    expect(calculo.totales).toBeNull();
  });

  it('treats a zero rate as exempt even when prices include VAT', () => {
    const ext = extraccion([linea(1, { cantidad: '2', precioUnitario: '5', tasaIva: '0' })]);
    const calculo = calcularRevision({ extraccion: ext, contenido: confirmada(ext, { incluyeIva: true }) });
    expect(calculo.lineas[0]).toMatchObject({ base: '10.00', iva: '0.00' });
  });
});

describe('calcularRevision: units, stock quantity and cost', () => {
  it('keeps the documentary quantity and derives stock quantity and net unit cost from the confirmed factor', () => {
    const ext = extraccion([linea(1, { cantidad: '2', unidad: 'CAJA', precioUnitario: '24', tasaIva: '0', total: '48.00' })]);
    const calculo = calcularRevision({ extraccion: ext, contenido: confirmada(ext, { factor: '12' }) });
    expect(calculo.bloqueos).toEqual([]);
    expect(calculo.lineas[0]).toMatchObject({ cantidadDocumento: '2', unidadDocumento: 'CAJA', factorConversion: '12', cantidadStock: '24', base: '48.00', costoNetoUnitarioStock: '2.00' });
    expect(calculo.totales?.base).toBe('48.00');
  });

  it('blocks an unconfirmed factor and an inexact cost per stock unit instead of rounding', () => {
    const ext = extraccion([linea(1, { cantidad: '1', precioUnitario: '10', tasaIva: '0' })]);
    const sinFactor = calcularRevision({ extraccion: ext, contenido: aplicar(confirmada(ext), ext, { tipo: 'factor_conversion', lineaId: confirmada(ext).lineas[0].lineaId, valor: null }) });
    expect(codigos(sinFactor.bloqueos)).toEqual(['conversion_no_confirmada']);
    expect(sinFactor.lineas[0].cantidadStock).toBeNull();
    const inexacto = calcularRevision({ extraccion: ext, contenido: confirmada(ext, { factor: '3' }) });
    expect(codigos(inexacto.bloqueos)).toEqual(['costo_unitario_division_inexacta']);
    expect(inexacto.lineas[0]).toMatchObject({ cantidadStock: '3', base: '10.00', costoNetoUnitarioStock: null });
  });

  it('adds no negative-stock compensation and leaves the supplier total independent of the factor', () => {
    const ext = extraccion([linea(1, { cantidad: '10', precioUnitario: '1', tasaIva: '0' })]);
    const uno = calcularRevision({ extraccion: ext, contenido: confirmada(ext) });
    const doce = calcularRevision({ extraccion: ext, contenido: confirmada(ext, { factor: '12' }) });
    expect(uno.totales).toEqual(doce.totales);
    expect(Object.keys(uno.lineas[0])).not.toContain('compensacionNegativo');
    expect(doce.lineas[0].cantidadStock).toBe('120');
  });

  it('blocks a zero quantity instead of dividing by zero', () => {
    const ext = extraccion([linea(1, { cantidad: '0', precioUnitario: '1', tasaIva: '0' })]);
    expect(codigos(calcularRevision({ extraccion: ext, contenido: confirmada(ext) }).bloqueos)).toEqual(['cantidad_cero']);
  });
});

describe('calcularRevision: repeated SKUs and literal codes', () => {
  it('keeps repeated supplier codes as separate lines with their own costs', () => {
    const ext = extraccion([
      linea(1, { codigoProveedor: '00123', cantidad: '10', precioUnitario: '0.80', tasaIva: '0' }),
      linea(2, { codigoProveedor: '00123', cantidad: '5', precioUnitario: '0.95', tasaIva: '0' }),
    ]);
    const calculo = calcularRevision({ extraccion: ext, contenido: confirmada(ext) });
    expect(calculo.lineas.map(l => [l.codigoProveedor, l.costoNetoUnitarioStock, l.base])).toEqual([['00123', '0.80', '8.00'], ['00123', '0.95', '4.75']]);
    expect(new Set(calculo.lineas.map(l => l.lineaId)).size).toBe(2);
  });

  it('carries a corrected literal code such as 00123A verbatim', () => {
    const ext = extraccion([linea(1, { codigoProveedor: '00123' })]);
    const base = confirmada(ext);
    const corregido = aplicar(base, ext, { tipo: 'linea_escalar', lineaId: base.lineas[0].lineaId, campo: 'codigoProveedor', valor: '00123A', motivo: 'Letra final cortada' });
    expect(calcularRevision({ extraccion: ext, contenido: corregido }).lineas[0].codigoProveedor).toBe('00123A');
  });

  it('includes motivated manual lines in the calculation', () => {
    const ext = extraccion([linea(1, { cantidad: '1', precioUnitario: '10', tasaIva: '0' })]);
    const base = aplicar(confirmada(ext), ext, {
      tipo: 'agregar_linea_manual',
      correcciones: {
        descripcion: { valor: 'Pegamento', motivo: 'No salio en la extraccion' },
        cantidad: { valor: '2', motivo: 'Cantidad impresa' },
        precioUnitario: { valor: '3.50', motivo: 'Precio impreso' },
        tasaIva: { valor: '0', motivo: 'Exento' },
      },
    });
    const manual = base.lineas[1];
    const completo = aplicar(base, ext, { tipo: 'factor_conversion', lineaId: manual.lineaId, valor: '1' }, { tipo: 'asociacion', lineaId: manual.lineaId, asociacion: { tipo: 'producto_nuevo', codigoInterno: null, evidencia: 'manual', motivo: 'Catalogo completo sin coincidencia' } });
    const calculo = calcularRevision({ extraccion: ext, contenido: completo });
    expect(calculo.bloqueos).toEqual([]);
    expect(calculo.lineas[1]).toMatchObject({ numeroLinea: null, base: '7.00', lecturaOcr: null });
    expect(calculo.totales?.base).toBe('17.00');
  });
});

describe('calcularRevision: currency, FX and policies', () => {
  it('blocks unknown and non-USD currency; no FX is ever approved', () => {
    const sinMoneda = extraccion([linea(1)], { moneda: null });
    expect(codigos(calcularRevision({ extraccion: sinMoneda, contenido: confirmada(sinMoneda) }).bloqueos)).toEqual(['moneda_desconocida']);
    const ves = extraccion([linea(1)], { moneda: 'VES', tasaCambio: '36.5' });
    const calculo = calcularRevision({ extraccion: ves, contenido: confirmada(ves) });
    expect(calculo.bloqueos).toEqual([{ codigo: 'moneda_sin_tasa_aprobada', ambito: 'documento', lineaId: null, detalle: 'VES' }]);
    expect(calculo.moneda).toBe('VES');
  });

  it('shows the POS precision effect 0.1234 x 1000 versus 0.12 x 1000 = 3.40 with a test-only scale, never verifying the POS', () => {
    const ext = extraccion([linea(1, { cantidad: '1000', precioUnitario: '0.1234', tasaIva: '0' })]);
    const contenido = confirmada(ext);
    const con = calcularRevision({ extraccion: ext, contenido, politicas: { salidaPos: { escala: 2, modo: 'half_up' } } });
    expect(con.cuantizacionPos).toEqual({
      escala: 2,
      lineas: [{ lineaId: contenido.lineas[0].lineaId, costoDocumental: '0.1234', costoPos: '0.12', importeDocumental: '123.40', importePos: '120.00', diferencia: '3.40' }],
      diferenciaTotal: '3.40',
    });
    expect(con.pos).toBe('no_verificado');
    const sin = calcularRevision({ extraccion: ext, contenido });
    expect(sin.cuantizacionPos).toBeNull();
    expect(sin.bloqueos).toEqual([]);
    expect(sin.pos).toBe('no_verificado');
  });

  it('returns structured blockers on unparsable values instead of a calculator result', () => {
    const ext = extraccion([linea(1, { cantidad: '1', precioUnitario: '10', tasaIva: '0' }), linea(2)]);
    const base = confirmada(ext);
    const roto = aplicar(base, ext, { tipo: 'linea_escalar', lineaId: base.lineas[0].lineaId, campo: 'cantidad', valor: '123456789012', motivo: 'Digitos de mas' });
    const calculo = calcularRevision({ extraccion: ext, contenido: roto });
    expect(calculo.bloqueos).toContainEqual({ codigo: 'valor_invalido', ambito: 'linea', lineaId: base.lineas[0].lineaId, detalle: 'cantidad' });
    expect(calculo.lineas[0]).toMatchObject({ importeBruto: null, base: null });
    expect(calculo.totales).toBeNull();
    expect(calculo.sinBloqueos).toBe(false);
  });

  it('flags missing quantity or price as missing data, not zero', () => {
    const ext = extraccion([linea(1, { cantidad: null, precioUnitario: null })]);
    const calculo = calcularRevision({ extraccion: ext, contenido: confirmada(ext) });
    expect(calculo.bloqueos).toEqual(expect.arrayContaining([
      expect.objectContaining({ codigo: 'dato_faltante', detalle: 'cantidad' }),
      expect.objectContaining({ codigo: 'dato_faltante', detalle: 'precioUnitario' }),
    ]));
    expect(calculo.lineas[0].importeBruto).toBeNull();
  });
});

describe('calcularRevision: OCR confidence versus association decision', () => {
  it('reports them separately and does not let one stand in for the other', () => {
    const ext = extraccion([linea(1, { incertidumbre: { confianzaLectura: 0.42, advertencias: ['borroso'], campoDudoso: ['cantidad'] } })]);
    const sinDecidir = calcularRevision({ extraccion: ext, contenido: crear(ext) });
    expect(sinDecidir.lineas[0].lecturaOcr).toEqual({ confianza: 0.42, advertencias: ['borroso'], campoDudoso: ['cantidad'] });
    expect(sinDecidir.lineas[0].decisionAsociacion.tipo).toBe('pendiente');
    const decidida = calcularRevision({ extraccion: ext, contenido: confirmada(ext) });
    expect(decidida.lineas[0].lecturaOcr?.confianza).toBe(0.42);
    expect(decidida.lineas[0].decisionAsociacion).toMatchObject({ tipo: 'confirmado', evidencia: 'sugerencia' });
    expect(codigos(decidida.bloqueos)).not.toContain('asociacion_pendiente');
  });

  it('accepts an explicit new product without treating pending as one', () => {
    const ext = extraccion([linea(1)]);
    const base = confirmada(ext);
    const nuevo = aplicar(base, ext, { tipo: 'asociacion', lineaId: base.lineas[0].lineaId, asociacion: { tipo: 'producto_nuevo', codigoInterno: null, evidencia: 'manual', motivo: 'Sin coincidencia en catalogo completo' } });
    expect(calcularRevision({ extraccion: ext, contenido: nuevo }).bloqueos).toEqual([]);
  });
});

describe('barcode intent', () => {
  const completo = (productos: Array<{ codigoInterno: string; codigoBarras: string | null }>) => ({ productos, completo: true });
  const parcial = (productos: Array<{ codigoInterno: string; codigoBarras: string | null }>) => ({ productos, completo: false });

  it('compares the literal printed code, leading zeros and letters included', () => {
    const catalogo = completo([{ codigoInterno: 'A', codigoBarras: '00123A' }]);
    expect(evaluarCodigoBarras({ codigoFactura: '00123A', codigoInternoAsociado: 'A', catalogo })).toBe('ya_asignado_a_este_producto');
    expect(evaluarCodigoBarras({ codigoFactura: '00123A', codigoInternoAsociado: 'B', catalogo })).toBe('colision');
    expect(evaluarCodigoBarras({ codigoFactura: '123A', codigoInternoAsociado: 'B', catalogo: completo([{ codigoInterno: 'A', codigoBarras: '00123A' }, { codigoInterno: 'B', codigoBarras: null }]) })).toBe('unico_verificado');
  });

  it('never proves uniqueness from a partial catalog but still reports a visible collision', () => {
    expect(evaluarCodigoBarras({ codigoFactura: '999', codigoInternoAsociado: null, catalogo: parcial([{ codigoInterno: 'A', codigoBarras: null }]) })).toBe('no_verificable');
    expect(evaluarCodigoBarras({ codigoFactura: '999', codigoInternoAsociado: null, catalogo: parcial([{ codigoInterno: 'A', codigoBarras: '999' }]) })).toBe('colision');
    expect(evaluarCodigoBarras({ codigoFactura: '999', codigoInternoAsociado: null, catalogo: completo([]) })).toBe('unico_verificado');
  });

  it('never silently replaces an existing different barcode and reports a missing code', () => {
    const catalogo = completo([{ codigoInterno: 'B', codigoBarras: '7501' }]);
    expect(evaluarCodigoBarras({ codigoFactura: '999', codigoInternoAsociado: 'B', catalogo })).toBe('reemplazo_requiere_confirmacion');
    expect(evaluarCodigoBarras({ codigoFactura: null, codigoInternoAsociado: 'B', catalogo })).toBe('sin_codigo');
    expect(evaluarCodigoBarras({ codigoFactura: '', codigoInternoAsociado: 'B', catalogo })).toBe('sin_codigo');
  });

  it('blocks the review when the barcode intent lacks an exact complete check', () => {
    const ext = extraccion([linea(1, { codigoProveedor: '00123' })]);
    const base = confirmada(ext);
    const conIntencion = aplicar(base, ext, { tipo: 'codigo_barras', lineaId: base.lineas[0].lineaId, usarCodigoFactura: true });
    expect(codigos(calcularRevision({ extraccion: ext, contenido: conIntencion }).bloqueos)).toEqual(['codigo_barras_no_verificado']);
    const parcialEstado = { [base.lineas[0].lineaId]: 'no_verificable' as const };
    expect(codigos(calcularRevision({ extraccion: ext, contenido: conIntencion, estadosCodigoBarras: parcialEstado }).bloqueos)).toEqual(['codigo_barras_no_verificado']);
    const colision = { [base.lineas[0].lineaId]: 'colision' as const };
    expect(calcularRevision({ extraccion: ext, contenido: conIntencion, estadosCodigoBarras: colision }).bloqueos).toEqual([
      { codigo: 'codigo_barras_no_verificado', ambito: 'linea', lineaId: base.lineas[0].lineaId, detalle: 'colision' },
    ]);
    const unico = { [base.lineas[0].lineaId]: 'unico_verificado' as const };
    expect(calcularRevision({ extraccion: ext, contenido: conIntencion, estadosCodigoBarras: unico }).bloqueos).toEqual([]);
    expect(calcularRevision({ extraccion: ext, contenido: base }).bloqueos).toEqual([]);
  });
});

describe('estadoRevision', () => {
  const ext = extraccion([linea(1)]);
  const limpio = calcularRevision({ extraccion: ext, contenido: confirmada(ext) });
  const bloqueado = calcularRevision({ extraccion: ext, contenido: crear(ext) });
  const ultima = { fingerprint: 'a'.repeat(64), facturaVersion: 3, documentoSha256: 'b'.repeat(64) };

  it('is validada only with a matching attestation and a fresh calculation with zero blockers', () => {
    expect(limpio.sinBloqueos).toBe(true);
    expect(estadoRevision({ calculo: limpio, ultima, atestacion: { ...ultima } })).toBe('validada');
  });

  it('is pending without an attestation, and the attestation alone never approves blocked amounts', () => {
    expect(estadoRevision({ calculo: limpio, ultima, atestacion: null })).toBe('pendiente_atestacion');
    expect(estadoRevision({ calculo: bloqueado, ultima, atestacion: { ...ultima } })).toBe('con_bloqueos');
    expect(estadoRevision({ calculo: bloqueado, ultima, atestacion: null })).toBe('con_bloqueos');
  });

  it.each([
    ['fingerprint', { fingerprint: 'c'.repeat(64) }],
    ['base invoice version', { facturaVersion: 2 }],
    ['document SHA', { documentoSha256: 'd'.repeat(64) }],
    ['document detached', { documentoSha256: null }],
  ])('never shows a stale attestation (%s) as valid', (_nombre, cambio) => {
    expect(estadoRevision({ calculo: limpio, ultima, atestacion: { ...ultima, ...cambio } })).toBe('atestacion_obsoleta');
    expect(estadoRevision({ calculo: bloqueado, ultima, atestacion: { ...ultima, ...cambio } })).toBe('atestacion_obsoleta');
  });

  it('a calculation that used test policies can never become validada', () => {
    const conPolitica = calcularRevision({ extraccion: ext, contenido: confirmada(ext), politicas: { tolerancia: '0.01' } });
    expect(estadoRevision({ calculo: conPolitica, ultima, atestacion: { ...ultima } })).toBe('con_bloqueos');
  });
});
