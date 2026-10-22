import {
  addLinea,
  buildSavePayload,
  createDraft,
  draftFromRecord,
  normalizeDecimal,
  removeLinea,
  resolveSaveKey,
  updateLinea,
  type FacturaDraft,
  type FacturaRecord,
} from './facturaProveedor';
import { FacturaError, mapFacturaError } from './facturaProveedorRepository';

const FACTURA_ID = 'f0000000-0000-4000-8000-000000000001';
const L1 = 'a0000000-0000-4000-8000-000000000001';
const L2 = 'a0000000-0000-4000-8000-000000000002';

function draftWith(lineas: Parameters<typeof addLinea>[2][]): FacturaDraft {
  return lineas.reduce(
    (draft, linea, index) => addLinea(draft, `a0000000-0000-4000-8000-00000000010${index}`, linea),
    createDraft({ facturaId: FACTURA_ID }),
  );
}

describe('normalizeDecimal', () => {
  it('acepta coma decimal y espacios', () => {
    expect(normalizeDecimal(' 1,5 ', { intDigits: 9, scale: 6 })).toEqual({ ok: true, value: '1.5' });
  });

  it('devuelve null para vacio (campo ilegible, no cero)', () => {
    expect(normalizeDecimal('', { intDigits: 9, scale: 6 })).toEqual({ ok: true, value: null });
    expect(normalizeDecimal('   ', { intDigits: 9, scale: 6 })).toEqual({ ok: true, value: null });
  });

  it.each(['abc', '-1', '1.2.3', '1e5', '.', '1,2,3'])('rechaza %p', raw => {
    expect(normalizeDecimal(raw, { intDigits: 9, scale: 6 }).ok).toBe(false);
  });

  it('rechaza mas decimales o digitos enteros de los que la base conserva', () => {
    expect(normalizeDecimal('1.23456', { intDigits: 11, scale: 4 }).ok).toBe(false);
    expect(normalizeDecimal('123456789012', { intDigits: 11, scale: 4 }).ok).toBe(false);
    expect(normalizeDecimal('12345678901.1234', { intDigits: 11, scale: 4 }).ok).toBe(true);
  });
});

describe('edicion de renglones', () => {
  it('agrega con ID estable provisto y no deduplica SKU', () => {
    const draft = draftWith([
      { codigoProducto: 'SKU-1', costoUnitario: '2' },
      { codigoProducto: 'SKU-1', costoUnitario: '2.5' },
    ]);

    expect(draft.lineas).toHaveLength(2);
    expect(draft.lineas.map(l => l.codigoProducto)).toEqual(['SKU-1', 'SKU-1']);
    expect(new Set(draft.lineas.map(l => l.lineaId)).size).toBe(2);
  });

  it('actualiza y elimina por ID sin mutar el borrador original', () => {
    const base = addLinea(addLinea(createDraft({ facturaId: FACTURA_ID }), L1, {}), L2, {});

    const updated = updateLinea(base, L1, { descripcion: 'Clavo' });
    const removed = removeLinea(updated, L2);

    expect(base.lineas[0].descripcion).toBe('');
    expect(updated.lineas[0].descripcion).toBe('Clavo');
    expect(removed.lineas.map(l => l.lineaId)).toEqual([L1]);
  });
});

describe('buildSavePayload', () => {
  it('convierte textos vacios en null y conserva orden, IDs y repetidos', () => {
    let draft = createDraft({ facturaId: FACTURA_ID, proveedorCodigo: 'P1', proveedorNombre: 'Norte' });
    draft = addLinea(draft, L1, { codigoProducto: 'SKU-1', cantidad: '2', costoUnitario: '1,50' });
    draft = addLinea(draft, L2, { codigoProducto: 'SKU-1', cantidad: '', costoUnitario: '2' });

    const result = buildSavePayload({ ...draft, numeroDocumento: ' A-001 ', moneda: 'usd', fechaDocumento: '' });

    if (!result.ok) throw new Error('expected ok');
    expect(result.cabecera).toMatchObject({
      proveedor_codigo: 'P1',
      proveedor_nombre: 'Norte',
      numero_documento: 'A-001',
      fecha_documento: null,
      moneda: 'USD',
      documento: null,
    });
    expect(result.lineas.map(l => l.linea_id)).toEqual([L1, L2]);
    expect(result.lineas[0]).toMatchObject({ cantidad_documento: '2', costo_unitario_documento: '1.5', codigo_producto: 'SKU-1' });
    expect(result.lineas[1]).toMatchObject({ cantidad_documento: null, costo_unitario_documento: '2', codigo_producto: 'SKU-1' });
  });

  it('reporta cada error por campo con mensaje en espanol', () => {
    let draft = createDraft({ facturaId: FACTURA_ID });
    draft = addLinea(draft, L1, { cantidad: 'diez', costoUnitario: '1.1234567', total: '-3' });

    const result = buildSavePayload({ ...draft, fechaDocumento: '31/12/2026', moneda: 'DOLAR' });

    if (result.ok) throw new Error('expected errors');
    expect(Object.keys(result.errors).sort()).toEqual(
      ['fechaDocumento', 'moneda', `${L1}:cantidad`, `${L1}:costoUnitario`, `${L1}:total`].sort(),
    );
    expect(result.errors.fechaDocumento).toMatch(/AAAA-MM-DD/);
  });

  it('rechaza fechas imposibles como 2026-02-31', () => {
    const result = buildSavePayload({ ...createDraft({ facturaId: FACTURA_ID }), fechaDocumento: '2026-02-31' });

    expect(result.ok).toBe(false);
  });

  it('rechaza mas de 500 renglones', () => {
    let draft = createDraft({ facturaId: FACTURA_ID });
    for (let i = 0; i < 501; i += 1) {
      draft = addLinea(draft, `a0000000-0000-4000-8000-${String(i).padStart(12, '0')}`, {});
    }

    const result = buildSavePayload(draft);

    if (result.ok) throw new Error('expected errors');
    expect(result.errors.lineas).toMatch(/500/);
  });

  it('incluye el documento adjunto tal cual', () => {
    const documento = {
      path: `u/${FACTURA_ID}/d.pdf`,
      nombre: 'factura.pdf',
      mime: 'application/pdf' as const,
      bytes: 10,
      sha256: 'a'.repeat(64),
    };

    const result = buildSavePayload({ ...createDraft({ facturaId: FACTURA_ID }), documento });

    if (!result.ok) throw new Error('expected ok');
    expect(result.cabecera.documento).toEqual(documento);
  });
});

describe('resolveSaveKey', () => {
  const payload = { cabecera: { a: 1 }, lineas: [] };

  it('reutiliza la clave pendiente mientras el contenido no cambie', () => {
    const first = resolveSaveKey(null, payload, () => 'key-1');
    const retry = resolveSaveKey(first, payload, () => 'key-2');

    expect(retry.key).toBe('key-1');
  });

  it('genera una clave nueva cuando cambia el contenido', () => {
    const first = resolveSaveKey(null, payload, () => 'key-1');
    const changed = resolveSaveKey(first, { ...payload, cabecera: { a: 2 } }, () => 'key-2');

    expect(changed.key).toBe('key-2');
  });
});

describe('draftFromRecord', () => {
  const record: FacturaRecord = {
    id: FACTURA_ID,
    version: 3,
    proveedor_codigo: 'P1',
    proveedor_nombre: 'Norte',
    numero_documento: 'A-001',
    numero_control: null,
    fecha_documento: '2026-10-01',
    moneda: 'USD',
    notas: null,
    documento_path: null,
    documento_nombre: null,
    documento_mime: null,
    documento_bytes: null,
    documento_sha256: null,
    lineas: [
      { linea_id: L2, orden: 2, codigo_proveedor: null, codigo_producto: 'SKU-1', descripcion: 'B', cantidad_documento: 1, unidad_documento: null, costo_unitario_documento: 2.5, total_documento: null, nota: null },
      { linea_id: L1, orden: 1, codigo_proveedor: null, codigo_producto: 'SKU-1', descripcion: 'A', cantidad_documento: 10, unidad_documento: 'UND', costo_unitario_documento: 1.25, total_documento: 12.5, nota: null },
    ],
  };

  it('reconstruye el borrador ordenado por orden con la version del servidor', () => {
    const draft = draftFromRecord(record);

    expect(draft.version).toBe(3);
    expect(draft.lineas.map(l => l.lineaId)).toEqual([L1, L2]);
    expect(draft.lineas[0]).toMatchObject({ cantidad: '10', costoUnitario: '1.25', total: '12.5', unidad: 'UND' });
    expect(draft.lineas[1].total).toBe('');
  });

  it('un borrador reabierto sin cambios produce el mismo contenido que se guardo', () => {
    const draft = draftFromRecord(record);

    const result = buildSavePayload(draft);

    if (!result.ok) throw new Error('expected ok');
    expect(result.lineas.map(l => l.linea_id)).toEqual([L1, L2]);
    expect(result.lineas[0]).toMatchObject({ cantidad_documento: '10', costo_unitario_documento: '1.25', total_documento: '12.5' });
  });

  it('describe el documento adjunto cuando existe', () => {
    const draft = draftFromRecord({
      ...record,
      documento_path: 'u/f/d.pdf',
      documento_nombre: 'f.pdf',
      documento_mime: 'application/pdf',
      documento_bytes: 99,
      documento_sha256: 'b'.repeat(64),
    });

    expect(draft.documento).toEqual({ path: 'u/f/d.pdf', nombre: 'f.pdf', mime: 'application/pdf', bytes: 99, sha256: 'b'.repeat(64) });
  });
});

describe('moneda: importes manuales siempre en USD', () => {
  const draftConMoneda = (moneda: string): FacturaDraft => ({ ...createDraft({ facturaId: FACTURA_ID }), moneda });

  it.each([
    ['usd', 'USD'],
    [' USD ', 'USD'],
    ['', 'USD'],
    ['   ', 'USD'],
  ])('envia moneda USD para %p', (raw, expected) => {
    const result = buildSavePayload(draftConMoneda(raw));

    if (!result.ok) throw new Error('expected ok');
    expect(result.cabecera.moneda).toBe(expected);
  });

  it.each(['EUR', 'ves', 'COP', 'DOLAR'])('rechaza %p sin convertir ni reetiquetar importes', raw => {
    const draft = addLinea(draftConMoneda(raw), L1, { costoUnitario: '10' });

    const result = buildSavePayload(draft);

    if (result.ok) throw new Error('expected errors');
    expect(result.errors.moneda).toBe('Los importes se registran en USD');
    expect(Object.keys(result.errors)).toEqual(['moneda']);
  });

  it('un registro heredado en otra moneda no se reetiqueta como USD al guardar', () => {
    const draft = draftFromRecord({
      id: FACTURA_ID,
      version: 1,
      proveedor_codigo: null,
      proveedor_nombre: null,
      numero_documento: null,
      numero_control: null,
      fecha_documento: null,
      moneda: 'EUR',
      notas: null,
      documento_path: null,
      documento_nombre: null,
      documento_mime: null,
      documento_bytes: null,
      documento_sha256: null,
      lineas: [],
    });

    const result = buildSavePayload(draft);

    expect(draft.moneda).toBe('EUR');
    expect(result.ok).toBe(false);
  });
});

describe('importes: vacio es nulo, nunca cero', () => {
  const draftConLinea = (fields: Parameters<typeof addLinea>[2]): FacturaDraft =>
    addLinea(createDraft({ facturaId: FACTURA_ID }), L1, fields);

  it.each(['', '   ', '\t'])('un costo %p queda sin dato en el payload', raw => {
    const result = buildSavePayload(draftConLinea({ costoUnitario: raw, cantidad: raw, total: raw }));

    if (!result.ok) throw new Error('expected ok');
    expect(result.lineas[0]).toMatchObject({
      cantidad_documento: null,
      costo_unitario_documento: null,
      total_documento: null,
    });
  });

  it('un cero explicito sigue siendo cero y no se confunde con vacio', () => {
    const result = buildSavePayload(draftConLinea({ costoUnitario: '0', cantidad: '0,00', total: '0.0' }));

    if (!result.ok) throw new Error('expected ok');
    expect(result.lineas[0]).toMatchObject({
      cantidad_documento: '0',
      costo_unitario_documento: '0',
      total_documento: '0',
    });
  });

  it.each(['abc', 'Infinity', 'NaN', '-0', '+5', '1_000'])('un texto ilegible %p se rechaza y no guarda cero', raw => {
    const result = buildSavePayload(draftConLinea({ cantidad: raw }));

    if (result.ok) throw new Error('expected errors');
    expect(result.errors[`${L1}:cantidad`]).toBe('Usa solo números positivos, por ejemplo 12,50');
  });

  it('un importe vacio reabierto sigue vacio en lugar de mostrar 0', () => {
    const draft = draftFromRecord({
      id: FACTURA_ID,
      version: 2,
      proveedor_codigo: null,
      proveedor_nombre: null,
      numero_documento: null,
      numero_control: null,
      fecha_documento: null,
      moneda: 'USD',
      notas: null,
      documento_path: null,
      documento_nombre: null,
      documento_mime: null,
      documento_bytes: null,
      documento_sha256: null,
      lineas: [
        { linea_id: L1, orden: 1, codigo_proveedor: null, codigo_producto: null, descripcion: null, cantidad_documento: null, unidad_documento: null, costo_unitario_documento: 0, total_documento: '0', nota: null },
      ],
    });

    expect(draft.lineas[0]).toMatchObject({ cantidad: '', costoUnitario: '0', total: '0' });
  });

  it.each([
    ['12.345678', '12.345678'],
    ['12,345678', '12.345678'],
    ['0.000001', '0.000001'],
    ['000123.500000', '123.5'],
  ])('el costo %p conserva su valor dentro de la precision de la columna', (raw, expected) => {
    const result = buildSavePayload(draftConLinea({ costoUnitario: raw }));

    if (!result.ok) throw new Error('expected ok');
    expect(result.lineas[0].costo_unitario_documento).toBe(expected);
  });

  it('renglones repetidos conservan cada uno su propio importe', () => {
    const draft = addLinea(draftConLinea({ codigoProducto: 'SKU-1', costoUnitario: '2,25' }), L2, {
      codigoProducto: 'SKU-1',
      costoUnitario: '3.125',
    });

    const result = buildSavePayload(draft);

    if (!result.ok) throw new Error('expected ok');
    expect(result.lineas.map(l => [l.linea_id, l.costo_unitario_documento])).toEqual([
      [L1, '2.25'],
      [L2, '3.125'],
    ]);
  });
});

describe('mapFacturaError clasifica por SQLSTATE y no por estado HTTP', () => {
  type RawError = { code?: string; message?: string; status?: number };
  const classify = (error: RawError): string => mapFacturaError(error).code;

  it.each([400, 409, undefined])('PV409 es version obsoleta con HTTP %p', status => {
    expect(classify({ code: 'PV409', message: 'version_obsoleta', status })).toBe('version_obsoleta');
  });

  it.each([400, 409, undefined])('PI409 es clave reutilizada con HTTP %p', status => {
    expect(classify({ code: 'PI409', message: 'clave_idempotencia_reutilizada', status })).toBe('clave_reutilizada');
  });

  it('un 409 sin SQLSTATE conocido nunca se toma por conflicto de version', () => {
    expect(classify({ code: 'XX000', message: 'internal', status: 409 })).toBe('desconocido');
    expect(classify({ message: 'conflict', status: 409 })).toBe('desconocido');
  });

  it('distingue conflicto genuino de clave reutilizada con mensajes distintos', () => {
    const stale = mapFacturaError({ code: 'PV409', message: 'x' });
    const reused = mapFacturaError({ code: 'PI409', message: 'x' });

    expect(stale.message).not.toBe(reused.message);
    expect(stale.message).toMatch(/cambió desde otro dispositivo/);
    expect(reused.message).toMatch(/ya se registró con otro contenido/);
  });

  it.each([
    ['22023', 'datos_invalidos'],
    ['42501', 'no_autorizado'],
    ['P0002', 'no_encontrada'],
  ])('SQLSTATE estandar %s se clasifica como %s', (code, expected) => {
    expect(classify({ code, message: 'boom', status: 400 })).toBe(expected);
  });

  it.each([
    { code: 'XX000', message: 'relation "facturas_proveedores" does not exist' },
    { code: 'ZZ999', message: 'SELECT secret FROM auth.users' },
  ])('un codigo no mapeado da un error generico en espanol sin detalles SQL', raw => {
    const error = mapFacturaError(raw);

    expect(error).toBeInstanceOf(FacturaError);
    expect(error.code).toBe('desconocido');
    expect(error.message).toBe('No se pudo completar la operación. Inténtalo otra vez.');
    expect(error.message).not.toMatch(/relation|facturas_proveedores|auth\.users|SELECT/);
  });

  it('una entrada ausente tampoco aparenta exito', () => {
    expect(mapFacturaError(null)).toBeInstanceOf(FacturaError);
    expect(mapFacturaError(undefined).code).toBe('desconocido');
  });
});
