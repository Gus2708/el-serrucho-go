import {
  esEspejoAjusteLocal,
  esEspejoLocal,
  extraerPcLocal,
  filtrarEspejosDuplicados,
  ItemParaDedupe,
  limpiarNotaLocal,
  OrdenParaDedupe,
  resolverCreadorOrden,
  resolverOrigenLocal,
} from './ordenOrigen';

describe('ordenOrigen helpers', () => {
  it('identifica espejos locales de inventario y compras sin confundir órdenes de app', () => {
    const ajusteLocal = { creado_por: null, nota: '[Local Inv ID: 549] - [PC: PRINCIPAL] - Ajuste #00000291: DESINCORPORACION' };
    const compraLocal = { creado_por: null, nota: '[Local Com ID: 608] - Compra #00000157: FERRETERIA ARCI' };
    const ordenApp = { creado_por: 'ca1d0a1f-c4e1-475a-89bb-728e3afad076', nota: 'Ajuste rápido' };

    expect(esEspejoLocal(ajusteLocal)).toBe(true);
    expect(esEspejoAjusteLocal(ajusteLocal)).toBe(true);

    expect(esEspejoLocal(compraLocal)).toBe(true);
    expect(esEspejoAjusteLocal(compraLocal)).toBe(false);

    expect(esEspejoLocal(ordenApp)).toBe(false);
    expect(esEspejoAjusteLocal(ordenApp)).toBe(false);
  });

  it('extrae el PC y limpia las etiquetas técnicas de nota local', () => {
    const notaConPc = '[Local Inv ID: 549] - [PC: PRINCIPAL] - Ajuste #00000291: DESINCORPORACION DE PRODUCTOS DEFECTUOSO';
    const notaSinPc = '[Local Inv ID: 634] - Ajuste #00000367: DESINCORPORACION DE PRODUCTOS DEFECTUOSO';
    const compraConPc = '[Local Com ID: 608] - [PC: DESKTOP-U9B6562] - Compra #00000157: FERRETERIA ARCI';

    expect(extraerPcLocal(notaConPc)).toBe('PRINCIPAL');
    expect(extraerPcLocal(notaSinPc)).toBeNull();
    expect(extraerPcLocal(compraConPc)).toBe('DESKTOP-U9B6562');

    expect(limpiarNotaLocal(notaConPc)).toBe('Ajuste #00000291: DESINCORPORACION DE PRODUCTOS DEFECTUOSO');
    expect(limpiarNotaLocal(notaSinPc)).toBe('Ajuste #00000367: DESINCORPORACION DE PRODUCTOS DEFECTUOSO');
    expect(limpiarNotaLocal(compraConPc)).toBe('Compra #00000157: FERRETERIA ARCI');
  });

  it('resuelve origen local y creador con fallback apropiado', () => {
    expect(resolverOrigenLocal('[Local Inv ID: 549] - [PC: PRINCIPAL] - Ajuste #00000291')).toBe('HybridLite (PRINCIPAL)');
    expect(resolverOrigenLocal('[Local Inv ID: 549] - Ajuste #00000291')).toBe('HybridLite (Local)');
    expect(resolverOrigenLocal('[Local Com ID: 608] - [PC: ESTACION001] - Compra #00000157')).toBe('HybridLite (ESTACION001)');
    expect(resolverOrigenLocal('Ajuste rápido')).toBeUndefined();

    expect(resolverCreadorOrden({ creado_por: 'u1', creado_por_nombre: 'Gustavo', nota: 'Ajuste rápido' })).toBe('Gustavo');
    expect(resolverCreadorOrden({ creado_por: null, nota: '[Local Inv ID: 549] - [PC: PRINCIPAL] - Ajuste #00000291' })).toBe('HybridLite (PRINCIPAL)');
    expect(resolverCreadorOrden({ creado_por: null, nota: '[Local Inv ID: 634] - Ajuste #00000367' })).toBe('HybridLite (Local)');
    expect(resolverCreadorOrden({ creado_por: 'u-missing', nota: 'Ajuste rápido' })).toBe('Desconocido');
  });
});

describe('filtrarEspejosDuplicados', () => {
  it('oculta el espejo duplicado de un ajuste rápido de app (caso OC-35975 / OC-35976)', () => {
    const ordenes: OrdenParaDedupe[] = [
      {
        id: 35976,
        creado_por: null,
        nota: '[Local Inv ID: 634] - Ajuste #00000367: DESINCORPORACION DE PRODUCTOS DEFECTUOSO',
        creado_en: '2026-11-20T20:22:57+00:00',
      },
      {
        id: 35975,
        creado_por: 'ca1d0a1f-c4e1-475a-89bb-728e3afad076',
        nota: 'Ajuste rápido',
        creado_en: '2026-11-20T20:22:34.41485+00:00',
      },
    ];
    const items: Record<number, ItemParaDedupe[]> = {
      35975: [{ codigo_producto: '01567', delta: 75, backend_aplicado_en: '2026-11-20T20:23:02.882241+00:00' }],
      35976: [{ codigo_producto: '01567', delta: 75.0, backend_aplicado_en: null }],
    };

    const result = filtrarEspejosDuplicados(ordenes, items);
    expect(result.map(o => o.id)).toEqual([35975]);
  });

  it('oculta múltiples documentos troceados de un mismo lote y conserva un ajuste manual posterior idéntico', () => {
    const ordenes: OrdenParaDedupe[] = [
      {
        id: 35964,
        creado_por: null,
        nota: '[Local Inv ID: 630] - [PC: PRINCIPAL] - Ajuste #00000363',
        creado_en: '2026-11-18T20:14:40+00:00',
      },
      {
        id: 35963,
        creado_por: null,
        nota: '[Local Inv ID: 629] - Ajuste #00000362',
        creado_en: '2026-11-18T20:14:28+00:00',
      },
      {
        id: 35962,
        creado_por: null,
        nota: '[Local Inv ID: 628] - Ajuste #00000361',
        creado_en: '2026-11-18T20:13:48+00:00',
      },
      {
        id: 35961,
        creado_por: 'ca1d0a1f-c4e1-475a-89bb-728e3afad076',
        nota: 'Restauración de lote',
        creado_en: '2026-11-18T20:12:56+00:00',
      },
    ];
    const items: Record<number, ItemParaDedupe[]> = {
      35961: [
        { codigo_producto: 'A1', delta: 5, backend_aplicado_en: '2026-11-18T20:14:35+00:00' },
        { codigo_producto: 'A2', delta: -3, backend_aplicado_en: '2026-11-18T20:14:35+00:00' },
        { codigo_producto: 'A3', delta: 12, backend_aplicado_en: '2026-11-18T20:14:35+00:00' },
      ],
      35962: [
        { codigo_producto: 'A1', delta: 5 },
        { codigo_producto: 'A2', delta: -3 },
      ],
      35963: [{ codigo_producto: 'A3', delta: 12 }],
      35964: [{ codigo_producto: 'A3', delta: 12 }],
    };

    const result = filtrarEspejosDuplicados(ordenes, items);
    expect(result.map(o => o.id)).toEqual([35964, 35961]);
  });

  it('conserva ajustes manuales sin orden de app equivalente y compras locales siempre', () => {
    const ordenes: OrdenParaDedupe[] = [
      {
        id: 35969,
        creado_por: null,
        nota: '[Local Com ID: 608] - Compra #00000157: FERRETERIA ARCI C.A',
        creado_en: '2026-11-19T20:04:25+00:00',
      },
      {
        id: 35967,
        creado_por: null,
        nota: '[Local Inv ID: 631] - [PC: PRINCIPAL] - Ajuste #00000364',
        creado_en: '2026-11-19T14:57:31+00:00',
      },
      {
        id: 35975,
        creado_por: 'ca1d0a1f-c4e1-475a-89bb-728e3afad076',
        nota: 'Ajuste rápido',
        creado_en: '2026-11-20T20:22:34+00:00',
      },
    ];
    const items: Record<number, ItemParaDedupe[]> = {
      35975: [{ codigo_producto: '01567', delta: 75, backend_aplicado_en: '2026-11-20T20:23:02+00:00' }],
      35969: [{ codigo_producto: '01567', delta: 75 }],
      35967: [{ codigo_producto: 'IMP234565', delta: -3 }],
    };

    const result = filtrarEspejosDuplicados(ordenes, items);
    expect(result.map(o => o.id)).toEqual([35969, 35967, 35975]);
  });

  it('fail-open: no oculta espejos sin ítems cargados ni los que están fuera de ventana o sin backend_aplicado_en', () => {
    const ordenes: OrdenParaDedupe[] = [
      {
        id: 10,
        creado_por: null,
        nota: '[Local Inv ID: 100] - Ajuste #00000100',
        creado_en: '2026-11-20T20:22:50+00:00',
      },
      {
        id: 11,
        creado_por: null,
        nota: '[Local Inv ID: 101] - Ajuste #00000101',
        creado_en: '2026-11-20T20:30:00+00:00',
      },
      {
        id: 12,
        creado_por: 'user-1',
        nota: 'Ajuste app pendiente/sin aplicado_en',
        creado_en: '2026-11-20T20:22:30+00:00',
      },
    ];
    const items: Record<number, ItemParaDedupe[]> = {
      // Sin backend_aplicado_en -> no puede absorber espejos
      12: [{ codigo_producto: '01567', delta: 50, backend_aplicado_en: null }],
      // Sin items para orden 10 -> fail-open
      11: [{ codigo_producto: '01567', delta: 50 }],
    };

    expect(filtrarEspejosDuplicados(ordenes, items).map(o => o.id)).toEqual([10, 11, 12]);
  });
});
