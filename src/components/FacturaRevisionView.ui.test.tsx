import * as React from 'react';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react-native';
import FacturaRevisionView, { type FacturaRevisionViewProps } from './FacturaRevisionView';
import {
  RevisionRepositoryError,
  type ExtraccionRow,
  type FacturaRevisionRepository,
  type GuardarRevisionInput,
  type RevisionRow,
} from '../lib/facturaRevisionRepository';
import { crearRevisionDesdeExtraccion, aplicarEdicion, type RevisionContenido } from '../lib/facturaRevision';
import type { FacturaExtraccionPayload } from '../lib/facturaExtractionContract';
import { OWNER_A, OWNER_B, FACTURA_1, renderWithProviders, settle } from '../test-utils/facturaUiHarness';

jest.mock('../lib/supabase', () => ({ supabase: {} }));
jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: require('../test-utils/facturaUiHarness').asyncStorage,
}));

const SHA = 'a'.repeat(64);
const EXT = 'e0000000-0000-4000-8000-000000000001';
const EXT_2 = 'e0000000-0000-4000-8000-000000000002';
const FP = 'f'.repeat(64);

const linea = (n: number, over: Record<string, unknown> = {}) => ({
  numeroLinea: n,
  pagina: 2,
  codigoProveedor: n === 3 ? 'AB-9' : '00123',
  descripcion: `Articulo ${n}`,
  cantidad: ['10', '5', '2'][n - 1],
  unidad: 'UND',
  precioUnitario: ['0.80', '0.95', '3.10'][n - 1],
  descuentos: [],
  tasaIva: '16',
  total: ['8.00', '4.75', '6.20'][n - 1],
  incertidumbre: { confianzaLectura: 0.55, advertencias: [], campoDudoso: [] },
  ...over,
});

function payload(cabecera: Record<string, unknown> = {}): FacturaExtraccionPayload {
  return {
    version: 1,
    cabecera: { proveedorNombre: 'Proveedor Uno', proveedorRif: null, numeroDocumento: 'DOC-1', numeroControl: null, fechaEmision: '2026-10-15', moneda: 'USD', tasaCambio: null, subtotal: null, descuentos: [], impuestos: [], total: null, ...cabecera },
    lineas: [linea(1), linea(2), linea(3)],
    metadatos: { totalPaginas: 2, paginasProcesadas: [1, 2], documentoCompleto: true, advertencias: [], confianzaGlobal: null },
  } as unknown as FacturaExtraccionPayload;
}

function extraccionRow(over: Partial<ExtraccionRow> = {}, resultado: unknown = payload()): ExtraccionRow {
  return { id: EXT, solicitudId: 's0000000-0000-4000-8000-000000000001', estado: 'completado', facturaVersion: 3, documentoSha256: SHA, resultado, errorCodigo: null, iniciadoEn: '2026-10-23T10:00:00Z', ...over };
}

const PRODUCTOS = [
  { codigo_interno: '00123', descripcion: 'Articulo 1', codigo_barras: null, existencia: 0, costo: 1, precio_venta: 2, es_placeholder: false },
  { codigo_interno: 'AB-9', descripcion: 'Articulo 3', codigo_barras: null, existencia: 0, costo: 1, precio_venta: 2, es_placeholder: false },
];

type Mocks = { [K in keyof FacturaRevisionRepository]: jest.Mock };

function fakeRepo(over: Partial<Mocks> = {}): Mocks {
  return {
    leerRevisiones: jest.fn(async () => []),
    leerExtracciones: jest.fn(async () => []),
    guardarRevision: jest.fn(async (input: GuardarRevisionInput) => ({ revision: input.revisionEsperada + 1, fingerprint: FP, replay: false })),
    aprobarRevision: jest.fn(async (input: { revision: number; fingerprint: string }) => ({ revision: input.revision, fingerprint: input.fingerprint, replay: false })),
    extraer: jest.fn(async () => ({ tipo: 'completado', extraccionId: EXT, replay: false })),
    buscarCandidatos: jest.fn(async () => ({ productos: PRODUCTOS, parcial: false })),
    leerColisionesBarras: jest.fn(async (codes: string[]) => Object.fromEntries(codes.map(code => [code, { productos: [], completo: true }]))),
    ...over,
  } as Mocks;
}

let idCounter = 0;
const newId = () => `90000000-0000-4000-8000-${String(++idCounter).padStart(12, '0')}`;

const DOC = { path: `${OWNER_A}/${FACTURA_1}/d.pdf`, mime: 'application/pdf', sha256: SHA, nombre: 'factura.pdf' };

function props(repo: Mocks, over: Partial<FacturaRevisionViewProps> = {}): FacturaRevisionViewProps {
  return {
    facturaId: FACTURA_1,
    ownerId: OWNER_A,
    facturaVersion: 3,
    documento: DOC,
    editorDirty: false,
    repository: repo as unknown as FacturaRevisionRepository,
    getSessionUid: () => OWNER_A,
    newId,
    ...over,
  };
}

async function openView(repo: Mocks, over: Partial<FacturaRevisionViewProps> = {}) {
  const view = renderWithProviders(<FacturaRevisionView {...props(repo, over)} />);
  await settle();
  return view;
}

const byId = (id: string) => screen.getByTestId(id);
const maybeId = (id: string) => screen.queryByTestId(id);
const textOf = (id: string): string => {
  const node = byId(id);
  const parts: string[] = [];
  const walk = (value: unknown) => {
    if (typeof value === 'string') parts.push(value);
    else if (Array.isArray(value)) value.forEach(walk);
    else if (value && typeof value === 'object') walk((value as { children?: unknown }).children);
  };
  walk(node.children);
  return parts.join('');
};
const isDisabled = (id: string): boolean => Boolean(byId(id).props.accessibilityState?.disabled);

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

/** Opens a revision from a completed extraction through the explicit button. */
async function startRevision(repo: Mocks, over: Partial<FacturaRevisionViewProps> = {}) {
  repo.leerExtracciones.mockResolvedValue([extraccionRow()]);
  const view = await openView(repo, over);
  await pressId(`revision-iniciar-${EXT}`);
  return view;
}

async function confirmEverything(): Promise<void> {
  await pressId('revision-decision-documentoCompletoConfirmado-si');
  await pressId('revision-decision-recepcionCompleta-si');
  await pressId('revision-decision-precioIncluyeIva-no');
  for (const n of [1, 2, 3]) {
    await typeId(`revision-linea-${n}-factor-valor`, '1');
    await pressId(`revision-linea-${n}-factor-aplicar`);
    await typeId(`revision-linea-${n}-manual-codigo`, `SKU-${n}`);
    await typeId(`revision-linea-${n}-manual-motivo`, 'Mismo articulo');
    await pressId(`revision-linea-${n}-manual-aplicar`);
  }
}

/** A saved revision (as the server would return it) built with the real domain helpers. */
function savedRevision(over: Partial<RevisionRow> = {}, edit: (contenido: RevisionContenido) => RevisionContenido = c => c): RevisionRow {
  const base = crearRevisionDesdeExtraccion(payload(), EXT, newId);
  if (!base.ok) throw new Error('fixture');
  return { revision: 1, clave: 'c0000000-0000-4000-8000-0000000000aa', facturaVersion: 3, extraccionId: EXT, documentoSha256: SHA, contenido: edit(base.contenido), fingerprint: FP, motivo: null, creadoPor: OWNER_A, aprobadoPor: null, aprobadoEn: null, ...over };
}

describe('availability and manual fallback', () => {
  it('shows an unavailable notice when the backend relation is missing and keeps the screen usable', async () => {
    const repo = fakeRepo({ leerRevisiones: jest.fn(async () => { throw new RevisionRepositoryError('no_disponible'); }) });
    await openView(repo);
    expect(await screen.findByText(/todavía no está disponible/)).toBeTruthy();
    expect(screen.getByText(/factura manual sigue funcionando/)).toBeTruthy();
    expect(repo.extraer).not.toHaveBeenCalled();
  });

  it('shows a retryable error for unexpected read failures without inventing data', async () => {
    const repo = fakeRepo({ leerRevisiones: jest.fn(async () => { throw new RevisionRepositoryError('desconocido'); }) });
    await openView(repo);
    expect(await screen.findByTestId('revision-error')).toBeTruthy();
    expect(maybeId('revision-guardar')).toBeNull();
  });
});

describe('Extraer datos: explicit, guarded, never repeated', () => {
  it.each([
    ['no saved document', { documento: null }, 'Adjunta y guarda un documento'],
    ['invoice not saved yet', { facturaVersion: 0 }, 'Guarda la factura'],
    ['unsaved manual edits', { editorDirty: true }, 'Guarda los cambios'],
  ])('is disabled with %s and never calls the function', async (_name, over, hint) => {
    const repo = fakeRepo();
    await openView(repo, over as Partial<FacturaRevisionViewProps>);
    expect(isDisabled('revision-extraer')).toBe(true);
    expect(screen.getByText(new RegExp(hint))).toBeTruthy();
    await pressId('revision-extraer');
    expect(repo.extraer).not.toHaveBeenCalled();
  });

  it('is disabled when the session is not the invoice owner', async () => {
    const repo = fakeRepo();
    await openView(repo, { getSessionUid: () => OWNER_B });
    expect(isDisabled('revision-extraer')).toBe(true);
    expect(repo.leerRevisiones).not.toHaveBeenCalled();
  });

  it('calls the function once with the saved version, then rereads the attempts', async () => {
    const repo = fakeRepo();
    repo.leerExtracciones.mockResolvedValueOnce([]).mockResolvedValue([extraccionRow()]);
    await openView(repo);
    await pressId('revision-extraer');
    expect(repo.extraer).toHaveBeenCalledTimes(1);
    expect(repo.extraer).toHaveBeenCalledWith(expect.objectContaining({ facturaId: FACTURA_1, versionEsperada: 3, solicitudId: expect.any(String) }));
    expect(repo.leerExtracciones.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(await screen.findByTestId(`revision-iniciar-${EXT}`)).toBeTruthy();
  });

  it.each([
    ['a 409 busy answer', { tipo: 'en_curso' }, /en curso/],
    ['an uncertain outcome', { tipo: 'incierto' }, /No se pudo confirmar/],
  ])('rereads and never reinvokes after %s', async (_name, answer, notice) => {
    const repo = fakeRepo({ extraer: jest.fn(async () => answer) });
    await openView(repo);
    const reads = repo.leerExtracciones.mock.calls.length;
    await pressId('revision-extraer');
    expect(await screen.findByText(notice)).toBeTruthy();
    expect(repo.leerExtracciones.mock.calls.length).toBeGreaterThan(reads);
    expect(repo.extraer).toHaveBeenCalledTimes(1);
    await settle();
    expect(repo.extraer).toHaveBeenCalledTimes(1);
  });

  it('shows the permission message when the server refuses and does not retry', async () => {
    const repo = fakeRepo({ extraer: jest.fn(async () => ({ tipo: 'rechazado', codigo: 'no_autorizado' })) });
    await openView(repo);
    await pressId('revision-extraer');
    expect(await screen.findByText(/No tienes permiso/)).toBeTruthy();
    expect(repo.extraer).toHaveBeenCalledTimes(1);
  });

  it('maps a missing deployment to the unavailable fallback', async () => {
    const repo = fakeRepo({ extraer: jest.fn(async () => ({ tipo: 'no_disponible' })) });
    await openView(repo);
    await pressId('revision-extraer');
    expect(await screen.findByText(/todavía no está disponible/)).toBeTruthy();
  });

  it('a second tap while the call is pending does not start another paid call', async () => {
    let release: (value: unknown) => void = () => undefined;
    const repo = fakeRepo({ extraer: jest.fn(() => new Promise(resolve => { release = resolve; })) });
    await openView(repo);
    await pressId('revision-extraer');
    expect(isDisabled('revision-extraer')).toBe(true);
    await pressId('revision-extraer');
    expect(repo.extraer).toHaveBeenCalledTimes(1);
    await act(async () => release({ tipo: 'completado', extraccionId: EXT, replay: false }));
  });
});

describe('review from an extraction', () => {
  it('shows every repeated supplier code as its own line with literal code, page, OCR confidence and the untouched original', async () => {
    const repo = fakeRepo();
    await startRevision(repo);
    expect(byId('revision-linea-1')).toBeTruthy();
    expect(byId('revision-linea-2')).toBeTruthy();
    expect(textOf('revision-linea-1-codigo')).toBe('00123');
    expect(textOf('revision-linea-2-codigo')).toBe('00123');
    expect(textOf('revision-linea-3-codigo')).toBe('AB-9');
    expect(textOf('revision-linea-1-pagina')).toContain('2');
    expect(textOf('revision-linea-1-ocr')).toContain('55');
    expect(textOf('revision-linea-1-cantidad-original')).toContain('10');
    expect(textOf('revision-linea-2-cantidad-original')).toContain('5');
  });

  it('keeps OCR confidence separate from the association decision, which starts pending (never new)', async () => {
    const repo = fakeRepo();
    await startRevision(repo);
    expect(textOf('revision-linea-1-decision')).toMatch(/Sin decidir/);
    expect(textOf('revision-linea-1-decision')).not.toMatch(/nuevo/i);
    expect(textOf('revision-linea-1-ocr')).not.toMatch(/Sin decidir/);
  });

  it('offers explicit candidates from the bounded catalog and confirms one only on press', async () => {
    const repo = fakeRepo();
    await startRevision(repo);
    expect(repo.buscarCandidatos).toHaveBeenCalledTimes(1);
    expect(await screen.findByTestId('revision-linea-1-candidato-00123')).toBeTruthy();
    expect(textOf('revision-linea-1-decision')).toMatch(/Sin decidir/);
    await pressId('revision-linea-1-candidato-00123');
    expect(textOf('revision-linea-1-decision')).toMatch(/00123/);
    expect(textOf('revision-linea-1-decision')).toMatch(/sugerencia/i);
  });

  it('keeps a line without candidates unresolved and says why, never as a new product', async () => {
    const repo = fakeRepo({ buscarCandidatos: jest.fn(async () => ({ productos: [], parcial: false })) });
    await startRevision(repo);
    expect(await screen.findByTestId('revision-linea-3-sin-candidatos')).toBeTruthy();
    expect(textOf('revision-linea-3-decision')).toMatch(/Sin decidir/);
  });

  it('reports a partial catalog as unknown instead of implying there is no product', async () => {
    const repo = fakeRepo({ buscarCandidatos: jest.fn(async () => ({ productos: [], parcial: true })) });
    await startRevision(repo);
    expect(await screen.findByText(/catálogo.*parcial|parcial.*catálogo/i)).toBeTruthy();
  });

  it('records a new-product intention only with an explicit motive and creates nothing', async () => {
    const repo = fakeRepo();
    await startRevision(repo);
    expect(isDisabled('revision-linea-3-nuevo-aplicar')).toBe(true);
    await typeId('revision-linea-3-nuevo-motivo', 'No existe en el catalogo completo');
    expect(isDisabled('revision-linea-3-nuevo-aplicar')).toBe(false);
    await pressId('revision-linea-3-nuevo-aplicar');
    expect(textOf('revision-linea-3-decision')).toMatch(/Producto nuevo/);
    expect(textOf('revision-linea-3-decision')).toMatch(/sin crear/i);
    expect(repo.guardarRevision).not.toHaveBeenCalled();
  });

  it('applies a motivated scalar correction, showing original, corrected and normalized values', async () => {
    const repo = fakeRepo();
    await startRevision(repo);
    expect(isDisabled('revision-linea-1-cantidad-aplicar')).toBe(true);
    await typeId('revision-linea-1-cantidad-valor', '12');
    expect(isDisabled('revision-linea-1-cantidad-aplicar')).toBe(true);
    await typeId('revision-linea-1-cantidad-motivo', 'Cantidad ilegible');
    await pressId('revision-linea-1-cantidad-aplicar');
    expect(textOf('revision-linea-1-cantidad-original')).toContain('10');
    expect(textOf('revision-linea-1-cantidad-corregido')).toContain('12');
    expect(textOf('revision-linea-1-cantidad-motivo-aplicado')).toContain('Cantidad ilegible');
    await pressId('revision-linea-1-cantidad-revertir');
    expect(maybeId('revision-linea-1-cantidad-corregido')).toBeNull();
  });

  it('edits ordered discounts with typed rows, motive and exact results', async () => {
    const repo = fakeRepo();
    await startRevision(repo);
    await pressId('revision-linea-1-descuentos-agregar');
    await typeId('revision-linea-1-descuentos-0-porcentaje', '20');
    await pressId('revision-linea-1-descuentos-0-alcance-renglon');
    await pressId('revision-linea-1-descuentos-0-incluido-no');
    await pressId('revision-linea-1-descuentos-agregar');
    await typeId('revision-linea-1-descuentos-1-porcentaje', '5');
    await pressId('revision-linea-1-descuentos-1-alcance-renglon');
    await pressId('revision-linea-1-descuentos-1-incluido-no');
    expect(isDisabled('revision-linea-1-descuentos-aplicar')).toBe(true);
    await typeId('revision-linea-1-descuentos-motivo', 'Descuentos impresos al pie');
    await pressId('revision-linea-1-descuentos-aplicar');
    expect(textOf('revision-linea-1-importe-final')).toContain('6.08');
  });

  it('supports an explicit empty discount list that clears a wrong extraction', async () => {
    const repo = fakeRepo();
    repo.leerExtracciones.mockResolvedValue([extraccionRow({}, { ...payload(), lineas: [linea(1, { descuentos: [{ orden: 1, porcentaje: '50', monto: null, alcance: 'renglon', incluidoEnPrecio: false }] }), linea(2), linea(3)] })]);
    await openView(repo);
    await pressId(`revision-iniciar-${EXT}`);
    expect(textOf('revision-linea-1-importe-final')).toContain('4.00');
    await pressId('revision-linea-1-descuentos-0-quitar');
    await typeId('revision-linea-1-descuentos-motivo', 'La extraccion invento un descuento');
    await pressId('revision-linea-1-descuentos-aplicar');
    expect(textOf('revision-linea-1-importe-final')).toContain('8.00');
  });

  it('edits header tax rows and shows them against the calculated per-rate bases', async () => {
    const repo = fakeRepo();
    await startRevision(repo);
    await pressId('revision-cabecera-impuestos-agregar');
    await typeId('revision-cabecera-impuestos-0-tasa', '16');
    await typeId('revision-cabecera-impuestos-0-base', '19.00');
    await typeId('revision-cabecera-impuestos-0-monto', '3.04');
    await pressId('revision-cabecera-impuestos-0-exento-no');
    await typeId('revision-cabecera-impuestos-motivo', 'Resumen impreso de IVA');
    await pressId('revision-cabecera-impuestos-aplicar');
    await confirmEverything();
    expect(textOf('revision-diferencias')).toContain('impuestos[0].base');
  });
});

describe('calculation, blockers and approval', () => {
  it('blocks a fresh review with every missing confirmation spelled out and never shows it as valid', async () => {
    const repo = fakeRepo();
    await startRevision(repo);
    const blockers = textOf('revision-bloqueos');
    expect(blockers).toMatch(/completitud/i);
    expect(blockers).toMatch(/recepción/i);
    expect(blockers).toMatch(/IVA/);
    expect(textOf('revision-estado')).toBe('Con bloqueos');
    expect(isDisabled('revision-aprobar')).toBe(true);
  });

  it('shows exact USD lines, per-rate totals and unit costs for a complete review', async () => {
    const repo = fakeRepo();
    await startRevision(repo);
    await confirmEverything();
    expect(textOf('revision-bloqueos')).toMatch(/Sin bloqueos/);
    expect(textOf('revision-linea-1-costo-unitario')).toContain('$0.80');
    expect(textOf('revision-linea-3-importe-final')).toContain('$6.20');
    expect(textOf('revision-totales')).toContain('$18.95');
    expect(textOf('revision-totales')).toContain('$21.982');
    expect(textOf('revision-por-tasa')).toContain('16');
    expect(textOf('revision-pos')).toMatch(/no verificad/i);
  });

  it('blocks a non-USD document without converting or fetching rates', async () => {
    const repo = fakeRepo();
    repo.leerExtracciones.mockResolvedValue([extraccionRow({}, payload({ moneda: 'VES', tasaCambio: '36.5' }))]);
    await openView(repo);
    await pressId(`revision-iniciar-${EXT}`);
    await confirmEverything();
    expect(textOf('revision-bloqueos')).toMatch(/no es USD/);
    expect(textOf('revision-estado')).toBe('Con bloqueos');
    expect(isDisabled('revision-aprobar')).toBe(true);
  });

  it('shows an inexact included-VAT division as a blocker instead of rounding it', async () => {
    const repo = fakeRepo();
    await startRevision(repo);
    await confirmEverything();
    await pressId('revision-decision-precioIncluyeIva-si');
    expect(textOf('revision-bloqueos')).toMatch(/división.*exacta|no es exacta/i);
    expect(textOf('revision-totales')).toMatch(/desconocido/i);
  });

  it('saves the complete review, then attests it explicitly: Validada only after both', async () => {
    const repo = fakeRepo();
    await startRevision(repo);
    await confirmEverything();
    expect(isDisabled('revision-aprobar')).toBe(true);
    await typeId('revision-motivo-guardado', 'Primera revision completa');
    await pressId('revision-guardar');

    expect(repo.guardarRevision).toHaveBeenCalledTimes(1);
    const saved = repo.guardarRevision.mock.calls[0][0] as GuardarRevisionInput;
    expect(saved).toMatchObject({ facturaId: FACTURA_1, revisionEsperada: 0, facturaVersion: 3, extraccionId: EXT, motivo: 'Primera revision completa' });
    expect(saved.clave).toEqual(expect.any(String));
    expect(saved.contenido.lineas).toHaveLength(3);
    expect(textOf('revision-estado')).toBe('Pendiente de aprobación');
    expect(repo.aprobarRevision).not.toHaveBeenCalled();

    await pressId('revision-aprobar');
    expect(repo.aprobarRevision).toHaveBeenCalledWith({ facturaId: FACTURA_1, revision: 1, fingerprint: FP, facturaVersion: 3 });
    expect(textOf('revision-estado')).toBe('Validada');
    expect(screen.getByText(/no autoriza compras|no es autoridad de compra/i)).toBeTruthy();
  });

  it('a no-op does not create a revision', async () => {
    const repo = fakeRepo();
    repo.leerRevisiones.mockResolvedValue([savedRevision()]);
    repo.leerExtracciones.mockResolvedValue([extraccionRow()]);
    await openView(repo);
    expect(isDisabled('revision-guardar')).toBe(true);
    await pressId('revision-guardar');
    expect(repo.guardarRevision).not.toHaveBeenCalled();
    await typeId('revision-linea-1-unidad-valor', 'UND');
    await typeId('revision-linea-1-unidad-motivo', 'sin cambio real');
    await pressId('revision-linea-1-unidad-aplicar');
    expect(isDisabled('revision-guardar')).toBe(true);
  });
});

describe('persistence, retry and conflicts', () => {
  it('retries an uncertain save with the identical key and payload, and uses a new key after an edit', async () => {
    const repo = fakeRepo();
    repo.guardarRevision
      .mockRejectedValueOnce(new RevisionRepositoryError('red'))
      .mockImplementation(async (input: GuardarRevisionInput) => ({ revision: input.revisionEsperada + 1, fingerprint: FP, replay: true }));
    await startRevision(repo);
    await confirmEverything();
    await pressId('revision-guardar');
    expect(await screen.findByText(/Sin conexión/)).toBeTruthy();
    await pressId('revision-guardar');
    const [first, second] = repo.guardarRevision.mock.calls.map(call => call[0] as GuardarRevisionInput);
    expect(second.clave).toBe(first.clave);
    expect(second.contenido).toEqual(first.contenido);
    expect(second.revisionEsperada).toBe(first.revisionEsperada);

    await typeId('revision-linea-1-cantidad-valor', '11');
    await typeId('revision-linea-1-cantidad-motivo', 'Correccion posterior');
    await pressId('revision-linea-1-cantidad-aplicar');
    await pressId('revision-guardar');
    const third = repo.guardarRevision.mock.calls[2][0] as GuardarRevisionInput;
    expect(third.clave).not.toBe(first.clave);
    expect(third.revisionEsperada).toBe(1);
  });

  it('saves revision N+1 from the edited latest revision, never resetting it', async () => {
    const repo = fakeRepo();
    repo.leerRevisiones.mockResolvedValue([savedRevision({}, c => aplicarEdicion(c, payload(), { tipo: 'linea_escalar', lineaId: c.lineas[0].lineaId, campo: 'cantidad', valor: '12', motivo: 'Cantidad ilegible' }).ok ? (aplicarEdicion(c, payload(), { tipo: 'linea_escalar', lineaId: c.lineas[0].lineaId, campo: 'cantidad', valor: '12', motivo: 'Cantidad ilegible' }) as { contenido: RevisionContenido }).contenido : c)]);
    repo.leerExtracciones.mockResolvedValue([extraccionRow()]);
    await openView(repo);
    expect(textOf('revision-linea-1-cantidad-corregido')).toContain('12');
    await typeId('revision-linea-2-cantidad-valor', '6');
    await typeId('revision-linea-2-cantidad-motivo', 'Segunda correccion');
    await pressId('revision-linea-2-cantidad-aplicar');
    await pressId('revision-guardar');
    const call = repo.guardarRevision.mock.calls[0][0] as GuardarRevisionInput;
    expect(call.revisionEsperada).toBe(1);
    expect(call.contenido.lineas[0].correcciones.cantidad?.valor).toBe('12');
    expect(call.contenido.lineas[1].correcciones.cantidad?.valor).toBe('6');
  });

  it('keeps unsaved edits and offers an explicit reload on a stale-revision conflict', async () => {
    const repo = fakeRepo();
    repo.guardarRevision.mockRejectedValue(new RevisionRepositoryError('revision_obsoleta'));
    await startRevision(repo);
    await typeId('revision-linea-1-cantidad-valor', '12');
    await typeId('revision-linea-1-cantidad-motivo', 'Cantidad ilegible');
    await pressId('revision-linea-1-cantidad-aplicar');
    await pressId('revision-guardar');
    expect(await screen.findByText(/revisión más reciente/)).toBeTruthy();
    expect(textOf('revision-linea-1-cantidad-corregido')).toContain('12');
    expect(byId('revision-recargar')).toBeTruthy();
    expect(repo.guardarRevision).toHaveBeenCalledTimes(1);
  });

  it('reopening resumes the saved latest revision without any extra click', async () => {
    const repo = fakeRepo();
    repo.leerRevisiones.mockResolvedValue([savedRevision()]);
    repo.leerExtracciones.mockResolvedValue([extraccionRow()]);
    await openView(repo);
    expect(byId('revision-linea-1')).toBeTruthy();
    expect(maybeId(`revision-iniciar-${EXT}`)).toBeNull();
    expect(textOf('revision-estado')).toBe('Con bloqueos');
    // Saved and unchanged, but the fresh calculation still has blockers: no attestation.
    expect(isDisabled('revision-guardar')).toBe(true);
    expect(isDisabled('revision-aprobar')).toBe(true);
    await pressId('revision-aprobar');
    expect(repo.aprobarRevision).not.toHaveBeenCalled();
  });

  it('reports unsaved changes to the parent so a close guard can protect them', async () => {
    const onDirtyChange = jest.fn();
    const repo = fakeRepo();
    await startRevision(repo, { onDirtyChange });
    expect(onDirtyChange).toHaveBeenLastCalledWith(true);
  });

  it('replacing reviewed work with another extraction needs a motive and never silently clobbers edits', async () => {
    const repo = fakeRepo();
    repo.leerRevisiones.mockResolvedValue([savedRevision()]);
    repo.leerExtracciones.mockResolvedValue([extraccionRow(), extraccionRow({ id: EXT_2, iniciadoEn: '2026-10-23T11:00:00Z' })]);
    await openView(repo);
    expect(isDisabled(`revision-aplicar-${EXT_2}`)).toBe(true);
    await typeId('revision-reemplazo-motivo', 'La segunda lectura es mejor');
    expect(isDisabled(`revision-aplicar-${EXT_2}`)).toBe(false);
    await pressId(`revision-aplicar-${EXT_2}`);
    await pressId('revision-guardar');
    expect(repo.guardarRevision).toHaveBeenCalledTimes(1);
    expect(repo.guardarRevision.mock.calls[0][0]).toMatchObject({ extraccionId: EXT_2, motivo: 'La segunda lectura es mejor', revisionEsperada: 1 });
  });

  it('reuses the historical source IDs when the same extraction is applied again after a detach (A / detach / A)', async () => {
    const first = savedRevision({ revision: 1 });
    const firstIds = (first.contenido as RevisionContenido).lineas.map(l => l.lineaId);
    const detached = savedRevision({ revision: 2, extraccionId: null, contenido: { review_schema: 1, calculo_version: 'calc-v1', matching_version: 'matching-v1', extraccion_id: null, cabecera: { correcciones: {}, tasaConfirmada: null, precioIncluyeIva: null, recepcionCompleta: null, documentoCompletoConfirmado: null }, lineas: [] } as RevisionContenido });
    const repo = fakeRepo();
    repo.leerRevisiones.mockResolvedValue([first, detached]);
    repo.leerExtracciones.mockResolvedValue([extraccionRow()]);
    await openView(repo);
    await typeId('revision-reemplazo-motivo', 'Reaplicar la extraccion');
    await pressId(`revision-aplicar-${EXT}`);
    await pressId('revision-guardar');
    const sent = repo.guardarRevision.mock.calls[0][0] as GuardarRevisionInput;
    expect(sent.contenido.lineas.map(l => l.lineaId)).toEqual(firstIds);
    expect(sent.revisionEsperada).toBe(2);
  });
});

describe('identity fences and stale approval', () => {
  it('discards a save result that arrives after the session changed', async () => {
    let release: (value: unknown) => void = () => undefined;
    const repo = fakeRepo({ guardarRevision: jest.fn(() => new Promise(resolve => { release = resolve; })) });
    let uid: string | null = OWNER_A;
    await startRevision(repo, { getSessionUid: () => uid });
    await confirmEverything();
    await pressId('revision-guardar');
    uid = null;
    await act(async () => release({ revision: 1, fingerprint: FP, replay: false }));
    await settle();
    expect(textOf('revision-estado')).not.toBe('Pendiente de aprobación');
    expect(repo.aprobarRevision).not.toHaveBeenCalled();
  });

  it('ignores a load that resolves after the invoice version changed', async () => {
    let release: (value: RevisionRow[]) => void = () => undefined;
    const repo = fakeRepo({ leerRevisiones: jest.fn(() => new Promise<RevisionRow[]>(resolve => { release = resolve; })) });
    repo.leerExtracciones.mockResolvedValue([extraccionRow()]);
    const view = renderWithProviders(<FacturaRevisionView {...props(repo)} />);
    await settle();
    view.rerenderUi(<FacturaRevisionView {...props(repo, { facturaVersion: 4 })} />);
    await settle();
    await act(async () => release([savedRevision()]));
    await settle();
    expect(repo.leerRevisiones.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it('never renders a stale attestation as valid after the invoice version moved', async () => {
    const repo = fakeRepo();
    repo.leerRevisiones.mockResolvedValue([savedRevision({ aprobadoPor: OWNER_A, aprobadoEn: '2026-10-23T12:00:00Z' })]);
    repo.leerExtracciones.mockResolvedValue([extraccionRow()]);
    await openView(repo, { facturaVersion: 4 });
    expect(textOf('revision-estado')).toBe('Aprobación desactualizada');
    expect(isDisabled('revision-aprobar')).toBe(true);
  });

  it('never renders a stale attestation as valid after the document was replaced', async () => {
    const repo = fakeRepo();
    repo.leerRevisiones.mockResolvedValue([savedRevision({ aprobadoPor: OWNER_A, aprobadoEn: '2026-10-23T12:00:00Z' })]);
    repo.leerExtracciones.mockResolvedValue([extraccionRow()]);
    await openView(repo, { documento: { ...DOC, sha256: 'b'.repeat(64) } });
    expect(textOf('revision-estado')).toBe('Aprobación desactualizada');
  });

  it('does not offer attestation while manual editor changes are unsaved', async () => {
    const repo = fakeRepo();
    repo.leerRevisiones.mockResolvedValue([savedRevision()]);
    repo.leerExtracciones.mockResolvedValue([extraccionRow()]);
    await openView(repo, { editorDirty: true });
    expect(isDisabled('revision-aprobar')).toBe(true);
  });
});

describe('barcode intent', () => {
  async function withBarcodeIntent(repo: Mocks) {
    await startRevision(repo);
    await confirmEverything();
    await pressId('revision-linea-1-barras-usar');
  }

  it('reads exact collisions and treats an unknown or partial answer as unverified', async () => {
    const repo = fakeRepo({ leerColisionesBarras: jest.fn(async (codes: string[]) => Object.fromEntries(codes.map(code => [code, { productos: [], completo: false }]))) });
    await withBarcodeIntent(repo);
    expect(repo.leerColisionesBarras).toHaveBeenCalledWith(['00123']);
    expect(textOf('revision-linea-1-barras-estado')).toMatch(/no verificad/i);
    expect(textOf('revision-bloqueos')).toMatch(/código de barras/i);
  });

  it('shows a collision with another product and blocks', async () => {
    const repo = fakeRepo({ leerColisionesBarras: jest.fn(async () => ({ '00123': { productos: [{ codigoInterno: 'OTRO', codigoBarras: '00123' }], completo: true } })) });
    await withBarcodeIntent(repo);
    expect(textOf('revision-linea-1-barras-estado')).toMatch(/colisi/i);
  });

  it('accepts a complete, exact, collision-free check', async () => {
    const repo = fakeRepo();
    await withBarcodeIntent(repo);
    expect(textOf('revision-linea-1-barras-estado')).toMatch(/único/i);
    expect(textOf('revision-bloqueos')).toMatch(/Sin bloqueos/);
  });

  it('proposes the literal printed code, never an invented one', async () => {
    const repo = fakeRepo();
    await withBarcodeIntent(repo);
    expect(textOf('revision-linea-1-barras-codigo')).toBe('00123');
  });
});

describe('no side effects beyond the review contract', () => {
  it('only touches the repository methods of this contract', async () => {
    const repo = fakeRepo();
    await startRevision(repo);
    await confirmEverything();
    await pressId('revision-guardar');
    await pressId('revision-aprobar');
    expect(Object.keys(repo).sort()).toEqual(['aprobarRevision', 'buscarCandidatos', 'extraer', 'guardarRevision', 'leerColisionesBarras', 'leerExtracciones', 'leerRevisiones']);
    expect(repo.extraer).not.toHaveBeenCalled();
    expect(within(screen.getByTestId('revision-estado')).queryByText(/compra emitida/i)).toBeNull();
  });
});
