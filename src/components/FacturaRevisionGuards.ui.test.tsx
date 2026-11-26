import * as React from 'react';
import { act, fireEvent, screen } from '@testing-library/react-native';
import FacturaRevisionView, { type EtapaRevision, type FacturaRevisionViewProps } from './FacturaRevisionView';
import { MATCHING_NORMALIZATION_VERSION } from '../lib/facturaMatching';
import {
  createFacturaRevisionRepository,
  FACTURA_ACTUAL_SUPPLIER_SCOPE,
  type ExtraccionRow,
  type FacturaRevisionRepository,
  type GuardarRevisionInput,
  type RevisionClient,
  type RevisionRow,
} from '../lib/facturaRevisionRepository';
import { aplicarEdicion, crearRevisionDesdeExtraccion, type RevisionContenido } from '../lib/facturaRevision';
import type { FacturaExtraccionPayload } from '../lib/facturaExtractionContract';
import { useFacturaRevision, type FacturaRevisionControl, type UseFacturaRevisionParams } from '../hooks/useFacturaRevision';
import { OWNER_A, OWNER_B, FACTURA_1, deferred, renderWithProviders, settle } from '../test-utils/facturaUiHarness';

// Permanent guards for the identity, proof and presentation invariants the independent T4 verification
// reproduced (B1 barcode proof, B2 matching generations, B3 currency labelling, B4 omitted lines,
// B5 lifecycle generations, A1 session eligibility). The mocked session is NOT production proof.

jest.mock('../lib/supabase', () => ({ supabase: {} }));
jest.mock('./BarcodeScannerModal', () => ({ BarcodeScannerModal: ({ visible, onScan, onClose }: any) => visible ? require('react').createElement(require('react-native').View, null, require('react').createElement(require('react-native').Text, { testID: 'scanner-mock-capture', onPress: () => onScan('000123-ABC') }, 'Capture'), require('react').createElement(require('react-native').Text, { testID: 'scanner-mock-close', onPress: onClose }, 'Close')) : null }));
jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: require('../test-utils/facturaUiHarness').asyncStorage,
}));

const SHA = 'a'.repeat(64);

describe('saved feedback suggestions', () => {
  it('invalidates the barcode capture epoch immediately when a revision reload starts', async () => {
    const repo = fakeRepo();
    await startHook(repo);
    const before = current.contextoActual();
    const late = deferred<RevisionRow[]>();
    repo.leerRevisiones.mockReturnValueOnce(late.promise);
    let reload: Promise<void>;
    await act(async () => {
      reload = current.recargar();
      expect(current.contextoActual()).not.toBe(before);
    });
    await act(async () => { late.resolve([]); await reload!; });
  });
  const chosen = { lineIndex: 0, decision: 'confirmado', codigoInterno: 'PAST' };
  const product = { codigo_interno: 'PAST', descripcion: 'Fijacion', codigo_barras: null, existencia: -3, costo: 1, precio_venta: 2, es_placeholder: false };
  it('passes saved choices to the real matcher without changing the human decision', async () => {
    const repo = fakeRepo({ buscarCandidatos: jest.fn(async () => ({ productos: [product], parcial: false, feedback: [chosen] })) });
    await startHook(repo);
    expect(current.candidatos[1].candidates.map(c => c.codigoInterno)).toContain('PAST');
    expect((current.candidatos[1] as any).feedback).toEqual(chosen);
    expect(current.efectiva!.lineas[0].asociacion.tipo).toBe('pendiente');
  });
  it.each(['confirmado', 'producto_nuevo'])('shows the saved %s hint without assigning a product', async decision => {
    const hint = { ...chosen, decision, codigoInterno: decision === 'confirmado' ? 'PAST' : null };
    const repo = fakeRepo({ buscarCandidatos: jest.fn(async () => ({ productos: [product], parcial: false, feedback: [hint] })) });
    await startRevision(repo);
    expect(textOf('revision-linea-1-feedback')).toMatch(decision === 'confirmado' ? /PAST/ : /nuevo/);
    expect(textOf('revision-linea-1-decision')).toMatch(/pendiente|Sin decidir/i);
  });
  it('ignores saved feedback from a previous invoice generation', async () => {
    const late = deferred<any>();
    const repo = fakeRepo({ buscarCandidatos: jest.fn().mockReturnValueOnce(late.promise).mockResolvedValue({ productos: [], parcial: false }) });
    const view = await startHook(repo);
    view.rerenderUi(<Hook {...hookProps(repo, { facturaId: FACTURA_2 })} />);
    await settle();
    await act(async () => late.resolve({ productos: [product], parcial: false, feedback: [chosen] }));
    expect(current.candidatos).toEqual({});
  });
  it('does not overwrite a manual confirmation when saved feedback arrives later', async () => {
    const late = deferred<any>();
    const repo = fakeRepo({ buscarCandidatos: jest.fn().mockReturnValueOnce(late.promise) });
    await startHook(repo);
    await edit({ tipo: 'asociacion', lineaId: current.contenido!.lineas[0].lineaId, asociacion: {
      tipo: 'confirmado', codigoInterno: 'MANUAL', evidencia: 'manual', motivo: 'Explicit current decision',
    } });
    await act(async () => late.resolve({ productos: [product], parcial: false, feedback: [chosen] }));
    await settle();
    expect(current.efectiva!.lineas[0].asociacion.codigoInterno).toBe('MANUAL');
    expect((current.candidatos[1] as any).feedback).toEqual(chosen);
  });

  const supplierAlias = {
    supplierKey: FACTURA_ACTUAL_SUPPLIER_SCOPE, keyType: 'codigo_proveedor', keyValue: '00123', unit: 'UND',
    codigoInterno: 'PAST', normalizationVersion: MATCHING_NORMALIZATION_VERSION,
  };
  const withAlias = { productos: [product], parcial: false, aliases: [supplierAlias], supplierKey: FACTURA_ACTUAL_SUPPLIER_SCOPE };
  const aliasEvidence = (n: number) =>
    current.candidatos[n]?.candidates.find(c => c.codigoInterno === 'PAST')?.evidence.some(e => e.source === 'alias') ?? false;

  it('passes a supplier alias to the real matcher as evidence without confirming the line', async () => {
    const repo = fakeRepo({ buscarCandidatos: jest.fn(async () => withAlias) });
    await startHook(repo);
    expect(repo.buscarCandidatos).toHaveBeenCalledTimes(1);
    expect(aliasEvidence(1)).toBe(true);
    expect(aliasEvidence(3)).toBe(false);
    expect(current.efectiva!.lineas[0].asociacion.tipo).toBe('pendiente');
  });

  it('shows the supplier-alias chip on that line while the decision stays pending', async () => {
    const repo = fakeRepo({ buscarCandidatos: jest.fn(async () => withAlias) });
    await startRevision(repo);
    expect(textOf('revision-linea-1-tarjeta-PAST')).toContain('Alias del proveedor');
    expect(textOf('revision-linea-1-decision')).toMatch(/pendiente|Sin decidir/i);
  });

  it('ignores an alias returned without the current-invoice supplier scope', async () => {
    const repo = fakeRepo({ buscarCandidatos: jest.fn(async () => ({ productos: [product], parcial: false, aliases: [supplierAlias] })) });
    await startHook(repo);
    expect(aliasEvidence(1)).toBe(false);
  });

  it('never applies aliases from a previous invoice or session generation', async () => {
    const late = deferred<any>();
    const repo = fakeRepo({ buscarCandidatos: jest.fn().mockReturnValueOnce(late.promise).mockResolvedValue({ productos: [], parcial: false }) });
    const view = await startHook(repo);
    view.rerenderUi(<Hook {...hookProps(repo, { facturaId: FACTURA_2 })} />);
    await settle();
    await act(async () => late.resolve(withAlias));
    expect(current.candidatos).toEqual({});
    view.unmount();

    const lateSession = deferred<any>();
    let uid = OWNER_A;
    const other = fakeRepo({ buscarCandidatos: jest.fn().mockReturnValueOnce(lateSession.promise) });
    other.leerExtracciones.mockResolvedValue([extraccionRow()]);
    await mountHook(other, { getSessionUid: () => uid });
    await act(async () => {
      expect(current.aplicarExtraccion(EXT, null).ok).toBe(true);
    });
    await settle();
    uid = OWNER_B;
    await act(async () => lateSession.resolve(withAlias));
    await settle();
    expect(aliasEvidence(1)).toBe(false);
  });
});
const EXT = 'e0000000-0000-4000-8000-000000000001';
const EXT_2 = 'e0000000-0000-4000-8000-000000000002';
const FACTURA_2 = 'f0000000-0000-4000-8000-000000000002';
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
// These guards never inspect the Hybrid impact; an empty snapshot keeps the stock read off the retrying default reader.
const sinExistencias = async () => ({});

function viewProps(repo: Mocks, over: Partial<FacturaRevisionViewProps> = {}): FacturaRevisionViewProps {
  return {
    facturaId: FACTURA_1,
    ownerId: OWNER_A,
    facturaVersion: 3,
    documento: DOC,
    editorDirty: false,
    repository: repo as unknown as FacturaRevisionRepository,
    getSessionUid: () => OWNER_A,
    newId,
    leerExistencias: sinExistencias,
    ...over,
  };
}

async function openView(repo: Mocks, over: Partial<FacturaRevisionViewProps> = {}) {
  const view = renderWithProviders(<FacturaRevisionView {...viewProps(repo, over)} />);
  await settle();
  return view;
}

// ── Navigating the guided review ────────────────────────────────────────────
// The review shows one stage at a time, one open line and collapsed disclosures. These helpers only open the stage, line
// or disclosure that holds a control (through the real buttons); every assertion still goes through the control itself.
const ETAPAS: readonly EtapaRevision[] = ['productos', 'compra'];
const CAMPOS_CABECERA_EXTRA = ['numeroControl', 'subtotal', 'total'];
const CAMPOS_LINEA_CORREGIBLES = /^(codigoProveedor|descripcion|cantidad|unidad|precioUnitario|total)-/;
const EN_FILA_O_DETALLE_ABIERTO = /^(|decision|abrir|estado|codigo)$/;
const EN_MAS_OPCIONES = /^(importe-final|base|costo-unitario|pagina|ocr|descuentos-.*|quitar|barras-(codigo|usar|estado))$/;

interface Ruta {
  etapa: EtapaRevision | null;
  /** Line whose detail must be open. */
  linea?: string;
  /** Disclosures to open, in order. */
  despliegues: string[];
}

function rutaDe(id: string): Ruta {
  const enLinea = /^revision-(linea|iva|factor)-(m?\d+)(?:-(.*))?$/.exec(id);
  if (enLinea) {
    const [, tipo, n, resto = ''] = enLinea;
    const base = `revision-linea-${n}`;
    if (tipo === 'linea' && EN_FILA_O_DETALLE_ABIERTO.test(resto)) return { etapa: 'productos', despliegues: [] };
    const despliegues: string[] = [];
    if (tipo === 'linea') {
      if (CAMPOS_LINEA_CORREGIBLES.test(resto)) despliegues.push(`${base}-corregir`);
      else if (resto.startsWith('tasaIva-')) despliegues.push(`revision-iva-${n}-otro`);
      else if (resto.startsWith('factor-')) despliegues.push(`revision-factor-${n}-otro`);
      else if (resto.startsWith('manual-')) despliegues.push(`${base}-manual-abrir`);
      else if (resto.startsWith('nuevo-')) despliegues.push(`${base}-nuevo-abrir`);
      else if (EN_MAS_OPCIONES.test(resto)) despliegues.push(`${base}-mas`);
    }
    return { etapa: 'productos', linea: n, despliegues };
  }
  const enCabecera = /^revision-cab-(\w+?)-(.*)$/.exec(id);
  if (enCabecera) {
    const campo = enCabecera[1];
    return { etapa: 'leer', despliegues: ['revision-cab-detalles', ...(CAMPOS_CABECERA_EXTRA.includes(campo) ? ['revision-cab-mas'] : []), `revision-cab-${campo}-corregir`] };
  }
  if (/^revision-agregar-/.test(id)) return { etapa: 'productos', despliegues: ['revision-agregar-abrir'] };
  if (/^revision-(extraer|iniciar-.*|aplicar-.*|reemplazo-motivo|cabecera-.*)$/.test(id)) return { etapa: 'leer', despliegues: ['revision-detalles-tecnicos'] };
  if (/^revision-(tipo-.*|decision-precioIncluyeIva-.*)$/.test(id)) return { etapa: 'productos', despliegues: ['revision-preguntas-cambiar'] };
  if (/^revision-(diferencias|pos|impacto-.*)$/.test(id)) return { etapa: 'compra', despliegues: ['revision-detalles-tecnicos'] };
  if (/^revision-(totales|por-tasa|bloqueos|guardar|aprobar|materializar|motivo-guardado|pvp-pendiente|decision-.*)$/.test(id)) return { etapa: 'compra', despliegues: [] };
  return { etapa: null, despliegues: [] };
}

function textoDe(nodo: { children?: unknown }): string {
  const parts: string[] = [];
  const walk = (value: unknown) => {
    if (typeof value === 'string') parts.push(value);
    else if (Array.isArray(value)) value.forEach(walk);
    else if (value && typeof value === 'object') walk((value as { children?: unknown }).children);
  };
  walk(nodo.children);
  return parts.join('');
}

function abrirDespliegue(id: string): void {
  const nodo = screen.queryByTestId(id);
  if (nodo && nodo.props.accessibilityState?.expanded === false) fireEvent.press(nodo);
}

function irAEtapa(destino: EtapaRevision): void {
  if (destino === 'leer') destino = 'productos';
  for (let paso = 0; paso < ETAPAS.length; paso++) {
    const actual = ETAPAS.find(etapa => screen.queryByTestId(`revision-etapa-${etapa}`));
    if (!actual || actual === destino) return;
    const adelante = ETAPAS.indexOf(destino) > ETAPAS.indexOf(actual);
    const boton = screen.queryByTestId(adelante ? 'revision-ir-compra' : 'revision-volver');
    // Forward, the primary action only navigates when it says so: elsewhere it would read, save or approve.
    if (!boton || (adelante && !/^Ir a Compra/.test(textoDe(boton)))) return;
    fireEvent.press(boton);
  }
}

function visitar(id: string): void {
  const ruta = rutaDe(id);
  if (ruta.etapa) irAEtapa(ruta.etapa);
  if (ruta.linea !== undefined && id !== `revision-linea-${ruta.linea}-abrir`) abrirDespliegue(`revision-linea-${ruta.linea}-abrir`);
  for (const despliegue of ruta.despliegues) if (despliegue !== id) abrirDespliegue(despliegue);
}

const byId = (id: string) => {
  visitar(id);
  return screen.getByTestId(id);
};
const maybeId = (id: string) => {
  visitar(id);
  return screen.queryByTestId(id);
};
const textOf = (id: string): string => textoDe(byId(id));
const isDisabled = (id: string): boolean => Boolean(byId(id).props.accessibilityState?.disabled);
/** The footer holds one action: a control that is not the current action does not exist, which is as unavailable as disabled. */
const noSePuede = (id: string): boolean => {
  const nodo = maybeId(id);
  return nodo === null || Boolean(nodo.props.accessibilityState?.disabled);
};

async function pressId(id: string): Promise<void> {
  // Navigate first, outside the act below: its state updates only flush once that act ends.
  visitar(id);
  await act(async () => {
    fireEvent.press(screen.getByTestId(id));
  });
  await settle();
}

/** Presses a control only if it exists: a footer action that is not the current one is simply not there. */
async function intentar(id: string): Promise<void> {
  if (maybeId(id)) await pressId(id);
}

async function typeId(id: string, text: string): Promise<void> {
  visitar(id);
  await act(async () => {
    fireEvent.changeText(screen.getByTestId(id), text);
  });
}

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
    await typeId(`revision-linea-${n}-tasaIva-valor`, '16');
    await typeId(`revision-linea-${n}-tasaIva-motivo`, 'Manual tax decision');
    await pressId(`revision-linea-${n}-tasaIva-aplicar`);
    await typeId(`revision-linea-${n}-factor-valor`, '1');
    await pressId(`revision-linea-${n}-factor-aplicar`);
    await typeId(`revision-linea-${n}-manual-codigo`, `SKU-${n}`);
    await typeId(`revision-linea-${n}-manual-motivo`, 'Mismo articulo');
    await pressId(`revision-linea-${n}-manual-aplicar`);
  }
}

function savedRevision(over: Partial<RevisionRow> = {}, edit: (contenido: RevisionContenido) => RevisionContenido = c => c): RevisionRow {
  const base = crearRevisionDesdeExtraccion(payload(), EXT, newId);
  if (!base.ok) throw new Error('fixture');
  return { revision: 1, clave: 'c0000000-0000-4000-8000-0000000000aa', facturaVersion: 3, extraccionId: EXT, documentoSha256: SHA, contenido: edit(base.contenido), fingerprint: FP, motivo: null, creadoPor: OWNER_A, aprobadoPor: null, aprobadoEn: null, ...over };
}

// ── Public hook harness ─────────────────────────────────────────────────────

let current: FacturaRevisionControl;
function Hook(p: UseFacturaRevisionParams) {
  const control = useFacturaRevision(p);
  React.useLayoutEffect(() => {
    current = control;
  }, [control]);
  return null;
}
function hookProps(repo: Mocks, over: Partial<UseFacturaRevisionParams> = {}): UseFacturaRevisionParams {
  return { repository: repo as unknown as FacturaRevisionRepository, facturaId: FACTURA_1, ownerId: OWNER_A, facturaVersion: 3, documentoSha256: SHA, editorDirty: false, getSessionUid: () => OWNER_A, newId, leerExistencias: sinExistencias, ...over };
}
async function mountHook(repo: Mocks, over: Partial<UseFacturaRevisionParams> = {}) {
  const view = renderWithProviders(<Hook {...hookProps(repo, over)} />);
  await settle();
  return view;
}
async function edit(edicion: Parameters<FacturaRevisionControl['editar']>[0]) {
  await act(async () => {
    expect(current.editar(edicion).ok).toBe(true);
  });
  await settle();
}
async function startHook(repo: Mocks) {
  repo.leerExtracciones.mockResolvedValue([extraccionRow()]);
  const view = await mountHook(repo);
  await act(async () => {
    expect(current.aplicarExtraccion(EXT, null).ok).toBe(true);
  });
  await settle();
  return view;
}
async function fullHook() {
  for (const campo of ['documentoCompletoConfirmado', 'recepcionCompleta', 'precioIncluyeIva'] as const) {
    await edit({ tipo: 'decision_cabecera', campo, valor: campo !== 'precioIncluyeIva' });
  }
  for (const l of current.contenido!.lineas) {
    await edit({ tipo: 'linea_escalar', lineaId: l.lineaId, campo: 'tasaIva', valor: '16', motivo: 'Manual tax decision' });
    await edit({ tipo: 'factor_conversion', lineaId: l.lineaId, valor: '1' });
    await edit({ tipo: 'asociacion', lineaId: l.lineaId, asociacion: { tipo: 'confirmado', codigoInterno: 'SAME-SKU', evidencia: 'manual', motivo: 'Verified printed product' } });
  }
}
const blockerCodes = () => current.calculo!.bloqueos.map(b => b.codigo);

// ── B1: barcode proof is bound to the current code, SKU and generation ──────

describe('manual VAT authority', () => {
  it('saves an explicit zero from the existing editor and removes it only on revert', async () => {
    const repo = fakeRepo();
    await startRevision(repo);
    expect(textOf('revision-linea-1-tasaIva-original')).toContain('16');
    await typeId('revision-linea-1-tasaIva-valor', '0');
    await typeId('revision-linea-1-tasaIva-motivo', 'Sin IVA confirmado por el usuario');
    await pressId('revision-linea-1-tasaIva-aplicar');
    expect(textOf('revision-linea-1-tasaIva-corregido')).toContain('0');
    expect(textOf('revision-linea-1-tasaIva-original')).toContain('16');
    await typeId('revision-motivo-guardado', 'Manual VAT');
    await pressId('revision-guardar');
    expect(repo.guardarRevision.mock.calls[0][0].contenido.lineas[0].correcciones.tasaIva).toEqual({ valor: '0', motivo: 'Sin IVA confirmado por el usuario' });
    await pressId('revision-linea-1-tasaIva-revertir');
    expect(maybeId('revision-linea-1-tasaIva-corregido')).toBeNull();
    expect(noSePuede('revision-aprobar')).toBe(true);
  });
});

describe('B1 barcode uniqueness proof', () => {
  it('admits the proof for the current code and SKU (positive control)', async () => {
    const repo = fakeRepo();
    await startHook(repo);
    await fullHook();
    const id = current.contenido!.lineas[0].lineaId;
    await edit({ tipo: 'codigo_barras', lineaId: id, usarCodigoFactura: true });
    expect(current.estadosBarras[id]).toBe('unico_verificado');
    expect(current.calculo!.sinBloqueos).toBe(true);
  });

  it('invalidates a previously unique barcode immediately when the printed code changes', async () => {
    const next = deferred<any>();
    const repo = fakeRepo();
    repo.leerColisionesBarras.mockImplementation((codes: string[]) => (codes[0] === '00123' ? Promise.resolve({ '00123': { productos: [], completo: true } }) : next.promise));
    await startHook(repo);
    await fullHook();
    const id = current.contenido!.lineas[0].lineaId;
    await edit({ tipo: 'codigo_barras', lineaId: id, usarCodigoFactura: true });
    expect(current.calculo!.sinBloqueos).toBe(true);
    await edit({ tipo: 'linea_escalar', lineaId: id, campo: 'codigoProveedor', valor: 'COLLIDING', motivo: 'Actual printed code' });
    expect(blockerCodes()).toContain('codigo_barras_no_verificado');
    expect(current.estadosBarras[id]).toBeUndefined();
  });

  it('does not let an old barcode lookup overwrite a newer collision', async () => {
    const old = deferred<any>();
    const newer = deferred<any>();
    const repo = fakeRepo();
    repo.leerColisionesBarras.mockImplementation((codes: string[]) => (codes[0] === '00123' ? old.promise : newer.promise));
    await startHook(repo);
    await fullHook();
    const id = current.contenido!.lineas[0].lineaId;
    await edit({ tipo: 'codigo_barras', lineaId: id, usarCodigoFactura: true });
    await edit({ tipo: 'linea_escalar', lineaId: id, campo: 'codigoProveedor', valor: 'COLLIDING', motivo: 'Actual printed code' });
    await act(async () => newer.resolve({ COLLIDING: { productos: [{ codigoInterno: 'OTHER', codigoBarras: 'COLLIDING' }], completo: true } }));
    await settle();
    expect(current.calculo!.sinBloqueos).toBe(false);
    await act(async () => old.resolve({ '00123': { productos: [], completo: true } }));
    await settle();
    expect(blockerCodes()).toContain('codigo_barras_no_verificado');
    expect(current.estadosBarras[id]).toBe('colision');
  });

  it('does not carry unique barcode evidence to a different associated SKU', async () => {
    const next = deferred<any>();
    const repo = fakeRepo();
    repo.leerColisionesBarras.mockResolvedValueOnce({ '00123': { productos: [], completo: true } }).mockImplementation(() => next.promise);
    await startHook(repo);
    await fullHook();
    const id = current.contenido!.lineas[0].lineaId;
    await edit({ tipo: 'codigo_barras', lineaId: id, usarCodigoFactura: true });
    expect(current.calculo!.sinBloqueos).toBe(true);
    await edit({ tipo: 'asociacion', lineaId: id, asociacion: { tipo: 'confirmado', codigoInterno: 'DIFFERENT', evidencia: 'manual', motivo: 'Product correction' } });
    expect(blockerCodes()).toContain('codigo_barras_no_verificado');
    expect(current.estadosBarras[id]).toBeUndefined();
  });

  it('keeps capped, failed and partial lookups unknown after the proof is re-requested', async () => {
    const repo = fakeRepo({ leerColisionesBarras: jest.fn(async (codes: string[]) => Object.fromEntries(codes.map(code => [code, { productos: [], completo: false }]))) });
    await startHook(repo);
    await fullHook();
    const id = current.contenido!.lineas[0].lineaId;
    await edit({ tipo: 'codigo_barras', lineaId: id, usarCodigoFactura: true });
    expect(current.estadosBarras[id]).toBe('no_verificable');
    expect(blockerCodes()).toContain('codigo_barras_no_verificado');
    repo.leerColisionesBarras.mockRejectedValue(new Error('down'));
    await edit({ tipo: 'linea_escalar', lineaId: id, campo: 'codigoProveedor', valor: 'NEWCODE', motivo: 'Actual printed code' });
    expect(current.estadosBarras[id]).toBe('no_verificable');
  });

  it('shows the displayed status of the view only for the current code', async () => {
    const next = deferred<any>();
    const repo = fakeRepo();
    repo.leerColisionesBarras.mockImplementation((codes: string[]) => (codes[0] === '00123' ? Promise.resolve({ '00123': { productos: [], completo: true } }) : next.promise));
    await startRevision(repo);
    await confirmEverything();
    await pressId('revision-linea-1-barras-usar');
    expect(textOf('revision-linea-1-barras-estado')).toMatch(/Único verificado/);
    await typeId('revision-linea-1-codigoProveedor-valor', 'COLLIDING');
    await typeId('revision-linea-1-codigoProveedor-motivo', 'Actual printed code');
    await pressId('revision-linea-1-codigoProveedor-aplicar');
    expect(textOf('revision-linea-1-barras-estado')).not.toMatch(/Único verificado/);
    expect(textOf('revision-linea-1-barras-estado')).toMatch(/no verificad/i);
  });
});

// ── B2: matching generations ────────────────────────────────────────────────

describe('B2 matching responses', () => {
  const twoExtractions = () => [
    extraccionRow(),
    extraccionRow({ id: EXT_2 }, { ...payload(), lineas: [linea(1, { codigoProveedor: 'NEW', descripcion: 'Brand new product' })] }),
  ];
  const brandNew = { productos: [{ ...PRODUCTOS[0], codigo_interno: 'NEW', descripcion: 'Brand new product' }], parcial: false };

  it('does not let stale match results from replaced extraction A replace suggestions for B', async () => {
    const old = deferred<any>();
    const repo = fakeRepo();
    repo.leerExtracciones.mockResolvedValue(twoExtractions());
    repo.buscarCandidatos.mockReturnValueOnce(old.promise).mockResolvedValue(brandNew);
    await mountHook(repo);
    await act(async () => {
      current.aplicarExtraccion(EXT, null);
    });
    await settle();
    await act(async () => {
      current.aplicarExtraccion(EXT_2, 'Better extraction');
    });
    await settle();
    const before = JSON.stringify(current.candidatos);
    expect(before).toContain('NEW');
    await act(async () => old.resolve({ productos: PRODUCTOS, parcial: false }));
    await settle();
    expect(JSON.stringify(current.candidatos)).toBe(before);
  });

  it('does not let an A/B/A sequence admit the first A response', async () => {
    const first = deferred<any>();
    const repo = fakeRepo();
    repo.leerExtracciones.mockResolvedValue(twoExtractions());
    repo.buscarCandidatos.mockReturnValueOnce(first.promise).mockResolvedValueOnce(brandNew).mockResolvedValue({ productos: [PRODUCTOS[1]], parcial: false });
    await mountHook(repo);
    for (const [id, motivo] of [[EXT, null], [EXT_2, 'Try B'], [EXT, 'Back to A']] as const) {
      await act(async () => {
        current.aplicarExtraccion(id, motivo);
      });
      await settle();
    }
    const before = JSON.stringify(current.candidatos);
    expect(before).toContain('AB-9');
    await act(async () => first.resolve({ productos: PRODUCTOS, parcial: false }));
    await settle();
    expect(JSON.stringify(current.candidatos)).toBe(before);
  });

  it('keeps reviewed content and motives while the suggestions change', async () => {
    const repo = fakeRepo();
    repo.leerExtracciones.mockResolvedValue(twoExtractions());
    await mountHook(repo);
    await act(async () => {
      current.aplicarExtraccion(EXT, null);
    });
    await settle();
    await edit({ tipo: 'linea_escalar', lineaId: current.contenido!.lineas[0].lineaId, campo: 'cantidad', valor: '12', motivo: 'Cantidad ilegible' });
    const reviewed = JSON.stringify(current.contenido);
    await settle();
    expect(JSON.stringify(current.contenido)).toBe(reviewed);
    expect(Object.keys(current.candidatos).length).toBeGreaterThan(0);
  });
});

// ── B3: no USD labelling of unconverted amounts ─────────────────────────────

describe('B3 currency presentation', () => {
  // Every amount the extraction carries below. While the currency is not confirmed USD none may be rendered.
  const AMOUNTS = ['18.95', '21.98', '21.982', '0.80', '0.95', '3.10', '8.00', '4.75', '6.20', '3.03', '0.40', '0.05'];

  function payloadConImportes(moneda: string | null): FacturaExtraccionPayload {
    const base = payload({
      moneda,
      tasaCambio: '36.5',
      subtotal: '18.95',
      total: '21.98',
      descuentos: [{ orden: 1, porcentaje: null, monto: '0.40', alcance: 'global', incluidoEnPrecio: false }],
      impuestos: [{ tasa: '16', base: '18.95', monto: '3.03', exento: false }],
    });
    const lineaConDescuento = linea(1, { descuentos: [{ orden: 1, porcentaje: null, monto: '0.05', alcance: 'renglon', incluidoEnPrecio: false }] });
    return { ...base, lineas: [lineaConDescuento, linea(2), linea(3)] } as unknown as FacturaExtraccionPayload;
  }

  /** Strings on screen right now: text children, typed input values, accessibility labels and placeholders. */
  function cadenasDePantalla(): string[] {
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

  /** Opens every collapsed disclosure of the current view, repeating because one can reveal another. */
  function abrirDespliegues(): void {
    for (let vuelta = 0; vuelta < 6; vuelta++) {
      const cerrados = screen.queryAllByRole('button').filter(nodo => nodo.props.accessibilityState?.expanded === false && !/^revision-linea-.*-abrir$/.test(nodo.props.testID ?? ''));
      if (cerrados.length === 0) return;
      cerrados.forEach(nodo => fireEvent.press(nodo));
    }
  }

  /**
   * Everything a person can see or hear anywhere in the review: every stage, every line opened one by one, every
   * disclosure expanded. Collapsed content must not make an absence check pass by hiding what it checks.
   */
  function visibleStrings(): string[] {
    const todas: string[] = [];
    for (const etapa of ETAPAS) {
      irAEtapa(etapa);
      if (!screen.queryByTestId(`revision-etapa-${etapa}`)) continue;
      abrirDespliegues();
      todas.push(...cadenasDePantalla());
      if (etapa !== 'productos') continue;
      for (const cabeza of screen.queryAllByTestId(/^revision-linea-.*-abrir$/).map(nodo => nodo.props.testID as string)) {
        if (screen.getByTestId(cabeza).props.accessibilityState?.expanded === false) fireEvent.press(screen.getByTestId(cabeza));
        abrirDespliegues();
        todas.push(...cadenasDePantalla());
      }
    }
    return todas;
  }

  async function openNoUsd(moneda: string | null, repo: Mocks = fakeRepo()) {
    repo.leerExtracciones.mockResolvedValue([extraccionRow({}, payloadConImportes(moneda))]);
    const view = await openView(repo);
    await pressId(`revision-iniciar-${EXT}`);
    await confirmEverything();
    return view;
  }

  it.each(['VES', null])('renders no monetary amount anywhere while the currency is %s', async moneda => {
    await openNoUsd(moneda);
    const joined = visibleStrings().join('\n');
    for (const amount of AMOUNTS) expect(joined).not.toContain(amount);
    expect(joined).not.toContain('$');
    expect(joined).not.toMatch(/\(USD\)/);
    expect(textOf('revision-bloqueos')).toMatch(moneda === null ? /desconocida/ : /no es USD/);
    expect(noSePuede('revision-aprobar')).toBe(true);
    expect(textOf('revision-diferencias')).toMatch(/Importe oculto/);
    expect(textOf('revision-linea-1-precioUnitario-oculto')).toMatch(/Importe oculto/);
    expect(textOf('revision-cab-subtotal-oculto')).toMatch(/Importe oculto/);
  });

  it('control: the same traversal does reach every amount of a USD document', async () => {
    await openNoUsd('USD');
    const joined = visibleStrings().join('\n');
    for (const amount of ['18.95', '0.80', '8.00', '4.75']) expect(joined).toContain(amount);
  });

  it.each(['VES', null])('offers no monetary amount input, but keeps every other field reviewable, while the currency is %s', async moneda => {
    await openNoUsd(moneda);
    const hidden = [
      'revision-cab-subtotal-valor',
      'revision-cab-total-valor',
      'revision-cabecera-descuentos-0-monto',
      'revision-cabecera-impuestos-0-base',
      'revision-cabecera-impuestos-0-monto',
      'revision-linea-1-precioUnitario-valor',
      'revision-linea-1-total-valor',
      'revision-linea-1-descuentos-0-monto',
      'revision-agregar-precio',
    ];
    for (const id of hidden) expect(maybeId(id)).toBeNull();
    const reviewable = [
      'revision-cab-moneda-valor',
      'revision-cab-proveedorNombre-valor',
      'revision-cabecera-descuentos-0-porcentaje',
      'revision-cabecera-impuestos-0-tasa',
      'revision-linea-1-cantidad-valor',
      'revision-linea-1-unidad-valor',
      'revision-linea-1-tasaIva-valor',
      'revision-linea-1-descuentos-0-porcentaje',
      'revision-linea-1-codigoProveedor-valor',
      'revision-linea-1-descripcion-valor',
    ];
    for (const id of reviewable) expect(maybeId(id)).not.toBeNull();
  });

  it('still adds an omitted line without a price while the currency is not USD, and never invents one', async () => {
    const repo = fakeRepo();
    const saved: GuardarRevisionInput[] = [];
    repo.guardarRevision.mockImplementation(async (input: GuardarRevisionInput) => {
      saved.push(JSON.parse(JSON.stringify(input)));
      return { revision: 1, fingerprint: FP, replay: false };
    });
    await openNoUsd('VES', repo);
    expect(maybeId('revision-agregar-precio')).toBeNull();
    await typeId('revision-agregar-descripcion', 'Adhesivo omitido');
    await typeId('revision-agregar-cantidad', '2');
    await typeId('revision-agregar-motivo', 'OCR skipped this printed line');
    await pressId('revision-agregar-manual');
    expect(byId('revision-linea-m4')).toBeTruthy();
    expect(textOf('revision-linea-m4-descripcion-corregido')).toContain('Adhesivo omitido');
    await typeId('revision-motivo-guardado', 'With the omitted line');
    await pressId('revision-guardar');
    expect(saved).toHaveLength(1);
    expect(saved[0].contenido.lineas[3].correcciones.precioUnitario).toBeUndefined();
  });

  it('keeps stored amounts byte-equivalent through a save and reopen while they are hidden', async () => {
    const ext = payloadConImportes('VES');
    const base = crearRevisionDesdeExtraccion(ext, EXT, newId);
    if (!base.ok) throw new Error('fixture');
    const lineaId = base.contenido.lineas[0].lineaId;
    const conImportes = [
      { tipo: 'linea_escalar', lineaId, campo: 'precioUnitario', valor: '0.85', motivo: 'Printed price corrected' },
      { tipo: 'cabecera_escalar', campo: 'subtotal', valor: '19.00', motivo: 'Subtotal corrected' },
    ] as const;
    let contenido = base.contenido;
    for (const edicion of conImportes) {
      const r = aplicarEdicion(contenido, ext, edicion);
      if (!r.ok) throw new Error('fixture');
      contenido = r.contenido;
    }
    const repo = fakeRepo();
    const saved: GuardarRevisionInput[] = [];
    repo.guardarRevision.mockImplementation(async (input: GuardarRevisionInput) => {
      saved.push(JSON.parse(JSON.stringify(input)));
      return { revision: 2, fingerprint: FP, replay: false };
    });
    repo.leerExtracciones.mockResolvedValue([extraccionRow({}, ext)]);
    repo.leerRevisiones.mockResolvedValue([savedRevision({ contenido, fingerprint: FP })]);
    await openView(repo);

    const joined = visibleStrings().join('\n');
    for (const hiddenAmount of [...AMOUNTS, '0.85', '19.00']) expect(joined).not.toContain(hiddenAmount);

    await typeId('revision-linea-1-cantidad-valor', '12');
    await typeId('revision-linea-1-cantidad-motivo', 'Cantidad ilegible');
    await pressId('revision-linea-1-cantidad-aplicar');
    await typeId('revision-motivo-guardado', 'Quantity only');
    await pressId('revision-guardar');
    expect(saved).toHaveLength(1);
    const esperado = aplicarEdicion(contenido, ext, { tipo: 'linea_escalar', lineaId, campo: 'cantidad', valor: '12', motivo: 'Cantidad ilegible' });
    if (!esperado.ok) throw new Error('fixture');
    expect(saved[0].contenido).toEqual(JSON.parse(JSON.stringify(esperado.contenido)));
  });

  it('keeps the currency field correctable with a motive and restores the USD displays and inputs once corrected', async () => {
    const repo = fakeRepo();
    repo.leerExtracciones.mockResolvedValue([extraccionRow({}, payload({ moneda: 'VES', subtotal: '18.95', total: '21.98' }))]);
    await openView(repo);
    await pressId(`revision-iniciar-${EXT}`);
    await confirmEverything();
    expect(maybeId('revision-cab-moneda-valor')).not.toBeNull();
    expect(maybeId('revision-cab-subtotal-original')).toBeNull();
    await typeId('revision-cab-moneda-valor', 'USD');
    await typeId('revision-cab-moneda-motivo', 'OCR misread the currency');
    await pressId('revision-cab-moneda-aplicar');
    expect(textOf('revision-linea-1-importe-final')).toContain('$8.00');
    expect(textOf('revision-totales')).toContain('$21.982');
    visitar('revision-linea-1-precioUnitario-valor');
    expect(screen.queryAllByLabelText(/USD/).length).toBeGreaterThan(0);
    expect(textOf('revision-cab-subtotal-original')).toBe('Original: 18.95');
    expect(textOf('revision-linea-1-precioUnitario-original')).toBe('Original: 0.80');
    expect(maybeId('revision-linea-1-precioUnitario-valor')).not.toBeNull();
    expect(maybeId('revision-agregar-precio')).not.toBeNull();
    expect(textOf('revision-diferencias')).toContain('impreso 8.00 · calculado 8.00 · diferencia 0.00');
  });

  it('keeps the USD displays, inputs and printed-vs-calculated rows exactly as before for a USD document', async () => {
    const repo = fakeRepo();
    repo.leerExtracciones.mockResolvedValue([extraccionRow({}, payload({ subtotal: '18.95', total: '21.98' }))]);
    await openView(repo);
    await pressId(`revision-iniciar-${EXT}`);
    await confirmEverything();
    expect(textOf('revision-cab-subtotal-original')).toBe('Original: 18.95');
    expect(textOf('revision-cab-total-original')).toBe('Original: 21.98');
    expect(textOf('revision-linea-1-precioUnitario-original')).toBe('Original: 0.80');
    expect(textOf('revision-linea-1-total-original')).toBe('Original: 8.00');
    for (const id of ['revision-cab-subtotal-valor', 'revision-linea-1-precioUnitario-valor', 'revision-linea-1-total-valor', 'revision-agregar-precio']) expect(maybeId(id)).not.toBeNull();
    expect(maybeId('revision-linea-1-precioUnitario-oculto')).toBeNull();
    expect(textOf('revision-diferencias')).toContain('Renglón 1 total: impreso 8.00 · calculado 8.00 · diferencia 0.00');
    expect(textOf('revision-diferencias')).not.toContain('sin convertir');
    visitar('revision-linea-1-precioUnitario-valor');
    expect(screen.queryAllByLabelText(/Costo unitario \(USD\)/).length).toBeGreaterThan(0);
  });

  it('keeps supported USD figures exact, grouped like formatUSD, with extra precision preserved', async () => {
    const repo = fakeRepo();
    repo.leerExtracciones.mockResolvedValue([extraccionRow({}, { ...payload(), lineas: [linea(1, { cantidad: '1000', precioUnitario: '1.5', total: null }), linea(2), linea(3)] })]);
    await openView(repo);
    await pressId(`revision-iniciar-${EXT}`);
    await confirmEverything();
    expect(textOf('revision-linea-1-importe-final')).toContain('$1,500.00');
    expect(textOf('revision-totales')).toContain('$1,510.95');
    expect(textOf('revision-totales')).toContain('$1,752.702');
    expect(textOf('revision-linea-2-base')).toContain('$4.75');
  });
});

// ── B4: omitted documentary line inside the same revision ───────────────────

describe('B4 assisted add-line action', () => {
  const fill = async (motivo: string) => {
    await typeId('revision-agregar-descripcion', 'Adhesivo omitido');
    await typeId('revision-agregar-cantidad', '2');
    await typeId('revision-agregar-precio', '3.50');
    await typeId('revision-agregar-iva', '16');
    if (motivo) await typeId('revision-agregar-motivo', motivo);
  };

  it('offers an accessible add-line action that needs an explicit motive', async () => {
    const repo = fakeRepo();
    await startRevision(repo);
    irAEtapa('productos');
    expect(screen.queryByRole('button', { name: /agregar.*producto|agregar.*rengl[oó]n|a[nñ]adir.*rengl[oó]n|agregar.*l[ií]nea/i })).not.toBeNull();
    await fill('');
    expect(isDisabled('revision-agregar-manual')).toBe(true);
    await typeId('revision-agregar-motivo', 'OCR skipped this printed line');
    expect(isDisabled('revision-agregar-manual')).toBe(false);
  });

  it('adds the row to the SAME revision, keeps source rows and raw extraction, then calculates, saves and reopens it', async () => {
    const raw = payload();
    const original = JSON.stringify(raw);
    const repo = fakeRepo();
    repo.leerExtracciones.mockResolvedValue([extraccionRow({}, raw)]);
    const saved: GuardarRevisionInput[] = [];
    repo.guardarRevision.mockImplementation(async (input: GuardarRevisionInput) => {
      saved.push(JSON.parse(JSON.stringify(input)));
      return { revision: 1, fingerprint: FP, replay: false };
    });
    const first = await openView(repo);
    await pressId(`revision-iniciar-${EXT}`);
    await confirmEverything();
    const sourceIds = [1, 2, 3].map(n => byId(`revision-linea-${n}`));
    expect(sourceIds).toHaveLength(3);

    await fill('OCR skipped this printed line');
    await pressId('revision-agregar-manual');
    expect(byId('revision-linea-m4')).toBeTruthy();
    expect(textOf('revision-linea-m4-descripcion-corregido')).toContain('Adhesivo omitido');
    expect(textOf('revision-bloqueos')).toMatch(/elegir el producto del inventario/i);

    // Correct the new row, resolve its decisions, and the totals include it exactly.
    await typeId('revision-linea-m4-cantidad-valor', '3');
    await typeId('revision-linea-m4-cantidad-motivo', 'Quantity confirmed on the paper');
    await pressId('revision-linea-m4-cantidad-aplicar');
    await typeId('revision-linea-m4-factor-valor', '1');
    await pressId('revision-linea-m4-factor-aplicar');
    await typeId('revision-linea-m4-nuevo-motivo', 'No match in the complete catalog');
    await pressId('revision-linea-m4-nuevo-aplicar');
    expect(textOf('revision-linea-m4-importe-final')).toContain('$10.50');
    expect(textOf('revision-bloqueos')).toContain('Sin bloqueos');
    expect(textOf('revision-totales')).toContain('$29.45');

    await typeId('revision-motivo-guardado', 'Review with the omitted line');
    await pressId('revision-guardar');
    expect(saved).toHaveLength(1);
    const lineas = saved[0].contenido.lineas;
    expect(lineas).toHaveLength(4);
    expect(lineas.slice(0, 3).map(l => l.origen)).toEqual([{ numeroLinea: 1 }, { numeroLinea: 2 }, { numeroLinea: 3 }]);
    expect(lineas[3].origen).toBeNull();
    expect(lineas[3].correcciones.descripcion).toEqual({ valor: 'Adhesivo omitido', motivo: 'OCR skipped this printed line' });
    expect(lineas[3].correcciones.cantidad?.valor).toBe('3');
    expect(JSON.stringify(raw)).toBe(original);

    // Reopen from the server's latest revision: the row, its corrections and its motive come back.
    first.unmount();
    const reopened = fakeRepo();
    reopened.leerExtracciones.mockResolvedValue([extraccionRow({}, raw)]);
    reopened.leerRevisiones.mockResolvedValue([savedRevision({ contenido: saved[0].contenido, fingerprint: FP })]);
    await openView(reopened);
    expect(textOf('revision-linea-m4-descripcion-corregido')).toContain('Adhesivo omitido');
    expect(textOf('revision-linea-m4-cantidad-corregido')).toContain('3');
    expect(textOf('revision-linea-m4-descripcion-motivo-aplicado')).toContain('OCR skipped this printed line');
    expect(reopened.guardarRevision).not.toHaveBeenCalled();
  });

  it('lets the user remove a manual row but never an extracted source row', async () => {
    const repo = fakeRepo();
    await startRevision(repo);
    await fill('OCR skipped this printed line');
    await pressId('revision-agregar-manual');
    expect(maybeId('revision-linea-1-quitar')).toBeNull();
    expect(maybeId('revision-linea-2-quitar')).toBeNull();
    expect(maybeId('revision-linea-3-quitar')).toBeNull();
    await pressId('revision-linea-m4-quitar');
    expect(maybeId('revision-linea-m4')).toBeNull();
    expect(byId('revision-linea-1')).toBeTruthy();
  });

  it('creates no purchase, manual invoice or other repository side effect', async () => {
    const repo = fakeRepo();
    await startRevision(repo);
    await fill('OCR skipped this printed line');
    await pressId('revision-agregar-manual');
    expect(repo.guardarRevision).not.toHaveBeenCalled();
    expect(repo.aprobarRevision).not.toHaveBeenCalled();
    expect(repo.extraer).not.toHaveBeenCalled();
  });

  it('rejects a value the domain cannot accept instead of adding a broken row', async () => {
    const repo = fakeRepo();
    await startRevision(repo);
    await typeId('revision-agregar-descripcion', 'Bad row');
    await typeId('revision-agregar-cantidad', 'diez');
    await typeId('revision-agregar-motivo', 'Typed by hand');
    await pressId('revision-agregar-manual');
    expect(maybeId('revision-linea-m4')).toBeNull();
    expect(byId('revision-aviso')).toBeTruthy();
  });
});

// ── B5 / A1: lifecycle and session generations ──────────────────────────────

describe('B5 lifecycle generations', () => {
  it('discards pending invoice A load after A/B/A rather than overwriting the fresh correction', async () => {
    const old = deferred<RevisionRow[]>();
    const repo = fakeRepo();
    const fresh = savedRevision({}, c => {
      const r = aplicarEdicion(c, payload(), { tipo: 'linea_escalar', lineaId: c.lineas[0].lineaId, campo: 'cantidad', valor: '22', motivo: 'Fresh server revision' });
      if (!r.ok) throw Error('fixture');
      return r.contenido;
    });
    repo.leerRevisiones.mockReturnValueOnce(old.promise).mockResolvedValueOnce([]).mockResolvedValueOnce([fresh]);
    repo.leerExtracciones.mockResolvedValue([extraccionRow()]);
    const view = await mountHook(repo);
    view.rerenderUi(<Hook {...hookProps(repo, { facturaId: FACTURA_2 })} />);
    await settle();
    view.rerenderUi(<Hook {...hookProps(repo)} />);
    await settle();
    expect(current.efectiva!.lineas[0].campos.cantidad.valor).toBe('22');
    await act(async () => old.resolve([savedRevision()]));
    await settle();
    expect(current.efectiva!.lineas[0].campos.cantidad.valor).toBe('22');
  });

  it('rejects an A-account pending save result after account A/B/A and preserves the newest local state', async () => {
    const old = deferred<any>();
    const repo = fakeRepo({ guardarRevision: jest.fn(() => old.promise) });
    const view = await startHook(repo);
    await fullHook();
    let pending: Promise<boolean> = Promise.resolve(false);
    act(() => {
      pending = current.guardar('Old account operation');
    });
    await settle();
    view.rerenderUi(<Hook {...hookProps(repo, { ownerId: OWNER_B, getSessionUid: () => OWNER_B })} />);
    await settle();
    view.rerenderUi(<Hook {...hookProps(repo)} />);
    await settle();
    expect(current.ultimaFila).toBeNull();
    await act(async () => {
      old.resolve({ revision: 1, fingerprint: FP, replay: false });
      await pending;
    });
    await settle();
    expect(current.ultimaFila).toBeNull();
  });

  it.each(['version', 'sha', 'invoice', 'account'])('drops pending load across a one-way %s change', async kind => {
    const old = deferred<RevisionRow[]>();
    const repo = fakeRepo();
    repo.leerRevisiones.mockReturnValueOnce(old.promise).mockResolvedValue([]);
    repo.leerExtracciones.mockResolvedValue([extraccionRow()]);
    const view = await mountHook(repo);
    const change = kind === 'version' ? { facturaVersion: 4 } : kind === 'sha' ? { documentoSha256: 'b'.repeat(64) } : kind === 'invoice' ? { facturaId: FACTURA_2 } : { ownerId: OWNER_B, getSessionUid: () => OWNER_B };
    view.rerenderUi(<Hook {...hookProps(repo, change)} />);
    await settle();
    await act(async () => old.resolve([savedRevision()]));
    await settle();
    expect(current.contenido).toBeNull();
  });

  it('rejects a pending save from the preceding session after a same-UID logout and relogin', async () => {
    const pendingSave = deferred<any>();
    const repo = fakeRepo({ guardarRevision: jest.fn(() => pendingSave.promise) });
    let uid: string | null = OWNER_A;
    repo.leerExtracciones.mockResolvedValue([extraccionRow()]);
    const view = await mountHook(repo, { getSessionUid: () => uid });
    await act(async () => {
      current.aplicarExtraccion(EXT, null);
    });
    await settle();
    await fullHook();
    let saving: Promise<boolean> = Promise.resolve(false);
    act(() => {
      saving = current.guardar('Before signout');
    });
    await settle();
    uid = null;
    view.rerenderUi(<Hook {...hookProps(repo, { getSessionUid: () => uid })} />);
    await settle();
    uid = OWNER_A;
    view.rerenderUi(<Hook {...hookProps(repo, { getSessionUid: () => uid })} />);
    await settle();
    await act(async () => {
      pendingSave.resolve({ revision: 1, fingerprint: FP, replay: false });
      await saving;
    });
    await settle();
    expect(current.ultimaFila).toBeNull();
    expect(current.ocupado).toBeNull();
  });

  it('observes a sign-out signal even when the UID never reads as null, and releases the busy state', async () => {
    const pendingSave = deferred<any>();
    const repo = fakeRepo({ guardarRevision: jest.fn(() => pendingSave.promise) });
    let signOut: () => void = () => undefined;
    const unsubscribe = jest.fn();
    repo.leerExtracciones.mockResolvedValue([extraccionRow()]);
    await mountHook(repo, {
      suscribirCierreSesion: callback => {
        signOut = callback;
        return unsubscribe;
      },
    });
    await act(async () => {
      current.aplicarExtraccion(EXT, null);
    });
    await settle();
    await fullHook();
    let saving: Promise<boolean> = Promise.resolve(false);
    act(() => {
      saving = current.guardar('Before the sign-out signal');
    });
    await settle();
    await act(async () => signOut());
    await settle();
    await act(async () => {
      pendingSave.resolve({ revision: 1, fingerprint: FP, replay: false });
      await saving;
    });
    await settle();
    expect(current.ultimaFila).toBeNull();
    expect(current.ocupado).toBeNull();
    expect(current.contenido).not.toBeNull();
  });

  it('unsubscribes from the sign-out signal and ignores results that arrive after unmount', async () => {
    const late = deferred<RevisionRow[]>();
    const repo = fakeRepo();
    repo.leerRevisiones.mockReturnValue(late.promise);
    repo.leerExtracciones.mockResolvedValue([extraccionRow()]);
    const unsubscribe = jest.fn();
    const error = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const view = await mountHook(repo, { suscribirCierreSesion: () => unsubscribe });
    view.unmount();
    expect(unsubscribe).toHaveBeenCalledTimes(1);
    await act(async () => late.resolve([savedRevision()]));
    await settle();
    expect(error).not.toHaveBeenCalled();
    error.mockRestore();
  });

  it('keeps unsaved review edits across ordinary rerenders, recreated callbacks and session token refresh', async () => {
    const repo = fakeRepo();
    const view = await startHook(repo);
    await edit({ tipo: 'linea_escalar', lineaId: current.contenido!.lineas[0].lineaId, campo: 'cantidad', valor: '12', motivo: 'Cantidad ilegible' });
    const reads = repo.leerRevisiones.mock.calls.length;
    const before = JSON.stringify(current.contenido);
    for (let i = 0; i < 3; i += 1) {
      view.rerenderUi(<Hook {...hookProps(repo, { getSessionUid: () => OWNER_A, newId: () => newId() })} />);
      await settle();
    }
    expect(JSON.stringify(current.contenido)).toBe(before);
    expect(current.sucio).toBe(true);
    expect(repo.leerRevisiones.mock.calls.length).toBe(reads);
  });
});

describe('A1 session eligibility', () => {
  it.each(['dirty', 'version', 'sha', 'session'])('blocks attestation with %s as the only changed guard', async kind => {
    const repo = fakeRepo();
    const view = await startHook(repo);
    await fullHook();
    await act(async () => {
      await current.guardar('Complete');
    });
    await settle();
    expect(current.puedeAprobar).toBe(true);
    const change = kind === 'dirty' ? { editorDirty: true } : kind === 'version' ? { facturaVersion: 4 } : kind === 'sha' ? { documentoSha256: 'b'.repeat(64) } : { getSessionUid: () => null };
    view.rerenderUi(<Hook {...hookProps(repo, change)} />);
    await settle();
    expect(current.puedeAprobar).toBe(false);
  });

  it('disables saving and extraction as soon as the session is gone, without waiting for a reload', async () => {
    const repo = fakeRepo();
    let uid: string | null = OWNER_A;
    repo.leerExtracciones.mockResolvedValue([extraccionRow()]);
    const view = await mountHook(repo, { getSessionUid: () => uid });
    await act(async () => {
      current.aplicarExtraccion(EXT, null);
    });
    await settle();
    await edit({ tipo: 'linea_escalar', lineaId: current.contenido!.lineas[0].lineaId, campo: 'cantidad', valor: '12', motivo: 'Cantidad ilegible' });
    expect(current.puedeGuardar).toBe(true);
    expect(current.puedeExtraer).toBe(true);
    uid = null;
    view.rerenderUi(<Hook {...hookProps(repo, { getSessionUid: () => uid })} />);
    expect(current.puedeGuardar).toBe(false);
    expect(current.puedeExtraer).toBe(false);
    expect(current.contenido).not.toBeNull();
  });
});

// ── T8.4b2: hybrid retrieval reaches the real matcher through the real repository read ──────────────

describe('T8.4b2 hybrid retrieval wiring', () => {
  const SYNONYM = { codigo_interno: 'SYN-1', descripcion: 'Fijacion metalica de anclaje', codigo_barras: null, existencia: -3, costo: 1, precio_venta: 2, es_placeholder: false };

  // Fake Supabase client: the filtered `in` reads answer from `catalog`; description reads find nothing, so a
  // product reaches the suggestions only through its exact code or through the hybrid endpoint.
  function hybridClient(invokeAnswer: () => Promise<{ data: unknown; error: unknown }>, catalog: Array<Record<string, unknown>> = [SYNONYM]) {
    const invoke = jest.fn(invokeAnswer);
    const from = jest.fn(() => {
      const steps: Array<[string, unknown[]]> = [];
      const proxy: Record<string, unknown> = {};
      for (const method of ['select', 'order', 'limit', 'eq', 'in', 'ilike']) {
        proxy[method] = (...args: unknown[]) => {
          steps.push([method, args]);
          return proxy;
        };
      }
      proxy.then = (resolve: (value: unknown) => unknown) => {
        const filters = steps.filter(([method]) => method === 'in');
        const data = steps.some(([method]) => method === 'ilike') ? [] : catalog.filter(row => filters.every(([, [column, values]]) => (values as unknown[]).includes(row[column as string])));
        return Promise.resolve({ data, error: null }).then(resolve);
      };
      return proxy;
    });
    return { client: { from, rpc: jest.fn(async () => ({ data: { decisiones: [] }, error: null })), functions: { invoke } } as unknown as RevisionClient, invoke };
  }

  const answer = (hybridRanks: unknown, parcial = false) => async () => ({ data: { hybridRanks, parcial }, error: null });
  const realRepo = (client: RevisionClient) => fakeRepo({ buscarCandidatos: jest.fn(createFacturaRevisionRepository(client).buscarCandidatos) });

  it('hands the current invoice, extraction and version to the retrieval read', async () => {
    const repo = fakeRepo();
    await startHook(repo);
    expect(repo.buscarCandidatos).toHaveBeenCalledTimes(1);
    expect(repo.buscarCandidatos).toHaveBeenCalledWith(expect.any(Array), { facturaId: FACTURA_1, extraccionId: EXT, versionEsperada: 3 });
  });

  it('offers a synonym-only product found by the semantic rank, still pending human review', async () => {
    const { client, invoke } = hybridClient(answer([{ lineIndex: 0, semantic: [{ codigoInterno: 'SYN-1', rank: 1 }] }]));
    await startHook(realRepo(client));
    expect(invoke).toHaveBeenCalledTimes(1);
    const match = current.candidatos[1];
    expect(match.candidates.map(candidate => candidate.codigoInterno)).toEqual(['SYN-1']);
    expect(match.status).toBe('review');
    expect(current.catalogoParcial).toBe(false);
    expect(current.efectiva!.lineas[0].asociacion.tipo).toBe('pendiente');
  });

  it('offers nothing for the same synonym product when the endpoint returns no rank (control)', async () => {
    const { client } = hybridClient(answer([]));
    await startHook(realRepo(client));
    expect(current.candidatos[1].candidates).toEqual([]);
  });

  it.each([
    ['throws', () => Promise.reject(new Error('SECRET-NETWORK'))],
    ['answers 503', async () => ({ data: null, error: { name: 'FunctionsHttpError', context: { status: 503 } } })],
    ['returns garbage', async () => ({ data: { hybridRanks: [{ lineIndex: 'x' }] }, error: null })],
  ])('keeps the exact-code suggestion and flags the catalog partial when the endpoint %s', async (_name, failing) => {
    const { client, invoke } = hybridClient(failing, PRODUCTOS);
    await startHook(realRepo(client));
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(current.candidatos[1].candidates[0].codigoInterno).toBe('00123');
    expect(current.catalogoParcial).toBe(true);
  });

  it.each(['invoice', 'session'])('ignores a delayed hybrid result after a %s change', async kind => {
    const late = deferred<{ productos: unknown[]; parcial: boolean; hybridRanks: unknown[] }>();
    const repo = fakeRepo();
    repo.buscarCandidatos.mockReturnValueOnce(late.promise).mockResolvedValue({ productos: [], parcial: false });
    repo.leerExtracciones.mockResolvedValue([extraccionRow()]);
    const view = await mountHook(repo);
    await act(async () => {
      current.aplicarExtraccion(EXT, null);
    });
    await settle();
    view.rerenderUi(<Hook {...hookProps(repo, kind === 'invoice' ? { facturaId: FACTURA_2 } : { getSessionUid: () => null })} />);
    await settle();
    await act(async () => late.resolve({ productos: [SYNONYM], parcial: false, hybridRanks: [{ lineIndex: 0, semantic: [{ codigoInterno: 'SYN-1', rank: 1 }] }] }));
    await settle();
    expect(current.candidatos).toEqual({});
  });
});

// ── Post-E2E: atomic batch of explicit edits ────────────────────────────────

describe('editarVarios: one atomic patch through the same edit path', () => {
  const ivaDe = (lineaId: string, valor = '16') => ({ tipo: 'linea_escalar' as const, lineaId, campo: 'tasaIva' as const, valor, motivo: `IVA indicado manualmente: ${valor} %` });

  it('keeps all three edits made in one handler (separate editar calls lose all but the last)', async () => {
    const repo = fakeRepo();
    await startHook(repo);
    const ids = current.contenido!.lineas.map(l => l.lineaId);
    let resultado: { ok: boolean; aplicadas: number } | undefined;
    await act(async () => {
      resultado = current.editarVarios(ids.map(id => ivaDe(id)));
    });
    await settle();
    expect(resultado).toEqual({ ok: true, aplicadas: 3 });
    expect(current.contenido!.lineas.map(l => l.correcciones.tasaIva)).toEqual(ids.map(() => ({ valor: '16', motivo: 'IVA indicado manualmente: 16 %' })));
    expect(blockerCodes()).not.toContain('iva_tasa_desconocida');
  });

  it('produces exactly the content of the same edits applied one by one through editar', async () => {
    const repo = fakeRepo();
    await startHook(repo);
    const ids = current.contenido!.lineas.map(l => l.lineaId);
    const ediciones = [ivaDe(ids[0], '0'), { tipo: 'factor_conversion' as const, lineaId: ids[1], valor: '1' }, ivaDe(ids[2])];
    const esperado = ediciones.reduce((contenido, edicion) => {
      const paso = aplicarEdicion(contenido, current.extraccion, edicion);
      if (!paso.ok) throw new Error('fixture');
      return paso.contenido;
    }, current.contenido!);
    await act(async () => {
      expect(current.editarVarios(ediciones).ok).toBe(true);
    });
    await settle();
    expect(current.contenido).toEqual(esperado);
  });

  it('applies nothing when one edit is invalid, and says no line changed', async () => {
    const repo = fakeRepo();
    await startHook(repo);
    const antes = current.contenido;
    const ids = antes!.lineas.map(l => l.lineaId);
    let resultado: { ok: boolean; aplicadas: number } | undefined;
    await act(async () => {
      resultado = current.editarVarios([ivaDe(ids[0]), ivaDe(ids[1], 'abc'), ivaDe(ids[2])]);
    });
    await settle();
    expect(resultado).toEqual({ ok: false, aplicadas: 0 });
    expect(current.contenido).toBe(antes);
    expect(current.aviso).toEqual({ tipo: 'error', texto: 'Ese valor no es válido: no se cambió ningún renglón.' });
  });

  it('fails closed for a stale context, another session or a save in flight', async () => {
    const guardada = savedRevision();
    const repo = fakeRepo({ leerRevisiones: jest.fn(async () => [guardada]), leerExtracciones: jest.fn(async () => [extraccionRow()]) });
    let uid: string | null = OWNER_A;
    const view = await mountHook(repo, { getSessionUid: () => uid });
    const ids = current.contenido!.lineas.map(l => l.lineaId);
    const contexto = current.contextoActual();

    await act(async () => {
      await current.recargar();
    });
    await settle();
    const recargado = current.contenido;
    expect(recargado).not.toBeNull();
    await act(async () => {
      expect(current.editarVarios([ivaDe(ids[0])], contexto)).toEqual({ ok: false, aplicadas: 0 });
    });
    await settle();
    expect(current.contenido).toBe(recargado);
    // Positive control: the same batch under the current context applies.
    await act(async () => {
      expect(current.editarVarios([ivaDe(ids[0])], current.contextoActual())).toEqual({ ok: true, aplicadas: 1 });
    });
    await settle();

    const pendiente = deferred<{ revision: number; fingerprint: string; replay: boolean }>();
    repo.guardarRevision.mockImplementationOnce(() => pendiente.promise);
    let guardado: Promise<boolean> | undefined;
    await act(async () => {
      guardado = current.guardar('Lote');
    });
    expect(current.ocupado).toBe('guardando');
    const enVuelo = current.contenido;
    await act(async () => {
      expect(current.editarVarios([ivaDe(ids[1])], current.contextoActual())).toEqual({ ok: false, aplicadas: 0 });
    });
    expect(current.contenido).toBe(enVuelo);
    await act(async () => {
      pendiente.resolve({ revision: 2, fingerprint: FP, replay: false });
      await guardado;
    });
    await settle();

    uid = OWNER_B;
    view.rerenderUi(<Hook {...hookProps(repo, { getSessionUid: () => uid })} />);
    await settle();
    const sinSesion = current.contenido;
    await act(async () => {
      expect(current.editarVarios([ivaDe(ids[1])]).ok).toBe(false);
    });
    expect(current.contenido).toBe(sinSesion);
  });
});
