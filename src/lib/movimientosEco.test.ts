import { mergeLocalEchoes, MovimientoProducto } from './movimientosEco';

const HOUR = 60 * 60 * 1000;
const BASE = Date.parse('2026-11-20T10:00:00-04:00');

function appAdjustment(overrides: Partial<MovimientoProducto> = {}): MovimientoProducto {
  return {
    id: 'ajuste-10',
    tipo: 'ajuste',
    cantidad: -30,
    referencia: 'Ajuste rápido',
    nota: 'Ajuste rápido',
    fechaFormateada: '20/11/2026',
    timestamp: BASE,
    aplicadoTs: BASE + HOUR,
    backend_status: 'completado',
    esEcoLocal: false,
    ...overrides,
  };
}

function localEcho(overrides: Partial<MovimientoProducto> = {}): MovimientoProducto {
  return {
    id: 'ajuste-20',
    tipo: 'ajuste',
    cantidad: -30,
    referencia: 'Ajuste #00000366: DESINCORPORACION',
    fechaFormateada: '20/11/2026',
    timestamp: BASE + HOUR - 60_000,
    backend_status: 'completado',
    esEcoLocal: true,
    ...overrides,
  };
}

describe('mergeLocalEchoes', () => {
  it('collapses an applied app adjustment and its HybridLite echo into the app row', () => {
    const result = mergeLocalEchoes([localEcho(), appAdjustment()]);

    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('ajuste-10');
    expect(result[0].nota).toBe('Ajuste #00000366: DESINCORPORACION');
  });

  it('keeps the app note when it adds information beyond the reference', () => {
    const result = mergeLocalEchoes([localEcho(), appAdjustment({ nota: 'Conteo físico' })]);

    expect(result).toHaveLength(1);
    expect(result[0].nota).toBe('Conteo físico');
  });

  it('pairs each echo with exactly one app adjustment', () => {
    const result = mergeLocalEchoes([
      appAdjustment({ id: 'ajuste-1', cantidad: -328 }),
      appAdjustment({ id: 'ajuste-2', cantidad: -30 }),
      localEcho({ id: 'ajuste-3', cantidad: -328, referencia: 'Ajuste #00000365: DESINCORPORACION' }),
      localEcho({ id: 'ajuste-4', cantidad: -30 }),
    ]);

    expect(result.map((m) => m.id).sort()).toEqual(['ajuste-1', 'ajuste-2']);
  });

  it('keeps adjustments made directly in the POS that have no app order', () => {
    const result = mergeLocalEchoes([localEcho({ cantidad: -5 }), appAdjustment()]);

    expect(result.map((m) => m.id).sort()).toEqual(['ajuste-10', 'ajuste-20']);
  });

  it('does not pair an app adjustment the backend has not applied yet', () => {
    const result = mergeLocalEchoes([
      localEcho(),
      appAdjustment({ backend_status: 'pendiente', aplicadoTs: undefined }),
    ]);

    expect(result).toHaveLength(2);
  });

  it('does not pair an echo that happened before the app order or far from its application', () => {
    const result = mergeLocalEchoes([
      localEcho({ id: 'ajuste-before', timestamp: BASE - 2 * HOUR }),
      localEcho({ id: 'ajuste-later', timestamp: BASE + 30 * HOUR }),
      appAdjustment(),
    ]);

    expect(result).toHaveLength(3);
  });

  it('leaves sales untouched', () => {
    const venta: MovimientoProducto = {
      id: 'venta-1',
      tipo: 'venta',
      cantidad: -30,
      referencia: 'Factura 00034252',
      fechaFormateada: '20/11/2026',
      timestamp: BASE + HOUR,
      ventaId: 7,
    };

    const result = mergeLocalEchoes([venta, appAdjustment()]);

    expect(result.map((m) => m.id).sort()).toEqual(['ajuste-10', 'venta-1']);
  });
});
