import * as React from 'react';
import { act, fireEvent, render, screen, within } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import FacturaRevisionView, { type FacturaRevisionViewProps } from './FacturaRevisionView';
import type { ExtraccionRow, FacturaRevisionRepository, GuardarRevisionInput } from '../lib/facturaRevisionRepository';
import type { FacturaExtraccionPayload } from '../lib/facturaExtractionContract';
import { useFacturaRevision, type FacturaRevisionControl, type UseFacturaRevisionParams } from '../hooks/useFacturaRevision';
import { OWNER_A, FACTURA_1, deferred, renderWithProviders, settle } from '../test-utils/facturaUiHarness';

// T5.2: the read-only "Impacto en Hybrid" consumer of the review calculation and a stock snapshot. The stock reader
// is injected, or the default strict reader runs over a fake Supabase transport; no network is touched. The fake
// boundary is NOT proof of the deployed listener or POS representation.

const mockIn = jest.fn();
jest.mock('../lib/supabase', () => ({ supabase: { from: () => ({ select: () => ({ in: mockIn }) }) } }));
jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: require('../test-utils/facturaUiHarness').asyncStorage,
}));

const SHA = 'a'.repeat(64);
const EXT = 'e0000000-0000-4000-8000-000000000001';
const FACTURA_2 = 'f0000000-0000-4000-8000-000000000002';
const FP = 'f'.repeat(64);

function payload(cabecera: Record<string, unknown> = {}): FacturaExtraccionPayload {
  return {
    version: 1,
    cabecera: { proveedorNombre: 'Proveedor Uno', proveedorRif: null, numeroDocumento: 'DOC-1', numeroControl: null, fechaEmision: null, moneda: 'USD', tasaCambio: null, subtotal: null, descuentos: [], impuestos: [], total: null, ...cabecera },
    lineas: [
      { numeroLinea: 1, pagina: 1, codigoProveedor: '00123', descripcion: 'Articulo 1', cantidad: '10', unidad: 'UND', precioUnitario: '1.00', descuentos: [], tasaIva: '16', total: null, incertidumbre: null },
    ],
    metadatos: { totalPaginas: 1, paginasProcesadas: [1], documentoCompleto: true, advertencias: [], confianzaGlobal: null },
  } as unknown as FacturaExtraccionPayload;
}

function extraccionRow(resultado: unknown = payload()): ExtraccionRow {
  return { id: EXT, solicitudId: 's0000000-0000-4000-8000-000000000001', estado: 'completado', facturaVersion: 3, documentoSha256: SHA, resultado, errorCodigo: null, iniciadoEn: '2026-10-23T10:00:00Z' };
}

type Mocks = { [K in keyof FacturaRevisionRepository]: jest.Mock };

function fakeRepo(): Mocks {
  return {
    leerRevisiones: jest.fn(async () => []),
    leerExtracciones: jest.fn(async () => []),
    guardarRevision: jest.fn(async (input: GuardarRevisionInput) => ({ revision: input.revisionEsperada + 1, fingerprint: FP, replay: false })),
    aprobarRevision: jest.fn(async (input: { revision: number; fingerprint: string }) => ({ revision: input.revision, fingerprint: input.fingerprint, replay: false })),
    extraer: jest.fn(async () => ({ tipo: 'completado', extraccionId: EXT, replay: false })),
    buscarCandidatos: jest.fn(async () => ({ productos: [], parcial: false })),
    leerColisionesBarras: jest.fn(async (codes: string[]) => Object.fromEntries(codes.map(code => [code, { productos: [], completo: true }]))),
  } as Mocks;
}

let idCounter = 0;
const newId = () => `90000000-0000-4000-8000-${String(++idCounter).padStart(12, '0')}`;
const DOC = { path: `${OWNER_A}/${FACTURA_1}/d.pdf`, mime: 'application/pdf', sha256: SHA, nombre: 'factura.pdf' };

type LeerExistencias = jest.Mock<Promise<Record<string, number>>, [string[]]>;
const lector = (existencias: Record<string, number>): LeerExistencias => jest.fn(async (_codigos: string[]) => existencias);

function viewProps(repo: Mocks, leerExistencias: LeerExistencias | undefined, over: Partial<FacturaRevisionViewProps> = {}): FacturaRevisionViewProps {
  return {
    facturaId: FACTURA_1,
    ownerId: OWNER_A,
    facturaVersion: 3,
    documento: DOC,
    editorDirty: false,
    repository: repo as unknown as FacturaRevisionRepository,
    getSessionUid: () => OWNER_A,
    newId,
    leerExistencias,
    ...over,
  };
}

const byId = (id: string) => screen.getByTestId(id);
const maybeId = (id: string) => screen.queryByTestId(id);
function textOf(id: string): string {
  const parts: string[] = [];
  const walk = (value: unknown) => {
    if (typeof value === 'string') parts.push(value);
    else if (Array.isArray(value)) value.forEach(walk);
    else if (value && typeof value === 'object') walk((value as { children?: unknown }).children);
  };
  walk(byId(id).children);
  return parts.join('');
}

async function pressId(id: string): Promise<void> {
  await act(async () => {
    fireEvent.press(byId(id));
  });
  await settle();
}

async function typeId(id: string, text: string): Promise<void> {
  await act(async () => {
    fireEvent.changeText(byId(id), text);
  });
}

/** Confirms every decision of the single-line review so that it has zero blockers. */
async function confirmEverything(): Promise<void> {
  await pressId('revision-decision-documentoCompletoConfirmado-si');
  await pressId('revision-decision-recepcionCompleta-si');
  await pressId('revision-decision-precioIncluyeIva-no');
  await typeId('revision-linea-1-factor-valor', '1');
  await pressId('revision-linea-1-factor-aplicar');
  await typeId('revision-linea-1-manual-codigo', 'SKU-1');
  await typeId('revision-linea-1-manual-motivo', 'Mismo articulo');
  await pressId('revision-linea-1-manual-aplicar');
}

async function openReview(repo: Mocks, leerExistencias: LeerExistencias | undefined, resultado: unknown = payload()) {
  repo.leerExtracciones.mockResolvedValue([extraccionRow(resultado)]);
  const view = renderWithProviders(<FacturaRevisionView {...viewProps(repo, leerExistencias)} />);
  await settle();
  await pressId(`revision-iniciar-${EXT}`);
  await confirmEverything();
  return view;
}

function visibleStrings(): string[] {
  const out: string[] = [];
  const walk = (node: any): void => {
    if (node === null || node === undefined) return;
    if (typeof node === 'string') out.push(node);
    else if (Array.isArray(node)) node.forEach(walk);
    else {
      for (const value of [node.props?.value, node.props?.accessibilityLabel, node.props?.placeholder]) if (typeof value === 'string') out.push(value);
      walk(node.children);
    }
  };
  walk(screen.toJSON());
  return out;
}

describe('Impacto en Hybrid (read-only view)', () => {
  it('shows quantities, the documentary and hypothetical bases apart, and blocked emission, with no action control', async () => {
    const leer = lector({ 'SKU-1': -3 });
    await openReview(fakeRepo(), leer);

    expect(byId('revision-impacto-hybrid')).toBeTruthy();
    expect(textOf('revision-impacto-sku-SKU-1-cantidad')).toBe('Cantidad en factura: 10');
    expect(textOf('revision-impacto-sku-SKU-1-existencia')).toBe('Existencia leída: -3');
    expect(textOf('revision-impacto-sku-SKU-1-compensacion')).toBe('Compensación por negativo: 3');
    expect(textOf('revision-impacto-sku-SKU-1-envio')).toBe('Cantidad que se enviaría: 13');
    expect(textOf('revision-impacto-sku-SKU-1-esperada')).toBe('Existencia esperada tras la compra: 10');
    expect(textOf('revision-impacto-sku-SKU-1-base-documental')).toBe('Base documental sin IVA: $10.00');
    expect(textOf('revision-impacto-sku-SKU-1-base-hipotetica')).toBe('Base hipotética POS sin IVA (costo × cantidad enviada, no es deuda observada): $13.00');
    expect(textOf('revision-impacto-sku-SKU-1-diferencia')).toBe('Diferencia (documental − hipotética): -$3.00');
    expect(textOf('revision-impacto-total-documental')).toBe('Total documental con impuestos (revisión): $11.60');
    expect(textOf('revision-impacto-emision')).toBe('Emisión importada bloqueada');
    expect(textOf('revision-impacto-bloqueos')).toMatch(/precisión y el redondeo del POS no están verificados/);
    expect(textOf('revision-impacto-bloqueos')).toMatch(/existencia se lee ahora/);
    expect(textOf('revision-impacto-existencias')).toMatch(/^Existencias leídas: \d{4}-\d{2}-\d{2}T/);
    expect(within(byId('revision-impacto-hybrid')).queryAllByRole('button')).toHaveLength(0);
    expect(leer).toHaveBeenCalledTimes(1);
    expect(leer).toHaveBeenCalledWith(['SKU-1']);
  });

  it('adds invoiced units to positive stock and still says imported emission is blocked', async () => {
    await openReview(fakeRepo(), lector({ 'SKU-1': 5 }));

    expect(textOf('revision-impacto-sku-SKU-1-compensacion')).toBe('Compensación por negativo: 0');
    expect(textOf('revision-impacto-sku-SKU-1-envio')).toBe('Cantidad que se enviaría: 10');
    expect(textOf('revision-impacto-sku-SKU-1-esperada')).toBe('Existencia esperada tras la compra: 15');
    expect(textOf('revision-impacto-sku-SKU-1-diferencia')).toBe('Diferencia (documental − hipotética): $0.00');
    expect(textOf('revision-impacto-emision')).toBe('Emisión importada bloqueada');
  });

  it('shows the stock as pending, never as zero, until the read settles', async () => {
    const lectura = deferred<Record<string, number>>();
    await openReview(fakeRepo(), jest.fn((_codigos: string[]) => lectura.promise));

    expect(textOf('revision-impacto-existencias')).toBe('Leyendo existencias de Hybrid…');
    expect(textOf('revision-impacto-sku-SKU-1-existencia')).toBe('Existencia leída: no leída');
    expect(textOf('revision-impacto-sku-SKU-1-envio')).toBe('Cantidad que se enviaría: desconocida');
    expect(textOf('revision-impacto-sku-SKU-1-base-documental')).toBe('Base documental sin IVA: $10.00');
    expect(textOf('revision-impacto-sku-SKU-1-base-hipotetica')).toMatch(/: desconocido$/);

    await act(async () => lectura.resolve({ 'SKU-1': -3 }));
    await settle();
    expect(textOf('revision-impacto-sku-SKU-1-envio')).toBe('Cantidad que se enviaría: 13');
  });

  it('keeps stock unknown, never zero, when the read fails, and does not retry on its own', async () => {
    const leer: LeerExistencias = jest.fn(async (_codigos: string[]) => {
      throw new Error('boom');
    });
    await openReview(fakeRepo(), leer);

    expect(textOf('revision-impacto-existencias')).toBe('No se pudo leer la existencia de Hybrid. Las cantidades quedan desconocidas; no se asume cero.');
    expect(textOf('revision-impacto-sku-SKU-1-existencia')).toBe('Existencia leída: no leída');
    expect(textOf('revision-impacto-sku-SKU-1-compensacion')).toBe('Compensación por negativo: desconocida');
    expect(textOf('revision-impacto-bloqueos')).toMatch(/no se pudo leer la existencia/i);
    expect(textOf('revision-impacto-emision')).toBe('Emisión importada bloqueada');
    await settle();
    expect(leer).toHaveBeenCalledTimes(1);
  });

  it.each(['VES', null])('renders no amount, reads no stock and offers no money input while the currency is %s', async moneda => {
    const leer = lector({ 'SKU-1': -3 });
    await openReview(fakeRepo(), leer, payload({ moneda }));

    expect(textOf('revision-impacto-sin-proyeccion')).toMatch(/revisión tiene bloqueos/);
    expect(textOf('revision-impacto-oculto')).toMatch(/Importe oculto/);
    expect(textOf('revision-impacto-emision')).toBe('Emisión importada bloqueada');
    expect(maybeId('revision-impacto-sku-SKU-1-cantidad')).toBeNull();
    expect(maybeId('revision-impacto-total-documental')).toBeNull();
    const joined = visibleStrings().join('\n');
    expect(joined).not.toContain('$');
    expect(joined).not.toMatch(/\(USD\)/);
    expect(leer).not.toHaveBeenCalled();
  });

  it('exposes nothing and reads no stock before there is a revision, and manual entry stays untouched without a document', async () => {
    const repo = fakeRepo();
    const leer = lector({ 'SKU-1': -3 });
    renderWithProviders(<FacturaRevisionView {...viewProps(repo, leer, { documento: null })} />);
    await settle();

    expect(maybeId('revision-impacto-hybrid')).toBeNull();
    expect(byId('revision-estado')).toBeTruthy();
    expect(leer).not.toHaveBeenCalled();
    expect(repo.guardarRevision).not.toHaveBeenCalled();
  });
});

// ── Hook behavior: reads, identity, session ─────────────────────────────────

let current: FacturaRevisionControl;
function Hook(p: UseFacturaRevisionParams) {
  current = useFacturaRevision(p);
  return null;
}
function hookProps(repo: Mocks, leerExistencias: LeerExistencias | undefined, over: Partial<UseFacturaRevisionParams> = {}): UseFacturaRevisionParams {
  return { repository: repo as unknown as FacturaRevisionRepository, facturaId: FACTURA_1, ownerId: OWNER_A, facturaVersion: 3, documentoSha256: SHA, editorDirty: false, getSessionUid: () => OWNER_A, newId, leerExistencias, ...over };
}
async function edit(edicion: Parameters<FacturaRevisionControl['editar']>[0]) {
  await act(async () => {
    expect(current.editar(edicion).ok).toBe(true);
  });
  await settle();
}
async function confirmHook() {
  await act(async () => {
    expect(current.aplicarExtraccion(EXT, null).ok).toBe(true);
  });
  await settle();
  for (const campo of ['documentoCompletoConfirmado', 'recepcionCompleta', 'precioIncluyeIva'] as const) {
    await edit({ tipo: 'decision_cabecera', campo, valor: campo !== 'precioIncluyeIva' });
  }
  const { lineaId } = current.contenido!.lineas[0];
  await edit({ tipo: 'factor_conversion', lineaId, valor: '1' });
  await edit({ tipo: 'asociacion', lineaId, asociacion: { tipo: 'confirmado', codigoInterno: 'SKU-1', evidencia: 'manual', motivo: 'Printed product' } });
}
async function mountReview(repo: Mocks, leer?: LeerExistencias) {
  repo.leerExtracciones.mockResolvedValue([extraccionRow()]);
  const view = renderWithProviders(<Hook {...hookProps(repo, leer)} />);
  await settle();
  await confirmHook();
  return view;
}

describe('stock snapshot in useFacturaRevision', () => {
  it('reads stock once per SKU set: keystrokes and transient blockers do not trigger a new read', async () => {
    const leer = lector({ 'SKU-1': -3 });
    await mountReview(fakeRepo(), leer);
    expect(leer).toHaveBeenCalledTimes(1);

    const { lineaId } = current.contenido!.lineas[0];
    await edit({ tipo: 'linea_escalar', lineaId, campo: 'descripcion', valor: 'Otra descripción', motivo: 'Texto impreso' });
    await edit({ tipo: 'linea_escalar', lineaId, campo: 'cantidad', valor: null, motivo: 'Borrando para reescribir' });
    expect(current.calculo!.sinBloqueos).toBe(false);
    expect(current.representacionPos!.skus).toEqual([]);
    await edit({ tipo: 'linea_escalar', lineaId, campo: 'cantidad', valor: '12', motivo: 'Cantidad impresa' });
    expect(current.calculo!.sinBloqueos).toBe(true);
    expect(current.representacionPos!.skus[0].cantidadPos).toBe('15');
    expect(leer).toHaveBeenCalledTimes(1);
  });

  it('does not inherit another invoice\'s snapshot for the same SKU, even while the first one is still cached', async () => {
    const repo = fakeRepo();
    repo.leerExtracciones.mockResolvedValue([extraccionRow()]);
    const segunda = deferred<Record<string, number>>();
    const leer: LeerExistencias = jest.fn().mockResolvedValueOnce({ 'SKU-1': -3 }).mockReturnValueOnce(segunda.promise);
    // The shared test client garbage-collects at once; production keeps an unobserved snapshot for minutes.
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const montar = (facturaId: string) => (
      <QueryClientProvider client={client}>
        <Hook {...hookProps(repo, leer, { facturaId })} />
      </QueryClientProvider>
    );
    const view = render(montar(FACTURA_1));
    try {
      await settle();
      await confirmHook();
      expect(current.representacionPos!.skus[0].existenciaLeida).toBe('-3');

      view.rerender(montar(FACTURA_2));
      await settle();
      await confirmHook();

      expect(leer).toHaveBeenCalledTimes(2);
      expect(current.estadoExistencias).toBe('pendiente');
      expect(current.representacionPos!.skus[0].existenciaLeida).toBeNull();
      expect(current.representacionPos!.skus[0].cantidadPos).toBeNull();

      await act(async () => segunda.resolve({ 'SKU-1': 5 }));
      await settle();
      expect(current.representacionPos!.skus[0].existenciaLeida).toBe('5');
    } finally {
      view.unmount();
      client.clear();
    }
  });

  it('stamps the snapshot with the observed read time, and with null when nothing was read', async () => {
    const lectura = deferred<Record<string, number>>();
    const leer: LeerExistencias = jest.fn((_codigos: string[]) => lectura.promise);
    await mountReview(fakeRepo(), leer);
    expect(current.representacionPos!.lecturaExistenciasEn).toBeNull();

    const fijo = jest.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-10-23T12:00:00.000Z'));
    await act(async () => lectura.resolve({ 'SKU-1': 0 }));
    await settle();
    fijo.mockRestore();
    expect(current.representacionPos!.lecturaExistenciasEn).toBe('2026-10-23T12:00:00.000Z');
    expect(current.representacionPos!.skus[0]).toMatchObject({ existenciaLeida: '0', cantidadPos: '10', existenciaEsperada: '10' });
  });

  it('drops the whole projection once the session no longer matches the invoice owner', async () => {
    const repo = fakeRepo();
    const leer = lector({ 'SKU-1': -3 });
    let uid: string | null = OWNER_A;
    repo.leerExtracciones.mockResolvedValue([extraccionRow()]);
    const view = renderWithProviders(<Hook {...hookProps(repo, leer, { getSessionUid: () => uid })} />);
    await settle();
    await confirmHook();
    expect(current.representacionPos).not.toBeNull();

    uid = null;
    view.rerenderUi(<Hook {...hookProps(repo, leer, { getSessionUid: () => uid })} />);
    await settle();
    expect(current.representacionPos).toBeNull();
    expect(current.estadoExistencias).toBe('no_aplica');
  });
});

// ── Stock snapshot vs. the session generation (public seams + retained cache) ──

type Lectura = Record<string, number>;

/** Mounts with a retained QueryClient (production keeps unobserved snapshots) and the hook's public session seams. */
async function mountConSesion(leer: LeerExistencias) {
  const repo = fakeRepo();
  repo.leerExtracciones.mockResolvedValue([extraccionRow()]);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const sesion = { uid: OWNER_A as string | null, cierres: [] as (() => void)[] };
  const props = () => hookProps(repo, leer, { getSessionUid: () => sesion.uid, suscribirCierreSesion: cb => (sesion.cierres.push(cb), () => undefined) });
  const ui = () => (
    <QueryClientProvider client={client}>
      <Hook {...props()} />
    </QueryClientProvider>
  );
  const view = render(ui());
  await settle();
  await confirmHook();
  const cerrarSesion = () => act(async () => sesion.cierres.forEach(cb => cb()));
  const reentrarMismaCuenta = async () => {
    sesion.uid = null;
    await cerrarSesion();
    view.rerender(ui());
    await settle();
    sesion.uid = OWNER_A;
    view.rerender(ui());
    await settle();
  };
  return { client, view, ui, cerrarSesion, reentrarMismaCuenta };
}

describe('stock snapshot is bound to the session generation', () => {
  it('does not admit a read that was pending when the same account signed out and back in', async () => {
    const vieja = deferred<Lectura>();
    const nueva = deferred<Lectura>();
    const leer: LeerExistencias = jest.fn().mockReturnValueOnce(vieja.promise).mockReturnValueOnce(nueva.promise);
    const s = await mountConSesion(leer);
    try {
      expect(current.estadoExistencias).toBe('pendiente');
      await s.reentrarMismaCuenta();
      expect(current.calculo!.sinBloqueos).toBe(true);

      await act(async () => vieja.resolve({ 'SKU-1': -3 }));
      await settle();
      expect(current.estadoExistencias).toBe('pendiente');
      expect(current.representacionPos!.skus[0]).toMatchObject({ existenciaLeida: null, cantidadPos: null });
      expect(current.representacionPos!.lecturaExistenciasEn).toBeNull();
      expect(leer).toHaveBeenCalledTimes(2);

      await act(async () => nueva.resolve({ 'SKU-1': 7 }));
      await settle();
      expect(current.estadoExistencias).toBe('listo');
      expect(current.representacionPos!.skus[0]).toMatchObject({ existenciaLeida: '7', cantidadPos: '10', existenciaEsperada: '17' });
    } finally {
      s.view.unmount();
      s.client.clear();
    }
  });

  it('does not reuse a completed snapshot from the previous session of the same account', async () => {
    const nueva = deferred<Lectura>();
    const leer: LeerExistencias = jest.fn().mockResolvedValueOnce({ 'SKU-1': -3 }).mockReturnValueOnce(nueva.promise);
    const s = await mountConSesion(leer);
    try {
      expect(current.representacionPos!.skus[0].existenciaLeida).toBe('-3');
      await s.reentrarMismaCuenta();

      expect(leer).toHaveBeenCalledTimes(2);
      expect(current.estadoExistencias).toBe('pendiente');
      expect(current.representacionPos!.skus[0].existenciaLeida).toBeNull();
      expect(current.representacionPos!.lecturaExistenciasEn).toBeNull();

      await act(async () => nueva.resolve({ 'SKU-1': 7 }));
      await settle();
      expect(current.representacionPos!.skus[0]).toMatchObject({ existenciaLeida: '7', cantidadPos: '10' });
    } finally {
      s.view.unmount();
      s.client.clear();
    }
  });

  it('fences on the sign-out signal alone, even while the uid is still the invoice owner', async () => {
    const vieja = deferred<Lectura>();
    const nueva = deferred<Lectura>();
    const leer: LeerExistencias = jest.fn().mockReturnValueOnce(vieja.promise).mockReturnValueOnce(nueva.promise);
    const s = await mountConSesion(leer);
    try {
      await s.cerrarSesion();
      await settle();
      await act(async () => vieja.resolve({ 'SKU-1': -3 }));
      await settle();

      expect(leer).toHaveBeenCalledTimes(2);
      expect(current.estadoExistencias).toBe('pendiente');
      expect(current.representacionPos!.skus[0].existenciaLeida).toBeNull();

      await act(async () => nueva.resolve({ 'SKU-1': 9 }));
      await settle();
      expect(current.representacionPos!.skus[0]).toMatchObject({ existenciaLeida: '9', cantidadPos: '10' });
    } finally {
      s.view.unmount();
      s.client.clear();
    }
  });

  it('keeps the snapshot and starts no read on ordinary rerenders or new seam callbacks', async () => {
    const leer = lector({ 'SKU-1': -3 });
    const s = await mountConSesion(leer);
    try {
      expect(current.representacionPos!.skus[0].existenciaLeida).toBe('-3');
      for (let i = 0; i < 3; i++) {
        s.view.rerender(s.ui());
        await settle();
      }
      expect(leer).toHaveBeenCalledTimes(1);
      expect(current.estadoExistencias).toBe('listo');
      expect(current.representacionPos!.skus[0]).toMatchObject({ existenciaLeida: '-3', cantidadPos: '13' });
    } finally {
      s.view.unmount();
      s.client.clear();
    }
  });
});

// ── Default stock reader over a fake Supabase transport ─────────────────────

describe('default stock reader in useFacturaRevision', () => {
  beforeEach(() => mockIn.mockReset());
  const filaStock = (existencia: unknown) => mockIn.mockResolvedValue({ data: [{ codigo_interno: 'SKU-1', existencia }], error: null });

  it.each([
    ['NULL', null],
    ['blank', ''],
    ['non-numeric', 'abc'],
    ['NaN', Number.NaN],
  ])('keeps a %s stock unknown: no zero read, no compensation, no expected stock, no hypothetical POS base', async (_nombre, crudo) => {
    filaStock(crudo);
    await mountReview(fakeRepo());

    expect(current.estadoExistencias).toBe('listo');
    expect(current.representacionPos!.skus[0]).toMatchObject({
      codigoProducto: 'SKU-1',
      existenciaLeida: null,
      compensacion: null,
      cantidadPos: null,
      existenciaEsperada: null,
      baseHipoteticaPosExIva: null,
    });
    expect(current.representacionPos!.emisionImportada.bloqueos).toContainEqual(expect.objectContaining({ codigo: 'existencia_no_leida', codigoProducto: 'SKU-1' }));
  });

  it('keeps a SKU with no stock row unknown, never zero', async () => {
    mockIn.mockResolvedValue({ data: [], error: null });
    await mountReview(fakeRepo());

    expect(current.representacionPos!.skus[0]).toMatchObject({ existenciaLeida: null, existenciaEsperada: null });
    expect(current.representacionPos!.emisionImportada.bloqueos).toContainEqual(expect.objectContaining({ codigo: 'existencia_no_leida' }));
  });

  it('shows an unknown stock as not read in the view, never as zero', async () => {
    filaStock(null);
    await openReview(fakeRepo(), undefined);

    expect(textOf('revision-impacto-sku-SKU-1-existencia')).toBe('Existencia leída: no leída');
    expect(textOf('revision-impacto-sku-SKU-1-envio')).toBe('Cantidad que se enviaría: desconocida');
  });

  it('keeps a real zero stock as zero', async () => {
    filaStock(0);
    await mountReview(fakeRepo());

    expect(current.representacionPos!.skus[0]).toMatchObject({ existenciaLeida: '0', compensacion: '0', cantidadPos: '10', existenciaEsperada: '10' });
    expect(current.representacionPos!.emisionImportada.bloqueos.map(bloqueo => bloqueo.codigo)).not.toContain('existencia_no_leida');
  });

  it('keeps a negative stock and compensates it', async () => {
    filaStock(-3);
    await mountReview(fakeRepo());

    expect(current.representacionPos!.skus[0]).toMatchObject({ existenciaLeida: '-3', compensacion: '3', cantidadPos: '13', existenciaEsperada: '10' });
  });

  it('reads a rejected read as an error and leaves the stock unknown', async () => {
    mockIn.mockResolvedValue({ data: null, error: { message: 'permission denied for table productos' } });
    await mountReview(fakeRepo());

    expect(current.estadoExistencias).toBe('error');
    expect(current.representacionPos!.skus[0]).toMatchObject({ existenciaLeida: null, existenciaEsperada: null });
    expect(mockIn).toHaveBeenCalledTimes(1);
  });
});
