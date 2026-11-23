import * as React from 'react';
import { ScrollView, StyleSheet, Text } from 'react-native';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react-native';
import FacturaRevisionView, { type CabeceraLeida, type EtapaRevision, type FacturaRevisionViewProps } from './FacturaRevisionView';
import { supabase } from '../lib/supabase';
import { reanudarBorradorCompra } from '../hooks/useBorradores';
import {
  RevisionRepositoryError,
  type ExtraccionRow,
  type FacturaRevisionRepository,
  type GuardarRevisionInput,
  type RevisionRow,
} from '../lib/facturaRevisionRepository';
import { crearRevisionDesdeExtraccion, aplicarEdicion, type RevisionContenido } from '../lib/facturaRevision';
import type { FacturaExtraccionPayload } from '../lib/facturaExtractionContract';
import { OWNER_A, OWNER_B, FACTURA_1, deferred, renderWithProviders, settle } from '../test-utils/facturaUiHarness';
import { elSerrucho } from '../theme/brands/el-serrucho';
import { useDeviceSize } from '../hooks/useDeviceSize';

jest.mock('../lib/supabase', () => ({ supabase: { functions: { invoke: jest.fn() } } }));
jest.mock('../hooks/useBorradores', () => ({ reanudarBorradorCompra: jest.fn() }));
jest.mock('../hooks/useDeviceSize', () => ({ useDeviceSize: jest.fn() }));
let mockScannerProps: { onScan: (code: string) => void; onClose: () => void } | null = null;
jest.mock('./BarcodeScannerModal', () => ({ BarcodeScannerModal: ({ visible, onScan, onClose }: any) => {
  if (!visible) return null;
  mockScannerProps = { onScan, onClose };
  return require('react').createElement(require('react-native').View, null,
    require('react').createElement(require('react-native').Text, { testID: 'scanner-mock-capture', onPress: () => onScan('000123-ABC') }, 'Capture'),
    require('react').createElement(require('react-native').Text, { testID: 'scanner-mock-close', onPress: onClose }, 'Close'));
} }));
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

function payload(cabecera: Record<string, unknown> = {}, lineas: Record<string, unknown>[] = [linea(1), linea(2), linea(3)]): FacturaExtraccionPayload {
  return {
    version: 1,
    cabecera: { proveedorNombre: 'Proveedor Uno', proveedorRif: null, numeroDocumento: 'DOC-1', numeroControl: null, fechaEmision: '2026-10-15', moneda: 'USD', tasaCambio: null, subtotal: null, descuentos: [], impuestos: [], total: null, ...cabecera },
    lineas,
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

// The review reads Hybrid stock once it has no blockers; this suite does not exercise stock, so the read is a local fake.
const sinExistencias = async () => ({});

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
    leerExistencias: sinExistencias,
    ...over,
  };
}

async function openView(repo: Mocks, over: Partial<FacturaRevisionViewProps> = {}) {
  const view = renderWithProviders(<FacturaRevisionView {...props(repo, over)} />);
  await settle();
  return view;
}

// ── Navigating the guided review ────────────────────────────────────────────
// The review shows one stage at a time, one open line and collapsed disclosures. These helpers only open the stage, line
// or disclosure that holds a control (through the real buttons); every assertion still goes through the control itself.
const ETAPAS: readonly EtapaRevision[] = ['leer', 'productos', 'compra'];
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
    return { etapa: 'leer', despliegues: [...(CAMPOS_CABECERA_EXTRA.includes(campo) ? ['revision-cab-mas'] : []), `revision-cab-${campo}-corregir`] };
  }
  if (/^revision-agregar-/.test(id)) return { etapa: 'productos', despliegues: ['revision-agregar-abrir'] };
  if (/^revision-(extraer|iniciar-.*|aplicar-.*|reemplazo-motivo|cabecera-.*)$/.test(id)) return { etapa: 'leer', despliegues: ['revision-detalles-tecnicos'] };
  if (/^revision-(tipo-.*|decision-precioIncluyeIva-.*)$/.test(id)) return { etapa: 'leer', despliegues: [] };
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
  for (let paso = 0; paso < ETAPAS.length; paso++) {
    const actual = ETAPAS.find(etapa => screen.queryByTestId(`revision-etapa-${etapa}`));
    if (!actual || actual === destino) return;
    const adelante = ETAPAS.indexOf(destino) > ETAPAS.indexOf(actual);
    const boton = screen.queryByTestId(adelante ? 'revision-accion-principal' : 'revision-volver');
    // Forward, the primary action only navigates when it says so: elsewhere it would read, save or approve.
    if (!boton || (adelante && !/^Continuar/.test(textoDe(boton)))) return;
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
/** Like `screen.findByTestId`, after opening whatever holds the control. */
const findId = async (id: string) => {
  visitar(id);
  return screen.findByTestId(id);
};
const isDisabled = (id: string): boolean => Boolean(byId(id).props.accessibilityState?.disabled);
/** The footer holds one action: a control that is not the current action does not exist, which is as unavailable as disabled. */
const noSePuede = (id: string): boolean => {
  const nodo = maybeId(id);
  return nodo === null || Boolean(nodo.props.accessibilityState?.disabled);
};

const invokeMaterializar = jest.mocked(supabase.functions.invoke);
const reanudarCompra = jest.mocked(reanudarBorradorCompra);

const TAMANO_TELEFONO = { width: 390, height: 800, isDesktop: false };
const TAMANO_AMPLIO = { width: 1024, height: 800, isDesktop: true };
const tamanoPantalla = jest.mocked(useDeviceSize);

beforeEach(() => {
  tamanoPantalla.mockReturnValue(TAMANO_TELEFONO);
  mockScannerProps = null;
  invokeMaterializar.mockReset();
  reanudarCompra.mockReset();
});

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

/** Opens a revision from a completed extraction through the explicit button. */
async function startRevision(repo: Mocks, over: Partial<FacturaRevisionViewProps> = {}, resultado: unknown = payload()) {
  repo.leerExtracciones.mockResolvedValue([extraccionRow({}, resultado)]);
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

/** A saved revision (as the server would return it) built with the real domain helpers. */
function savedRevision(over: Partial<RevisionRow> = {}, edit: (contenido: RevisionContenido) => RevisionContenido = c => c): RevisionRow {
  const base = crearRevisionDesdeExtraccion(payload(), EXT, newId);
  if (!base.ok) throw new Error('fixture');
  return { revision: 1, clave: 'c0000000-0000-4000-8000-0000000000aa', facturaVersion: 3, extraccionId: EXT, documentoSha256: SHA, contenido: edit(base.contenido), fingerprint: FP, motivo: null, creadoPor: OWNER_A, aprobadoPor: null, aprobadoEn: null, ...over };
}

describe('barcode capture safety', () => {
  it('exposes explicit confirm, change and new-product decisions', async () => {
    const repo = fakeRepo();
    await startRevision(repo);
    expect(textOf('revision-linea-3-candidato-AB-9')).toMatch(/Confirmar/);
    await pressId('revision-linea-3-candidato-AB-9');
    expect(textOf('revision-linea-3-pendiente')).toMatch(/Cambiar producto/);
    await pressId('revision-linea-3-pendiente');
    expect(textOf('revision-linea-3-decision')).toMatch(/Sin decidir/);
    expect(textOf('revision-linea-3-nuevo-aplicar')).toMatch(/producto nuevo/);
  });
  async function ready(repo: Mocks, over: Partial<FacturaRevisionViewProps> = {}) {
    const view = await startRevision(repo, over);
    await typeId('revision-linea-3-nuevo-motivo', 'Pending registration');
    await pressId('revision-linea-3-nuevo-aplicar');
    return view;
  }
  it('explains that the scan goes in C?digo and the invoice code in Referencia', async () => {
    await ready(fakeRepo());
    expect(screen.getByText('El código escaneado se usará en Código; el código de la factura, en Referencia.')).toBeTruthy();
    expect(screen.getByText('Para preparar el borrador de compra, el código nuevo admite hasta 80 caracteres (letras, números, . _ / -), sin recortar.')).toBeTruthy();
  });

  it('cancels without capturing and ignores a closed camera callback after reopening', async () => {
    await ready(fakeRepo());
    await pressId('revision-linea-3-barras-escanear');
    const old = mockScannerProps!;
    await pressId('scanner-mock-close');
    expect(textOf('revision-linea-3-barras-escaneado')).toBe('Sin código capturado');
    await pressId('revision-linea-3-barras-escanear');
    await act(async () => { old.onScan('STALE'); old.onClose(); });
    expect(maybeId('scanner-mock-capture')).not.toBeNull();
    expect(textOf('revision-linea-3-barras-escaneado')).toBe('Sin código capturado');
    await act(async () => mockScannerProps!.onScan('000-NEW'));
    await settle();
    expect(textOf('revision-linea-3-barras-escaneado')).toBe('000-NEW');
  });
  it.each(['version', 'session', 'association'])('discards a camera result after the %s changes', async kind => {
    const repo = fakeRepo();
    let uid: string | null = OWNER_A;
    const getSessionUid = () => uid;
    const view = await ready(repo, { getSessionUid });
    await pressId('revision-linea-3-barras-escanear');
    const old = mockScannerProps!;
    if (kind === 'association') await pressId('revision-linea-3-pendiente');
    else {
      if (kind === 'session') uid = null;
      view.rerenderUi(<FacturaRevisionView {...props(repo, { getSessionUid, facturaVersion: kind === 'version' ? 4 : 3 })} />);
      await settle();
      if (kind === 'session') {
        uid = OWNER_A;
        view.rerenderUi(<FacturaRevisionView {...props(repo, { getSessionUid })} />);
        await settle();
      }
    }
    await act(async () => old.onScan('STALE'));
    await settle();
    expect(screen.queryByText('STALE')).toBeNull();
    expect(repo.guardarRevision).not.toHaveBeenCalled();
    expect(maybeId('scanner-mock-capture')).toBeNull();
  });
  it('ignores an old collision response after a different code is captured', async () => {
    const old = deferred<any>();
    const repo = fakeRepo({ leerColisionesBarras: jest.fn(async (codes: string[]) => codes[0] === 'OLD' ? old.promise : { NEW: { productos: [], completo: true } }) });
    await ready(repo);
    await typeId('revision-linea-3-barras-manual', 'OLD');
    await pressId('revision-linea-3-barras-guardar');
    await typeId('revision-linea-3-barras-manual', 'NEW');
    await pressId('revision-linea-3-barras-guardar');
    await act(async () => old.resolve({ OLD: { productos: [{ codigoInterno: 'WRONG', codigoBarras: 'OLD' }], completo: true } }));
    await settle();
    expect(textOf('revision-linea-3-barras-escaneado')).toBe('NEW');
    expect(screen.queryByText(/WRONG/)).toBeNull();
  });
  it.each(['partial', 'error'])('reports incomplete evidence on %s without claiming uniqueness', async kind => {
    const repo = fakeRepo({ leerColisionesBarras: jest.fn(async () => {
      if (kind === 'error') throw new Error('PRIVATE');
      return { CODE: { productos: [], completo: false } };
    }) });
    await ready(repo);
    await typeId('revision-linea-3-barras-manual', 'CODE');
    await pressId('revision-linea-3-barras-guardar');
    expect(textOf('revision-linea-3-barras-verificacion')).toMatch(/incompleta|No se pudo verificar/i);
    expect(screen.queryByText(/PRIVATE/)).toBeNull();
  });
  it('rejects invalid manual input and persists a valid code alongside the manual selling price', async () => {
    const repo = fakeRepo();
    repo.guardarRevision.mockImplementation(async (input: GuardarRevisionInput) => {
      repo.leerRevisiones.mockResolvedValue([savedRevision({ contenido: input.contenido, clave: input.clave })]);
      return { revision: 1, fingerprint: FP, replay: false };
    });
    const view = await ready(repo);
    await typeId('revision-linea-3-barras-manual', ' BAD ');
    await pressId('revision-linea-3-barras-guardar');
    expect(textOf('revision-linea-3-barras-escaneado')).toBe('Sin código capturado');
    expect(maybeId('revision-linea-3-barras-error')).not.toBeNull();
    await typeId('revision-linea-3-barras-manual', '000-VALID');
    await pressId('revision-linea-3-barras-guardar');
    await typeId('revision-linea-3-pvp-valor', '12.34');
    await pressId('revision-guardar');
    const saved = repo.guardarRevision.mock.calls[0][0].contenido.lineas[2];
    expect(saved.codigoBarras.codigoEscaneado).toBe('000-VALID');
    expect(saved.precioVenta).toBe('12.34');
    view.unmount();
    await openView(repo);
    expect(textOf('revision-linea-3-barras-escaneado')).toBe('000-VALID');
    expect(byId('revision-linea-3-pvp-valor').props.value).toBe('12.34');
  });
});

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
  it('materializes an approved clean revision through the explicit action and resumes only the linked draft', async () => {
    const repo = fakeRepo();
    invokeMaterializar.mockResolvedValue({ data: { compraId: 42 }, error: null } as never);
    await startRevision(repo);
    await confirmEverything();
    await typeId('revision-motivo-guardado', 'Revision completa');
    await pressId('revision-guardar');
    // After saving, approval is the one current action; preparing is not offered yet.
    expect(screen.getByRole('button', { name: 'Aprobar revisión' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Preparar borrador de compra' })).toBeNull();
    expect(noSePuede('revision-materializar')).toBe(true);
    await intentar('revision-materializar');
    expect(invokeMaterializar).not.toHaveBeenCalled();
    await pressId('revision-aprobar');

    expect(screen.getByRole('button', { name: 'Preparar borrador de compra' })).toBeTruthy();
    expect(isDisabled('revision-materializar')).toBe(false);
    await pressId('revision-materializar');

    expect(invokeMaterializar).toHaveBeenCalledTimes(1);
    expect(invokeMaterializar).toHaveBeenCalledWith('materializar-compra-factura', {
      body: { facturaId: FACTURA_1, revision: 1, fingerprint: FP, versionEsperada: 3 },
    });
    expect(reanudarCompra).toHaveBeenCalledTimes(1);
    expect(reanudarCompra).toHaveBeenCalledWith(42);
    expect(invokeMaterializar.mock.calls.map(([name]) => name)).toEqual(['materializar-compra-factura']);
  });

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
    expect(await findId('revision-linea-1-candidato-00123')).toBeTruthy();
    expect(textOf('revision-linea-1-decision')).toMatch(/Sin decidir/);
    await pressId('revision-linea-1-candidato-00123');
    expect(textOf('revision-linea-1-decision')).toMatch(/00123/);
    expect(textOf('revision-linea-1-decision')).toMatch(/sugerencia/i);
  });

  it('renders a reordered-description candidate while keeping the association pending until pressed', async () => {
    const repo = fakeRepo({
      buscarCandidatos: jest.fn(async () => ({
        productos: [{ codigo_interno: 'CAT-1', descripcion: 'Galvanizado tornillo hexagonal 1/4', codigo_barras: null, existencia: 0, costo: 1, precio_venta: 2, es_placeholder: false }],
        parcial: false,
      })),
    });
    const extraction = payload({}, [
      linea(1, { codigoProveedor: null, descripcion: 'Tornillo hexagonal galvanizado 1/4' }),
      linea(2),
      linea(3),
    ]);

    await startRevision(repo, {}, extraction);

    expect(await findId('revision-linea-1-candidato-CAT-1')).toBeTruthy();
    expect(textOf('revision-linea-1-decision')).toMatch(/Sin decidir/);
    expect(textOf('revision-linea-1-decision')).not.toMatch(/CAT-1/);
    await pressId('revision-linea-1-candidato-CAT-1');
    expect(textOf('revision-linea-1-decision')).toMatch(/Asociado a CAT-1/);
    expect(textOf('revision-linea-1-decision')).toMatch(/sugerencia/i);
  });

  it('keeps a line without candidates unresolved and says why, never as a new product', async () => {
    const repo = fakeRepo({ buscarCandidatos: jest.fn(async () => ({ productos: [], parcial: false })) });
    await startRevision(repo);
    expect(await findId('revision-linea-3-sin-candidatos')).toBeTruthy();
    expect(textOf('revision-linea-3-decision')).toMatch(/Sin decidir/);
  });

  it('reports a partial catalog as unknown instead of implying there is no product', async () => {
    const repo = fakeRepo({ buscarCandidatos: jest.fn(async () => ({ productos: [], parcial: true })) });
    await startRevision(repo);
    visitar('revision-linea-1');
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

  it('captures a physical barcode only after explicit new-product confirmation and keeps supplier code separate', async () => {
    const repo = fakeRepo({ leerColisionesBarras: jest.fn(async () => ({ '000123-ABC': { productos: [{ codigoInterno: 'EXISTING', codigoBarras: '000123-ABC' }], completo: true } })) });
    await startRevision(repo);
    await typeId('revision-linea-3-nuevo-motivo', 'Alta pendiente');
    await pressId('revision-linea-3-nuevo-aplicar');
    expect(byId('revision-linea-3-barras-escanear')).toBeTruthy();
    await pressId('revision-linea-3-barras-escanear');
    await pressId('scanner-mock-capture');
    expect(textOf('revision-linea-3-barras-escaneado')).toBe('000123-ABC');
    expect(textOf('revision-linea-3-codigo')).toBe('AB-9');
    expect(await findId('revision-linea-3-barras-colision')).toBeTruthy();
    expect(textOf('revision-linea-3-barras-colision')).toMatch(/EXISTING.*no se asignó/i);
    expect(repo.leerColisionesBarras).toHaveBeenCalledWith(['000123-ABC']);
    expect(textOf('revision-linea-3-decision')).toMatch(/Producto nuevo/);
    expect(repo.guardarRevision).not.toHaveBeenCalled();
  });

  it('offers manual code entry only for the explicitly new line and clears through the revision edit', async () => {
    const repo = fakeRepo();
    await startRevision(repo);
    expect(maybeId('revision-linea-3-barras-escanear')).toBeNull();
    await typeId('revision-linea-3-nuevo-motivo', 'Alta pendiente');
    await pressId('revision-linea-3-nuevo-aplicar');
    await typeId('revision-linea-3-barras-manual', '0000-A9');
    await pressId('revision-linea-3-barras-guardar');
    expect(textOf('revision-linea-3-barras-escaneado')).toBe('0000-A9');
    await pressId('revision-linea-3-barras-limpiar');
    expect(textOf('revision-linea-3-barras-escaneado')).toBe('Sin código capturado');
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
    expect(noSePuede('revision-aprobar')).toBe(true);
    expect(noSePuede('revision-materializar')).toBe(true);
    await intentar('revision-materializar');
    expect(invokeMaterializar).not.toHaveBeenCalled();
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
    expect(noSePuede('revision-aprobar')).toBe(true);
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
    expect(noSePuede('revision-aprobar')).toBe(true);
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
    expect(noSePuede('revision-guardar')).toBe(true);
    await intentar('revision-guardar');
    expect(repo.guardarRevision).not.toHaveBeenCalled();
    await typeId('revision-linea-1-unidad-valor', 'UND');
    await typeId('revision-linea-1-unidad-motivo', 'sin cambio real');
    await pressId('revision-linea-1-unidad-aplicar');
    expect(noSePuede('revision-guardar')).toBe(true);
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
    expect(noSePuede('revision-guardar')).toBe(true);
    expect(noSePuede('revision-aprobar')).toBe(true);
    await intentar('revision-aprobar');
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
    expect(noSePuede('revision-aprobar')).toBe(true);
    expect(noSePuede('revision-materializar')).toBe(true);
    await intentar('revision-materializar');
    expect(invokeMaterializar).not.toHaveBeenCalled();
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
    repo.leerRevisiones.mockResolvedValue([savedRevision({ aprobadoPor: OWNER_A, aprobadoEn: '2026-10-23T12:00:00Z' })]);
    repo.leerExtracciones.mockResolvedValue([extraccionRow()]);
    await openView(repo, { editorDirty: true });
    expect(noSePuede('revision-aprobar')).toBe(true);
    expect(noSePuede('revision-materializar')).toBe(true);
    await intentar('revision-materializar');
    expect(invokeMaterializar).not.toHaveBeenCalled();
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

describe('PVP suggestion: document type, subdued placeholder, typed price (S18)', () => {
  const pvp = (n: number) => `revision-linea-${n}-pvp-valor`;
  const pvpEstado = (n: number) => `revision-linea-${n}-pvp-estado`;
  const placeholderOf = (id: string): string => byId(id).props.placeholder;
  const valueOf = (id: string): string => byId(id).props.value;
  const lastSaved = (repo: Mocks): GuardarRevisionInput => repo.guardarRevision.mock.calls[repo.guardarRevision.mock.calls.length - 1][0] as GuardarRevisionInput;

  /** Line 3 gets a verified cost of exactly 10.00 (2 x 10.00 over 2 stock units); lines 1 and 2 keep 0.80 and 0.95. */
  async function costo10(): Promise<void> {
    await typeId('revision-linea-3-precioUnitario-valor', '10.00');
    await typeId('revision-linea-3-precioUnitario-motivo', 'Precio verificado');
    await pressId('revision-linea-3-precioUnitario-aplicar');
  }

  async function listaConCosto(repo: Mocks, over: Partial<FacturaRevisionViewProps> = {}) {
    const view = await startRevision(repo, over);
    await confirmEverything();
    await costo10();
    return view;
  }

  /** A saved revision with the cost decisions confirmed, plus optional document type and typed price on line 3. */
  function revisionGuardada(tipo: 'factura' | 'nota_entrega' | null, precio: string | null, over: Partial<RevisionRow> = {}): RevisionRow {
    return savedRevision(over, base => {
      const ext = payload();
      const lineaId = base.lineas[2].lineaId;
      const ediciones: Array<Parameters<typeof aplicarEdicion>[2]> = [
        { tipo: 'decision_cabecera', campo: 'precioIncluyeIva', valor: false },
        ...base.lineas.map(l => ({ tipo: 'factor_conversion' as const, lineaId: l.lineaId, valor: '1' })),
        ...base.lineas.map(l => ({ tipo: 'linea_escalar' as const, lineaId: l.lineaId, campo: 'tasaIva' as const, valor: '16', motivo: 'Manual tax decision' })),
        { tipo: 'linea_escalar', lineaId, campo: 'precioUnitario', valor: '10.00', motivo: 'Precio verificado' },
        { tipo: 'tipo_documento', valor: tipo },
        { tipo: 'precio_venta', lineaId, valor: precio },
      ];
      return ediciones.reduce((contenido, edicion) => {
        const r = aplicarEdicion(contenido, ext, edicion, newId);
        if (!r.ok) throw new Error(`fixture edit: ${JSON.stringify(r.error)}`);
        return r.contenido;
      }, base);
    });
  }

  it('offers no suggestion before the document type is chosen, and says why', async () => {
    const repo = fakeRepo();
    await listaConCosto(repo);
    expect(valueOf(pvp(3))).toBe('');
    expect(placeholderOf(pvp(3))).toBe('Sin precio sugerido');
    expect(textOf(pvpEstado(3))).toMatch(/Elige.*tipo de documento/i);
    expect(byId('revision-tipo-sin-definir').props.accessibilityState.selected).toBe(true);
  });

  it.each([
    ['revision-tipo-nota_entrega', '$13.00', '$1.04'],
    ['revision-tipo-factura', '$15.08', '$1.2064'],
  ])('%s: cost 10 suggests %s (cost 0.80 suggests %s), shown as a placeholder over an empty field', async (boton, para10, para080) => {
    const repo = fakeRepo();
    await listaConCosto(repo);
    await pressId(boton);
    expect(placeholderOf(pvp(3))).toBe(para10);
    expect(placeholderOf(pvp(1))).toBe(para080);
    expect(valueOf(pvp(3))).toBe('');
    expect(textOf(pvpEstado(3))).toContain(`Se usará el precio sugerido: ${para10}`);
  });

  it('switching the type back to "Sin definir" removes the suggestion again', async () => {
    const repo = fakeRepo();
    await listaConCosto(repo);
    await pressId('revision-tipo-factura');
    await pressId('revision-tipo-sin-definir');
    expect(placeholderOf(pvp(3))).toBe('Sin precio sugerido');
    expect(byId('revision-tipo-factura').props.accessibilityState.selected).toBe(false);
  });

  it('subdues only the placeholder: typed text keeps the normal color and no opacity is applied to the input', async () => {
    const repo = fakeRepo();
    await listaConCosto(repo);
    await pressId('revision-tipo-factura');
    const input = byId(pvp(3));
    const style = StyleSheet.flatten(input.props.style);
    expect(input.props.placeholderTextColor).toBe(elSerrucho.colors.textMuted);
    expect(style.color).toBe(elSerrucho.colors.text);
    expect(style.opacity).toBeUndefined();
    expect(input.props.accessibilityLabel).toBe('Precio de venta (USD)');
    expect(input.props.accessibilityHint).toMatch(/vacío.*sugerido/i);
  });

  it('a typed price replaces the placeholder, takes precedence and is used by Guardar without any blur', async () => {
    const repo = fakeRepo();
    await listaConCosto(repo);
    await pressId('revision-tipo-factura');
    await typeId(pvp(3), '20');
    expect(valueOf(pvp(3))).toBe('20');
    expect(textOf(pvpEstado(3))).toContain('Se usará tu precio: $20.00');
    expect(isDisabled('revision-guardar')).toBe(false);
    await pressId('revision-guardar');
    const saved = lastSaved(repo).contenido;
    expect(saved.cabecera.tipoDocumento).toBe('factura');
    expect(saved.lineas[2].precioVenta).toBe('20');
    expect(saved.lineas[0]).not.toHaveProperty('precioVenta');
    expect(saved.lineas[1]).not.toHaveProperty('precioVenta');
  });

  it('left empty, Guardar stores no price at all (the suggestion is derived, never persisted)', async () => {
    const repo = fakeRepo();
    await listaConCosto(repo);
    await pressId('revision-tipo-nota_entrega');
    await pressId('revision-guardar');
    const saved = lastSaved(repo).contenido;
    expect(saved.cabecera.tipoDocumento).toBe('nota_entrega');
    expect(JSON.stringify(saved.lineas)).not.toContain('precioVenta');
  });

  it('without touching the PVP controls the saved payload is the legacy content', async () => {
    const repo = fakeRepo();
    await startRevision(repo);
    await confirmEverything();
    await pressId('revision-guardar');
    expect(JSON.stringify(lastSaved(repo).contenido)).not.toMatch(/tipoDocumento|precioVenta/);
  });

  it('a typed price survives a cost change while the placeholder follows the new cost; clearing restores the default', async () => {
    const repo = fakeRepo();
    await listaConCosto(repo);
    await pressId('revision-tipo-factura');
    await typeId(pvp(3), '20');
    await typeId('revision-linea-3-precioUnitario-valor', '20.00');
    await typeId('revision-linea-3-precioUnitario-motivo', 'Otro costo');
    await pressId('revision-linea-3-precioUnitario-aplicar');
    expect(valueOf(pvp(3))).toBe('20');
    expect(placeholderOf(pvp(3))).toBe('$30.16');
    await typeId(pvp(3), '');
    expect(valueOf(pvp(3))).toBe('');
    expect(textOf(pvpEstado(3))).toContain('Se usará el precio sugerido: $30.16');
    await pressId('revision-guardar');
    expect(JSON.stringify(lastSaved(repo).contenido.lineas)).not.toContain('precioVenta');
  });

  it('reloads a saved revision with the typed price in the field and the suggestion behind other lines', async () => {
    const repo = fakeRepo();
    repo.leerRevisiones.mockResolvedValue([revisionGuardada('factura', '20')]);
    repo.leerExtracciones.mockResolvedValue([extraccionRow()]);
    await openView(repo);
    expect(valueOf(pvp(3))).toBe('20');
    expect(textOf(pvpEstado(3))).toContain('Se usará tu precio: $20.00');
    expect(placeholderOf(pvp(1))).toBe('$1.2064');
    expect(byId('revision-tipo-factura').props.accessibilityState.selected).toBe(true);
    expect(textOf('revision-estado')).not.toBe('Con cambios sin guardar');
  });

  it('a saved revision with a type and no price reloads with the placeholder only', async () => {
    const repo = fakeRepo();
    repo.leerRevisiones.mockResolvedValue([revisionGuardada('nota_entrega', null)]);
    repo.leerExtracciones.mockResolvedValue([extraccionRow()]);
    await openView(repo);
    expect(valueOf(pvp(3))).toBe('');
    expect(placeholderOf(pvp(3))).toBe('$13.00');
  });

  it('editing the price after an approval makes the approval outdated and needs a new save', async () => {
    const repo = fakeRepo();
    repo.leerRevisiones.mockResolvedValue([revisionGuardada('factura', null, { aprobadoPor: OWNER_A, aprobadoEn: '2026-10-23T12:00:00Z' })]);
    repo.leerExtracciones.mockResolvedValue([extraccionRow()]);
    await openView(repo);
    await typeId(pvp(3), '20');
    expect(textOf('revision-estado')).toBe('Aprobación desactualizada');
    expect(noSePuede('revision-aprobar')).toBe(true);
    expect(isDisabled('revision-guardar')).toBe(false);
  });

  describe('invalid text never falls back to the suggestion', () => {
    it.each([['comma decimal', '12,5'], ['intermediate dot', '15.'], ['zero', '0'], ['negative', '-5'], ['letters', '20a'], ['13 integer digits', '1234567890123']])(
      'keeps %s visible, blocks Guardar and Aprobar and says what to fix',
      async (_nombre, texto) => {
        const repo = fakeRepo();
        await listaConCosto(repo);
        await pressId('revision-tipo-factura');
        await typeId(pvp(3), texto);
        expect(valueOf(pvp(3))).toBe(texto);
        expect(textOf(pvpEstado(3))).toMatch(/no válido/i);
        expect(textOf('revision-pvp-pendiente')).toMatch(/Corrige el precio de venta del renglón 3/);
        expect(noSePuede('revision-guardar')).toBe(true);
        expect(noSePuede('revision-aprobar')).toBe(true);
        await pressId('revision-guardar');
        expect(repo.guardarRevision).not.toHaveBeenCalled();
      }
    );

    it('a previous valid price is not saved silently over invalid text either', async () => {
      const repo = fakeRepo();
      await listaConCosto(repo);
      await typeId(pvp(3), '20');
      await typeId(pvp(3), '20a');
      await pressId('revision-guardar');
      expect(repo.guardarRevision).not.toHaveBeenCalled();
      expect(valueOf(pvp(3))).toBe('20a');
    });

    it('correcting the text, or clearing it, lifts the block', async () => {
      const repo = fakeRepo();
      await listaConCosto(repo);
      await typeId(pvp(3), '15.');
      expect(noSePuede('revision-guardar')).toBe(true);
      await typeId(pvp(3), '15.5');
      expect(maybeId('revision-pvp-pendiente')).toBeNull();
      expect(isDisabled('revision-guardar')).toBe(false);
      await typeId(pvp(3), '15.');
      await typeId(pvp(3), '');
      expect(maybeId('revision-pvp-pendiente')).toBeNull();
    });

    it('unsaved invalid text is reported as unsaved work so a close guard protects it', async () => {
      const onDirtyChange = jest.fn();
      const repo = fakeRepo();
      repo.leerRevisiones.mockResolvedValue([revisionGuardada(null, null)]);
      repo.leerExtracciones.mockResolvedValue([extraccionRow()]);
      await openView(repo, { onDirtyChange });
      expect(onDirtyChange).toHaveBeenLastCalledWith(false);
      await typeId(pvp(3), '12,5');
      expect(onDirtyChange).toHaveBeenLastCalledWith(true);
      await typeId(pvp(3), '');
      expect(onDirtyChange).toHaveBeenLastCalledWith(false);
    });

    it('an explicit reload from the server discards the invalid text', async () => {
      const repo = fakeRepo();
      repo.guardarRevision.mockRejectedValue(new RevisionRepositoryError('revision_obsoleta'));
      await listaConCosto(repo);
      await pressId('revision-guardar');
      await typeId(pvp(3), '12,5');
      await pressId('revision-recargar');
      await settle();
      expect(maybeId('revision-pvp-pendiente')).toBeNull();
      expect(maybeId(pvp(3))?.props.value ?? '').toBe('');
    });
  });

  describe('currency, account and invoice context', () => {
    it('a non-USD document hides the field, the placeholder and any stored price', async () => {
      const repo = fakeRepo();
      repo.leerRevisiones.mockResolvedValue([revisionGuardada('factura', '20')]);
      repo.leerExtracciones.mockResolvedValue([extraccionRow({}, payload({ moneda: 'VES', tasaCambio: '36.5' }))]);
      await openView(repo);
      expect(maybeId(pvp(3))).toBeNull();
      expect(textOf('revision-linea-3-pvp-oculto')).toBe('Importe oculto: moneda VES sin conversión aprobada a USD');
      expect(screen.queryByDisplayValue('20')).toBeNull();
      expect(maybeId(pvpEstado(3))).toBeNull();
    });

    it('an unknown currency hides it too', async () => {
      const repo = fakeRepo();
      repo.leerExtracciones.mockResolvedValue([extraccionRow({}, payload({ moneda: null }))]);
      await openView(repo);
      await pressId(`revision-iniciar-${EXT}`);
      expect(maybeId(pvp(1))).toBeNull();
      expect(textOf('revision-linea-1-pvp-oculto')).toBe('Importe oculto: moneda desconocida sin conversión aprobada a USD');
    });

    it('changing the currency hides typed and invalid text; going back shows the stored price and drops the invalid text', async () => {
      const repo = fakeRepo();
      await listaConCosto(repo);
      await typeId(pvp(2), '20');
      await typeId(pvp(1), '12,5');
      await typeId('revision-cab-moneda-valor', 'EUR');
      await typeId('revision-cab-moneda-motivo', 'Documento en euros');
      await pressId('revision-cab-moneda-aplicar');
      expect(maybeId(pvp(1))).toBeNull();
      expect(screen.queryByDisplayValue('20')).toBeNull();
      expect(screen.queryByDisplayValue('12,5')).toBeNull();
      expect(maybeId('revision-pvp-pendiente')).toBeNull();
      await pressId('revision-cab-moneda-revertir');
      expect(valueOf(pvp(2))).toBe('20');
      expect(valueOf(pvp(1))).toBe('');
    });

    it('a session change drops the invalid text instead of keeping it for another account', async () => {
      const repo = fakeRepo();
      let uid: string | null = OWNER_A;
      repo.leerExtracciones.mockResolvedValue([extraccionRow()]);
      const view = await openView(repo, { getSessionUid: () => uid });
      await pressId(`revision-iniciar-${EXT}`);
      await typeId(pvp(1), '12,5');
      expect(valueOf(pvp(1))).toBe('12,5');
      uid = OWNER_B;
      view.rerenderUi(<FacturaRevisionView {...props(repo, { getSessionUid: () => uid })} />);
      await settle();
      expect(screen.queryByDisplayValue('12,5')).toBeNull();
      expect(maybeId('revision-pvp-pendiente')).toBeNull();
    });

    it('opening another invoice never shows text typed for the previous one', async () => {
      const repo = fakeRepo();
      repo.leerExtracciones.mockResolvedValue([extraccionRow()]);
      const view = await openView(repo);
      await pressId(`revision-iniciar-${EXT}`);
      await typeId(pvp(1), '12,5');
      repo.leerExtracciones.mockResolvedValue([]);
      view.rerenderUi(<FacturaRevisionView {...props(repo, { facturaId: 'f0000000-0000-4000-8000-000000000002' })} />);
      await settle();
      expect(screen.queryByDisplayValue('12,5')).toBeNull();
      expect(maybeId('revision-pvp-pendiente')).toBeNull();
      expect(maybeId('revision-linea-1')).toBeNull();
    });
  });
});

// ── Guided review: stages, statuses and progressive disclosure ──────────────
// These tests press the real controls one by one; only the setup helpers below may jump between stages.

const aqui = (id: string): boolean => screen.queryByTestId(id) !== null;
const etapaActual = (): EtapaRevision | null => ETAPAS.find(etapa => aqui(`revision-etapa-${etapa}`)) ?? null;
const desplegado = (id: string): boolean => Boolean(screen.getByTestId(id).props.accessibilityState?.expanded);
const textoDeId = (id: string): string => textoDe(screen.getByTestId(id));

async function pulsarYa(id: string): Promise<void> {
  await act(async () => {
    fireEvent.press(screen.getByTestId(id));
  });
  await settle();
}

async function escribirYa(id: string, text: string): Promise<void> {
  await act(async () => {
    fireEvent.changeText(screen.getByTestId(id), text);
  });
}

/** Starts the review through the primary action ("Revisar lo leído"), the way a person does. */
async function revisarLeido(repo: Mocks, over: Partial<FacturaRevisionViewProps> = {}, resultado: unknown = payload()) {
  repo.leerExtracciones.mockResolvedValue([extraccionRow({}, resultado)]);
  const view = await openView(repo, over);
  await pulsarYa(`revision-iniciar-${EXT}`);
  return view;
}

/** The two "Continuar" presses of a started review: Leer, then Productos, then Compra. */
async function aProductos(): Promise<void> {
  await pulsarYa('revision-accion-principal');
}

async function aCompra(): Promise<void> {
  await aProductos();
  await pulsarYa('revision-accion-principal');
}

describe('guided review: Leer', () => {
  it('starts at Leer with one explicit primary action and never reads on its own', async () => {
    const repo = fakeRepo();
    await openView(repo);
    expect(etapaActual()).toBe('leer');
    expect(textoDeId('revision-extraer')).toBe('Leer factura');
    expect(screen.getByText(/Usa un servicio externo y puede tener costo\. Solo se hace cuando tú lo pides\./)).toBeTruthy();
    expect(repo.extraer).not.toHaveBeenCalled();
    await pulsarYa('revision-extraer');
    expect(repo.extraer).toHaveBeenCalledTimes(1);
  });

  it('starts the review from a usable extraction only on an explicit press, then summarizes what was read', async () => {
    const repo = fakeRepo();
    repo.leerExtracciones.mockResolvedValue([extraccionRow()]);
    await openView(repo);
    expect(textoDeId(`revision-iniciar-${EXT}`)).toBe('Revisar lo leído');
    expect(textoDeId('revision-estado')).toBe('Sin revisión');
    expect(aqui('revision-resumen')).toBe(false);

    await pulsarYa(`revision-iniciar-${EXT}`);
    expect(textoDeId('revision-resumen')).toContain('Proveedor Uno');
    expect(textoDeId('revision-resumen')).toContain('DOC-1');
    expect(textoDeId('revision-resumen')).toContain('2026-10-15');
    expect(textoDeId('revision-accion-principal')).toBe('Continuar a productos');
    expect(aqui('revision-linea-1')).toBe(false);
  });

  it('asks the two required questions in plain words, with the document-type choices', async () => {
    const repo = fakeRepo();
    await revisarLeido(repo);
    expect(screen.getByText('¿Es factura o nota de entrega?')).toBeTruthy();
    expect(screen.getByText('¿Los precios incluyen IVA?')).toBeTruthy();
    await pulsarYa('revision-tipo-nota_entrega');
    expect(screen.getByTestId('revision-tipo-nota_entrega').props.accessibilityState.selected).toBe(true);
    await pulsarYa('revision-decision-precioIncluyeIva-no');
    expect(screen.getByTestId('revision-decision-precioIncluyeIva-no').props.accessibilityState.selected).toBe(true);
  });

  it('corrects a summary value only through its own disclosure, keeping the motive', async () => {
    const repo = fakeRepo();
    await revisarLeido(repo);
    expect(aqui('revision-cab-proveedorNombre-valor')).toBe(false);
    await pulsarYa('revision-cab-proveedorNombre-corregir');
    await escribirYa('revision-cab-proveedorNombre-valor', 'Proveedor Dos');
    await escribirYa('revision-cab-proveedorNombre-motivo', 'Lectura equivocada');
    await pulsarYa('revision-cab-proveedorNombre-aplicar');
    expect(textoDeId('revision-resumen')).toContain('Proveedor Dos');
    expect(textoDeId('revision-cab-proveedorNombre-motivo-aplicado')).toContain('Lectura equivocada');
  });

  it('shows a failed read with one retry and the manual way out, and hides the raw attempt details', async () => {
    const repo = fakeRepo();
    repo.leerExtracciones.mockResolvedValue([extraccionRow({ estado: 'fallido', errorCodigo: 'proveedor_timeout' }, null)]);
    const onSeguirManual = jest.fn();
    await openView(repo, { onSeguirManual });
    expect(screen.getByText('No se pudo leer la factura.')).toBeTruthy();
    expect(textoDeId('revision-extraer')).toBe('Intentar de nuevo');
    expect(screen.queryByText(/proveedor_timeout/)).toBeNull();
    await pulsarYa('revision-seguir-manual');
    expect(onSeguirManual).toHaveBeenCalledTimes(1);
    expect(repo.extraer).not.toHaveBeenCalled();

    expect(desplegado('revision-detalles-tecnicos')).toBe(false);
    await pulsarYa('revision-detalles-tecnicos');
    expect(screen.getByText(/proveedor_timeout/)).toBeTruthy();
  });

  it('offers no manual way out when the parent does not provide one', async () => {
    const repo = fakeRepo();
    repo.leerExtracciones.mockResolvedValue([extraccionRow({ estado: 'fallido', errorCodigo: 'proveedor_timeout' }, null)]);
    await openView(repo);
    expect(aqui('revision-seguir-manual')).toBe(false);
  });

  it('keeps fatal states outside the disclosures', async () => {
    const failing = fakeRepo({ leerRevisiones: jest.fn(async () => { throw new Error('boom'); }) });
    await openView(failing);
    expect(desplegado('revision-detalles-tecnicos')).toBe(false);
    expect(aqui('revision-error')).toBe(true);
    expect(aqui('revision-reintentar')).toBe(true);
  });

  it('keeps a session mismatch outside the disclosures and offers no footer action', async () => {
    const repo = fakeRepo();
    await openView(repo, { getSessionUid: () => OWNER_B });
    expect(screen.getByText(/La sesión cambió o no coincide con esta factura/)).toBeTruthy();
    expect(aqui('revision-accion-principal')).toBe(false);
  });

  it('keeps the diagnostics (attempts, extraction replacement) behind "Detalles técnicos"', async () => {
    const repo = fakeRepo();
    await revisarLeido(repo);
    expect(aqui('revision-extraer')).toBe(false);
    expect(aqui('revision-cabecera-impuestos-agregar')).toBe(false);
    await pulsarYa('revision-detalles-tecnicos');
    expect(aqui('revision-extraer')).toBe(true);
    expect(aqui('revision-cabecera-impuestos-agregar')).toBe(true);
    expect(screen.getByText(/Intento 2026-10-23 10:00: completado/)).toBeTruthy();
  });
});

describe('guided review: stage control', () => {
  it('navigates by itself without a controlled stage and reports every change', async () => {
    const repo = fakeRepo();
    const onEtapaChange = jest.fn();
    await revisarLeido(repo, { onEtapaChange });
    await pulsarYa('revision-accion-principal');
    expect(etapaActual()).toBe('productos');
    expect(onEtapaChange).toHaveBeenLastCalledWith('productos');
    await pulsarYa('revision-accion-principal');
    expect(etapaActual()).toBe('compra');
    expect(onEtapaChange).toHaveBeenLastCalledWith('compra');
    await pulsarYa('revision-volver');
    expect(etapaActual()).toBe('productos');
    expect(onEtapaChange).toHaveBeenLastCalledWith('productos');
  });

  it('shows the stage the shell asks for, only reports requests, and stays mounted across stages', async () => {
    const repo = fakeRepo();
    const onEtapaChange = jest.fn();
    const onDirtyChange = jest.fn();
    const view = await revisarLeido(repo);
    const controlada = (etapa: EtapaRevision) => <FacturaRevisionView {...props(repo, { etapa, onEtapaChange, onDirtyChange })} />;

    view.rerenderUi(controlada('productos'));
    await settle();
    expect(etapaActual()).toBe('productos');
    await pulsarYa('revision-linea-1-abrir');
    await escribirYa('revision-linea-1-pvp-valor', '12,5');
    expect(onDirtyChange).toHaveBeenLastCalledWith(true);

    await pulsarYa('revision-accion-principal');
    expect(onEtapaChange).toHaveBeenLastCalledWith('compra');
    expect(etapaActual()).toBe('productos');

    view.rerenderUi(controlada('compra'));
    await settle();
    expect(etapaActual()).toBe('compra');
    expect(aqui('revision-pvp-pendiente')).toBe(true);

    view.rerenderUi(controlada('productos'));
    await settle();
    expect(screen.getByTestId('revision-linea-1-pvp-valor').props.value).toBe('12,5');
  });

  it('sends the person back to Leer when a later stage is requested without content', async () => {
    const repo = fakeRepo();
    const onEtapaChange = jest.fn();
    await openView(repo, { etapa: 'compra', onEtapaChange });
    expect(etapaActual()).toBe('compra');
    expect(textoDeId('revision-accion-principal')).toBe('Ir a Leer');
    await pulsarYa('revision-accion-principal');
    expect(onEtapaChange).toHaveBeenCalledWith('leer');
  });
});

describe('guided review: Productos', () => {
  it('shows what each line still needs and counts the ready ones as the decisions are made', async () => {
    const repo = fakeRepo();
    await revisarLeido(repo);
    await aProductos();
    expect(textoDeId('revision-productos-resumen')).toBe('0 de 3 listos');
    for (const n of [1, 2, 3]) expect(textoDeId(`revision-linea-${n}-estado`)).toBe('Elegir producto');

    await pulsarYa('revision-linea-1-abrir');
    await pulsarYa('revision-linea-1-candidato-00123');
    expect(textoDeId('revision-linea-1-estado')).toBe('Falta IVA');
    await pulsarYa('revision-iva-1-16');
    expect(textoDeId('revision-linea-1-estado')).toBe('Faltan unidades');
    await pulsarYa('revision-factor-1-uno');
    expect(textoDeId('revision-linea-1-estado')).toBe('Listo');
    expect(textoDeId('revision-productos-resumen')).toBe('1 de 3 listos');
  });

  it('opens one line at a time and keeps the many inputs behind disclosures', async () => {
    const repo = fakeRepo();
    await revisarLeido(repo);
    await aProductos();
    expect(desplegado('revision-linea-1-abrir')).toBe(false);
    expect(aqui('revision-linea-1-pvp-valor')).toBe(false);

    await pulsarYa('revision-linea-1-abrir');
    expect(desplegado('revision-linea-1-abrir')).toBe(true);
    expect(aqui('revision-linea-1-pvp-valor')).toBe(true);
    expect(aqui('revision-linea-1-cantidad-valor')).toBe(false);
    expect(aqui('revision-linea-1-importe-final')).toBe(false);

    await pulsarYa('revision-linea-3-abrir');
    expect(desplegado('revision-linea-1-abrir')).toBe(false);
    expect(aqui('revision-linea-1-pvp-valor')).toBe(false);
    expect(aqui('revision-linea-3-pvp-valor')).toBe(true);

    await pulsarYa('revision-linea-3-corregir');
    expect(textoDeId('revision-linea-3-cantidad-original')).toContain('2');
    await pulsarYa('revision-linea-3-mas');
    expect(textoDeId('revision-linea-3-importe-final')).toContain('$6.20');
  });

  it('lets the person confirm, change and mark as new, sending the motives', async () => {
    const repo = fakeRepo();
    await revisarLeido(repo);
    await aProductos();

    await pulsarYa('revision-linea-3-abrir');
    await pulsarYa('revision-linea-3-candidato-AB-9');
    expect(textoDeId('revision-linea-3-decision')).toMatch(/Asociado a AB-9/);
    await pulsarYa('revision-linea-3-pendiente');
    expect(textoDeId('revision-linea-3-decision')).toMatch(/Sin decidir/);
    await pulsarYa('revision-linea-3-nuevo-abrir');
    await escribirYa('revision-linea-3-nuevo-motivo', 'No está en el inventario');
    await pulsarYa('revision-linea-3-nuevo-aplicar');
    expect(textoDeId('revision-linea-3-decision')).toMatch(/Producto nuevo/);
    expect(textoDeId('revision-linea-3-estado')).toBe('Falta IVA');
    expect(aqui('revision-linea-3-barras-escanear')).toBe(true);

    await pulsarYa('revision-linea-1-abrir');
    await pulsarYa('revision-linea-1-manual-abrir');
    await escribirYa('revision-linea-1-manual-codigo', 'SKU-1');
    await escribirYa('revision-linea-1-manual-motivo', 'Mismo articulo');
    await pulsarYa('revision-linea-1-manual-aplicar');
    expect(textoDeId('revision-linea-1-decision')).toMatch(/SKU-1/);

    await pulsarYa('revision-accion-principal');
    expect(etapaActual()).toBe('compra');
    expect(textoDeId('revision-guardar')).toBe('Guardar revisión');
    await pulsarYa('revision-guardar');
    const saved = repo.guardarRevision.mock.calls[0][0] as GuardarRevisionInput;
    expect(saved.contenido.lineas[0].asociacion).toEqual({ tipo: 'confirmado', codigoInterno: 'SKU-1', evidencia: 'manual', motivo: 'Mismo articulo' });
    expect(saved.contenido.lineas[2].asociacion).toEqual({ tipo: 'producto_nuevo', codigoInterno: null, evidencia: 'manual', motivo: 'No está en el inventario' });
  });

  it('moves on to the next line that is not ready', async () => {
    const repo = fakeRepo();
    await revisarLeido(repo);
    await aProductos();
    await pulsarYa('revision-linea-1-abrir');
    await pulsarYa('revision-linea-1-siguiente');
    expect(desplegado('revision-linea-1-abrir')).toBe(false);
    expect(desplegado('revision-linea-2-abrir')).toBe(true);
  });

  it('filters the list by what is left to review', async () => {
    const repo = fakeRepo();
    await revisarLeido(repo);
    await aProductos();
    await pulsarYa('revision-linea-1-abrir');
    await pulsarYa('revision-linea-1-candidato-00123');
    await pulsarYa('revision-iva-1-16');
    await pulsarYa('revision-factor-1-uno');
    expect(textoDeId('revision-filtro-pendientes')).toBe('Por revisar (2)');
    expect(textoDeId('revision-filtro-listos')).toBe('Listos (1)');
    await pulsarYa('revision-filtro-pendientes');
    expect(aqui('revision-linea-1')).toBe(false);
    expect(aqui('revision-linea-2')).toBe(true);
    await pulsarYa('revision-filtro-listos');
    expect(aqui('revision-linea-1')).toBe(true);
    expect(aqui('revision-linea-2')).toBe(false);
  });

  it('never turns a partial or empty catalog answer into a new product', async () => {
    const repo = fakeRepo({ buscarCandidatos: jest.fn(async () => ({ productos: [], parcial: true })) });
    await revisarLeido(repo);
    await aProductos();
    expect(screen.getByText(/Catálogo parcial/)).toBeTruthy();
    expect(textoDeId('revision-linea-3-estado')).toBe('Elegir producto');
    await pulsarYa('revision-linea-3-abrir');
    expect(textoDeId('revision-linea-3-sin-candidatos')).toMatch(/no prueba que el producto no exista/);
    expect(textoDeId('revision-linea-3-decision')).toMatch(/Sin decidir/);
  });

  it('does not contradict the barcode roles: a new line gets the scan as Código, only an existing product offers the printed code', async () => {
    const repo = fakeRepo();
    await revisarLeido(repo);
    await aProductos();
    await pulsarYa('revision-linea-3-abrir');
    await pulsarYa('revision-linea-3-nuevo-abrir');
    await escribirYa('revision-linea-3-nuevo-motivo', 'No está en el inventario');
    await pulsarYa('revision-linea-3-nuevo-aplicar');
    await pulsarYa('revision-linea-3-mas');
    expect(screen.getByText('El código escaneado se usará en Código; el código de la factura, en Referencia.')).toBeTruthy();
    expect(aqui('revision-linea-3-barras-usar')).toBe(false);
    expect(screen.queryByText(/Código de barras propuesto/)).toBeNull();

    await pulsarYa('revision-linea-1-abrir');
    await pulsarYa('revision-linea-1-candidato-00123');
    await pulsarYa('revision-linea-1-mas');
    expect(aqui('revision-linea-1-barras-usar')).toBe(true);
    expect(screen.getByText(/Código de barras propuesto/)).toBeTruthy();
  });

  it('lets a person turn off a printed-code reuse left on a new line, instead of trapping them', async () => {
    const repo = fakeRepo();
    await revisarLeido(repo);
    await aProductos();
    await pulsarYa('revision-linea-1-abrir');
    await pulsarYa('revision-linea-1-mas');
    await pulsarYa('revision-linea-1-barras-usar');
    await pulsarYa('revision-linea-1-nuevo-abrir');
    await escribirYa('revision-linea-1-nuevo-motivo', 'No está en el inventario');
    await pulsarYa('revision-linea-1-nuevo-aplicar');
    expect(screen.getByTestId('revision-linea-1-barras-usar').props.accessibilityState.selected).toBe(true);
    await pulsarYa('revision-linea-1-barras-usar');
    expect(aqui('revision-linea-1-barras-usar')).toBe(false);
  });
});

describe('guided review: quick IVA and units controls', () => {
  it('sends exactly the edits of the manual path and applies nothing before the person chooses', async () => {
    const repo = fakeRepo();
    await revisarLeido(repo);
    await aProductos();

    await pulsarYa('revision-linea-1-abrir');
    expect(textoDeId('revision-iva-1-estado')).toBe('Sin definir');
    expect(screen.getByText(/El documento indica IVA 16\. Es solo referencia/)).toBeTruthy();
    expect(textoDeId('revision-factor-1-estado')).toBe('Sin confirmar');
    await pulsarYa('revision-iva-1-16');
    await pulsarYa('revision-factor-1-uno');
    expect(textoDeId('revision-iva-1-estado')).toBe('Indicado: 16 %');
    expect(textoDeId('revision-factor-1-estado')).toBe('Confirmado: 1');

    await pulsarYa('revision-linea-2-abrir');
    await pulsarYa('revision-iva-2-otro');
    await escribirYa('revision-linea-2-tasaIva-valor', '16');
    await escribirYa('revision-linea-2-tasaIva-motivo', 'IVA indicado manualmente: 16 %');
    await pulsarYa('revision-linea-2-tasaIva-aplicar');
    await pulsarYa('revision-factor-2-otro');
    await escribirYa('revision-linea-2-factor-valor', '1');
    await pulsarYa('revision-linea-2-factor-aplicar');

    await pulsarYa('revision-linea-3-abrir');
    await pulsarYa('revision-iva-3-0');

    await pulsarYa('revision-accion-principal');
    await pulsarYa('revision-guardar');
    const { lineas } = (repo.guardarRevision.mock.calls[0][0] as GuardarRevisionInput).contenido;
    expect(lineas[0].correcciones.tasaIva).toEqual({ valor: '16', motivo: 'IVA indicado manualmente: 16 %' });
    expect(lineas[0].correcciones.tasaIva).toEqual(lineas[1].correcciones.tasaIva);
    expect(lineas[0].factorConversion).toBe('1');
    expect(lineas[0].factorConversion).toBe(lineas[1].factorConversion);
    expect(lineas[2].correcciones.tasaIva).toEqual({ valor: '0', motivo: 'IVA indicado manualmente: 0 %' });
    expect(lineas[2].factorConversion).toBeNull();
  });

  it('applies no IVA or factor by default: every line saves without them', async () => {
    const repo = fakeRepo();
    await revisarLeido(repo);
    await aCompra();
    await pulsarYa('revision-guardar');
    const { lineas } = (repo.guardarRevision.mock.calls[0][0] as GuardarRevisionInput).contenido;
    for (const linea of lineas) {
      expect(linea.correcciones.tasaIva).toBeUndefined();
      expect(linea.factorConversion).toBeNull();
    }
  });
});

describe('guided review: Compra', () => {
  it('groups the purchase step and jumps from a blocker to its line', async () => {
    const repo = fakeRepo();
    await revisarLeido(repo);
    await aCompra();
    expect(screen.getByText('¿El documento está completo?')).toBeTruthy();
    expect(screen.getByText('¿Recibiste toda la mercancía?')).toBeTruthy();
    expect(textoDeId('revision-bloqueos')).toMatch(/Renglón 1: Falta decidir la asociación/);
    await pulsarYa('revision-ir-linea-1');
    expect(etapaActual()).toBe('productos');
    expect(desplegado('revision-linea-1-abrir')).toBe(true);
  });

  it('follows Guardar, Aprobar and Preparar with the primary action', async () => {
    const repo = fakeRepo();
    await revisarLeido(repo);
    await confirmEverything();
    irAEtapa('compra');
    expect(etapaActual()).toBe('compra');
    expect(textoDeId('revision-guardar')).toBe('Guardar revisión');
    await pulsarYa('revision-guardar');
    expect(repo.guardarRevision).toHaveBeenCalledTimes(1);
    expect(textoDeId('revision-aprobar')).toBe('Aprobar revisión');
    expect(screen.getByTestId('revision-aprobar').props.accessibilityState.disabled).toBe(false);
    await pulsarYa('revision-aprobar');
    expect(repo.aprobarRevision).toHaveBeenCalledTimes(1);
    expect(textoDeId('revision-materializar')).toBe('Preparar borrador de compra');
    expect(screen.getByTestId('revision-materializar').props.accessibilityState.disabled).toBe(false);
  });

  it('shows the reason when approving is not possible yet', async () => {
    const repo = fakeRepo();
    await revisarLeido(repo);
    await aCompra();
    await pulsarYa('revision-guardar');
    expect(textoDeId('revision-aprobar')).toBe('Aprobar revisión');
    expect(screen.getByTestId('revision-aprobar').props.accessibilityState.disabled).toBe(true);
    expect(textoDeId('revision-accion-razon')).toBe('Resuelve los bloqueos para aprobar.');
  });

  it('keeps the POS projection and the printed-vs-calculated differences behind "Detalles técnicos", while the emission stays announced as blocked', async () => {
    const repo = fakeRepo();
    await revisarLeido(repo);
    await confirmEverything();
    irAEtapa('compra');
    expect(etapaActual()).toBe('compra');
    expect(screen.getByText(/La emisión al POS sigue bloqueada/)).toBeTruthy();
    expect(aqui('revision-pos')).toBe(false);
    expect(aqui('revision-impacto-hybrid')).toBe(false);
    await pulsarYa('revision-detalles-tecnicos');
    expect(aqui('revision-pos')).toBe(true);
    expect(aqui('revision-impacto-hybrid')).toBe(true);
  });
});

describe('guided review: camera results across the new disclosures', () => {
  it.each(['collapsing the line', 'leaving Productos'])('ignores a camera result that arrives after %s', async how => {
    const repo = fakeRepo();
    await revisarLeido(repo);
    await aProductos();
    await pulsarYa('revision-linea-3-abrir');
    await pulsarYa('revision-linea-3-nuevo-abrir');
    await escribirYa('revision-linea-3-nuevo-motivo', 'No está en el inventario');
    await pulsarYa('revision-linea-3-nuevo-aplicar');
    await pulsarYa('revision-linea-3-barras-escanear');
    const old = mockScannerProps!;

    if (how === 'collapsing the line') {
      await pulsarYa('revision-linea-3-abrir');
    } else {
      await pulsarYa('revision-accion-principal');
      expect(etapaActual()).toBe('compra');
    }
    await act(async () => old.onScan('STALE'));
    await settle();
    if (how === 'collapsing the line') {
      await pulsarYa('revision-linea-3-abrir');
    } else {
      await pulsarYa('revision-volver');
    }

    expect(screen.queryByText('STALE')).toBeNull();
    expect(textoDeId('revision-linea-3-barras-escaneado')).toBe('Sin código capturado');
    expect(repo.guardarRevision).not.toHaveBeenCalled();
  });
});

describe('guided review: exactly one current primary action', () => {
  /** Accessible buttons carrying one of these names, anywhere on screen. */
  const botones = (nombre: string | RegExp) => screen.queryAllByRole('button', { name: nombre });
  /** Buttons of the sticky footer other than "Volver". */
  const accionesDelPie = () => within(screen.getByTestId('revision-pie')).queryAllByRole('button').filter(boton => boton.props.testID !== 'revision-volver');

  it('offers the initial read once, even with the technical details open', async () => {
    const repo = fakeRepo();
    await openView(repo);
    await pulsarYa('revision-detalles-tecnicos');
    expect(botones(/^(Leer factura|Extraer datos|Intentar de nuevo)$/)).toHaveLength(1);
    expect(accionesDelPie()).toHaveLength(1);
    expect(textoDeId('revision-extraer')).toBe('Leer factura');
    expect(within(screen.getByTestId('revision-pie')).getByTestId('revision-extraer')).toBeTruthy();
    await pulsarYa('revision-extraer');
    expect(repo.extraer).toHaveBeenCalledTimes(1);
  });

  it('offers "Revisar lo leído" once and keeps no second start button for the same extraction', async () => {
    const repo = fakeRepo();
    repo.leerExtracciones.mockResolvedValue([extraccionRow()]);
    await openView(repo);
    await pulsarYa('revision-detalles-tecnicos');
    expect(botones(/^(Revisar lo leído|Iniciar revisión con esta extracción)$/)).toHaveLength(1);
    expect(textoDeId(`revision-iniciar-${EXT}`)).toBe('Revisar lo leído');
    expect(within(screen.getByTestId('revision-pie')).getByTestId(`revision-iniciar-${EXT}`)).toBeTruthy();
    await pulsarYa(`revision-iniciar-${EXT}`);
    expect(aqui('revision-resumen')).toBe(true);
  });

  it('keeps the re-read as a secondary control once there is content, never beside a primary read', async () => {
    const repo = fakeRepo();
    await revisarLeido(repo);
    expect(textoDeId('revision-accion-principal')).toBe('Continuar a productos');
    await pulsarYa('revision-detalles-tecnicos');
    expect(botones('Extraer datos')).toHaveLength(1);
    expect(accionesDelPie()).toHaveLength(1);
  });

  it('shows one action at a time through save, approve and prepare, each with its stable id', async () => {
    const repo = fakeRepo();
    await revisarLeido(repo);
    await confirmEverything();
    irAEtapa('compra');
    const nombres = ['Guardar revisión', 'Aprobar revisión', 'Preparar borrador de compra'];
    const ids = ['revision-guardar', 'revision-aprobar', 'revision-materializar'];
    const soloEsta = (actual: number) => {
      nombres.forEach((nombre, i) => expect(botones(nombre)).toHaveLength(i === actual ? 1 : 0));
      ids.forEach((id, i) => expect(aqui(id)).toBe(i === actual));
      expect(accionesDelPie()).toHaveLength(1);
      expect(within(screen.getByTestId('revision-pie')).getByTestId(ids[actual])).toBeTruthy();
    };

    soloEsta(0);
    await pulsarYa('revision-guardar');
    expect(repo.guardarRevision).toHaveBeenCalledTimes(1);
    soloEsta(1);
    await pulsarYa('revision-aprobar');
    expect(repo.aprobarRevision).toHaveBeenCalledTimes(1);
    soloEsta(2);
  });

  it('keeps the single action visible, disabled and explained when it cannot run yet', async () => {
    const repo = fakeRepo();
    await revisarLeido(repo);
    irAEtapa('compra');
    await pulsarYa('revision-guardar');
    expect(botones('Aprobar revisión')).toHaveLength(1);
    expect(botones('Guardar revisión')).toHaveLength(0);
    expect(noSePuede('revision-aprobar')).toBe(true);
    expect(textoDeId('revision-accion-razon')).toBe('Resuelve los bloqueos para aprobar.');
    expect(aqui('revision-materializar')).toBe(false);
  });
});

// ── C1: collision readiness and the expanded two-pane layout ────────────────

describe('guided review: a captured code is ready only after a clean lookup', () => {
  const COLISION = { productos: [{ codigoInterno: '4411', codigoBarras: '7591234' }], completo: true };
  const LIMPIO = { productos: [], completo: true };
  const respuesta = (por: Record<string, unknown>) => jest.fn(async (codes: string[]) => ({ [codes[0]]: por[codes[0]] ?? LIMPIO }));

  const resumenProductos = (): string => {
    irAEtapa('productos');
    return textOf('revision-productos-resumen');
  };

  /** Line 3 becomes a new product with a typed code, after everything else is ready. */
  async function nuevoConCodigo(codigo: string): Promise<void> {
    await pressId('revision-linea-3-pendiente');
    await typeId('revision-linea-3-nuevo-motivo', 'No está en el inventario');
    await pressId('revision-linea-3-nuevo-aplicar');
    await typeId('revision-linea-3-barras-manual', codigo);
    await pressId('revision-linea-3-barras-guardar');
  }

  async function listaConTresListos(repo: Mocks, over: Partial<FacturaRevisionViewProps> = {}) {
    const view = await startRevision(repo, over);
    await confirmEverything();
    expect(resumenProductos()).toBe('3 de 3 listos');
    return view;
  }

  it('keeps a colliding scanned code out of the ready count, with the collision still visible (P9)', async () => {
    const repo = fakeRepo({ leerColisionesBarras: respuesta({ '7591234': COLISION }) });
    await listaConTresListos(repo);
    await pressId('revision-linea-3-pendiente');
    await typeId('revision-linea-3-nuevo-motivo', 'No está en el inventario');
    await pressId('revision-linea-3-nuevo-aplicar');
    expect(textOf('revision-linea-3-estado')).toBe('Nuevo: falta código');
    await pressId('revision-linea-3-barras-escanear');
    await act(async () => { mockScannerProps?.onScan('7591234'); });
    await settle();
    expect(textOf('revision-linea-3-barras-colision')).toContain('4411');
    expect(textOf('revision-linea-3-estado')).toBe('Código ya usado');
    expect(resumenProductos()).toBe('2 de 3 listos');
    expect(textOf('revision-filtro-pendientes')).toBe('Por revisar (1)');
  });

  it('does not count the line while the lookup is pending, and counts it once the lookup is clean', async () => {
    const pendiente = deferred<unknown>();
    const repo = fakeRepo({ leerColisionesBarras: jest.fn(() => pendiente.promise as never) });
    await listaConTresListos(repo);
    await nuevoConCodigo('7591234');
    expect(textOf('revision-linea-3-estado')).toBe('Verificando código');
    expect(resumenProductos()).toBe('2 de 3 listos');
    await act(async () => pendiente.resolve({ '7591234': LIMPIO }));
    await settle();
    expect(textOf('revision-linea-3-estado')).toBe('Listo');
    expect(resumenProductos()).toBe('3 de 3 listos');
  });

  it.each([
    ['an incomplete catalog read', jest.fn(async () => ({ '7591234': { productos: [], completo: false } }))],
    ['a failed read', jest.fn(async () => { throw new Error('down'); })],
  ])('does not count the line after %s', async (_name, leer) => {
    const repo = fakeRepo({ leerColisionesBarras: leer });
    await listaConTresListos(repo);
    await nuevoConCodigo('7591234');
    expect(textOf('revision-linea-3-estado')).toBe('Código sin verificar');
    expect(resumenProductos()).toBe('2 de 3 listos');
  });

  it('counts the line after a complete clean lookup, and not again after the code is cleared', async () => {
    const repo = fakeRepo();
    await listaConTresListos(repo);
    await nuevoConCodigo('7591234');
    expect(textOf('revision-linea-3-estado')).toBe('Listo');
    expect(resumenProductos()).toBe('3 de 3 listos');
    await pressId('revision-linea-3-barras-limpiar');
    expect(textOf('revision-linea-3-estado')).toBe('Nuevo: falta código');
    expect(resumenProductos()).toBe('2 de 3 listos');
  });

  it('judges a replaced code on its own lookup, never on a late answer for the old one', async () => {
    const vieja = deferred<unknown>();
    const repo = fakeRepo({ leerColisionesBarras: jest.fn((codes: string[]) => (codes[0] === 'OLD' ? (vieja.promise as never) : (Promise.resolve({ NEW: LIMPIO }) as never))) });
    await listaConTresListos(repo);
    await nuevoConCodigo('OLD');
    await typeId('revision-linea-3-barras-manual', 'NEW');
    await pressId('revision-linea-3-barras-guardar');
    expect(textOf('revision-linea-3-estado')).toBe('Listo');
    await act(async () => vieja.resolve({ OLD: { productos: [{ codigoInterno: '4411', codigoBarras: 'OLD' }], completo: true } }));
    await settle();
    expect(textOf('revision-linea-3-estado')).toBe('Listo');
    expect(screen.queryByText(/4411/)).toBeNull();
    expect(resumenProductos()).toBe('3 de 3 listos');
  });

  it('keeps the status after the line is collapsed, and for a saved review whose line was never opened', async () => {
    const repo = fakeRepo({ leerColisionesBarras: respuesta({ SAVED: { productos: [{ codigoInterno: '4411', codigoBarras: 'SAVED' }], completo: true } }) });
    repo.leerExtracciones.mockResolvedValue([extraccionRow()]);
    repo.leerRevisiones.mockResolvedValue([savedRevision({}, contenido => ({
      ...contenido,
      lineas: contenido.lineas.map((linea, i) => (i === 2
        ? { ...linea, factorConversion: '1', correcciones: { ...linea.correcciones, tasaIva: { valor: '16', motivo: 'IVA indicado manualmente: 16 %' } }, asociacion: { tipo: 'producto_nuevo' as const, codigoInterno: null, evidencia: 'manual' as const, motivo: 'No está en el inventario' }, codigoBarras: { usarCodigoFactura: false, codigoEscaneado: 'SAVED' } }
        : linea)),
    }))]);
    await openView(repo);
    irAEtapa('productos');
    expect(aqui('revision-linea-3-barras-colision')).toBe(false);
    expect(textoDeId('revision-linea-3-estado')).toBe('Código ya usado');
    expect(repo.leerColisionesBarras).toHaveBeenCalledWith(['SAVED']);
  });

  it('drops a lookup answer that arrives after the session changed, and verifies again for the new context', async () => {
    const vieja = deferred<unknown>();
    let uid: string | null = OWNER_A;
    const getSessionUid = () => uid;
    let llamadas = 0;
    const repo = fakeRepo({ leerColisionesBarras: jest.fn((codes: string[]) => (++llamadas === 1 ? (vieja.promise as never) : (Promise.resolve({ [codes[0]]: LIMPIO }) as never))) });
    const view = await listaConTresListos(repo, { getSessionUid });
    await nuevoConCodigo('7591234');
    expect(textOf('revision-linea-3-estado')).toBe('Verificando código');

    uid = null;
    view.rerenderUi(<FacturaRevisionView {...props(repo, { getSessionUid })} />);
    await settle();
    await act(async () => vieja.resolve({ '7591234': COLISION }));
    await settle();
    uid = OWNER_A;
    view.rerenderUi(<FacturaRevisionView {...props(repo, { getSessionUid })} />);
    await settle();
    irAEtapa('productos');
    expect(screen.queryByText(/4411/)).toBeNull();
    expect(screen.queryByText('Código ya usado')).toBeNull();
  });
});

describe('guided review: Productos on narrow and expanded screens', () => {
  const lista = () => screen.getByTestId('revision-productos-lista');
  const detalle = () => screen.getByTestId('revision-productos-detalle');
  const estiloDe = (id: string) => StyleSheet.flatten(screen.getByTestId(id).props.style);

  async function productos(repo = fakeRepo(), over: Partial<FacturaRevisionViewProps> = {}) {
    const view = await revisarLeido(repo, over);
    await aProductos();
    return view;
  }

  it('keeps one column on a phone, with the detail inside the opened row', async () => {
    tamanoPantalla.mockReturnValue(TAMANO_TELEFONO);
    await productos();
    expect(aqui('revision-productos-paneles')).toBe(false);
    await pulsarYa('revision-linea-1-abrir');
    expect(within(screen.getByTestId('revision-linea-1')).getByTestId('revision-linea-1-pvp-valor')).toBeTruthy();
  });

  it('shows the list and the selected detail side by side when the screen is expanded', async () => {
    tamanoPantalla.mockReturnValue(TAMANO_AMPLIO);
    await productos();
    expect(estiloDe('revision-productos-paneles').flexDirection).toBe('row');
    expect(within(lista()).getByTestId('revision-linea-1')).toBeTruthy();
    expect(within(lista()).getByTestId('revision-linea-3')).toBeTruthy();
    expect(screen.getByText('Elige un renglón de la lista para ver su detalle.')).toBeTruthy();

    await pulsarYa('revision-linea-3-abrir');
    expect(within(detalle()).getByTestId('revision-linea-3-pvp-valor')).toBeTruthy();
    expect(within(lista()).queryByTestId('revision-linea-3-pvp-valor')).toBeNull();
    expect(screen.getAllByTestId('revision-linea-3-pvp-valor')).toHaveLength(1);
    expect(screen.getByTestId('revision-linea-3-abrir').props.accessibilityState.selected).toBe(true);
    expect(screen.queryByText('Elige un renglón de la lista para ver su detalle.')).toBeNull();

    await pulsarYa('revision-linea-1-abrir');
    expect(aqui('revision-linea-3-pvp-valor')).toBe(false);
    expect(within(detalle()).getByTestId('revision-linea-1-pvp-valor')).toBeTruthy();
  });

  it('mounts one detail and one scanner for the selected new line', async () => {
    tamanoPantalla.mockReturnValue(TAMANO_AMPLIO);
    await productos();
    await pulsarYa('revision-linea-3-abrir');
    await pulsarYa('revision-linea-3-nuevo-abrir');
    await escribirYa('revision-linea-3-nuevo-motivo', 'No está en el inventario');
    await pulsarYa('revision-linea-3-nuevo-aplicar');
    await pulsarYa('revision-linea-3-barras-escanear');
    expect(screen.getAllByTestId('scanner-mock-capture')).toHaveLength(1);
    expect(screen.getAllByTestId('revision-linea-3-barras-escanear')).toHaveLength(1);
    expect(screen.getAllByTestId('revision-linea-3-detalle')).toHaveLength(1);
  });

  it('keeps typed prices, the footer and the stage when the selection changes or the screen is resized', async () => {
    tamanoPantalla.mockReturnValue(TAMANO_AMPLIO);
    const repo = fakeRepo();
    const view = await productos(repo);
    await pulsarYa('revision-linea-1-abrir');
    await escribirYa('revision-linea-1-pvp-valor', '12,5');
    await pulsarYa('revision-linea-2-abrir');
    expect(screen.getByTestId('revision-pie')).toBeTruthy();
    await pulsarYa('revision-linea-1-abrir');
    expect(screen.getByTestId('revision-linea-1-pvp-valor').props.value).toBe('12,5');

    tamanoPantalla.mockReturnValue(TAMANO_TELEFONO);
    view.rerenderUi(<FacturaRevisionView {...props(repo)} />);
    await settle();
    expect(etapaActual()).toBe('productos');
    expect(aqui('revision-productos-paneles')).toBe(false);
    expect(desplegado('revision-linea-1-abrir')).toBe(true);
    expect(screen.getAllByTestId('revision-linea-1-pvp-valor')).toHaveLength(1);
    expect(screen.getByTestId('revision-linea-1-pvp-valor').props.value).toBe('12,5');
  });

  it('moves the selection to the next line that is not ready without closing the detail', async () => {
    tamanoPantalla.mockReturnValue(TAMANO_AMPLIO);
    await productos();
    await pulsarYa('revision-linea-1-abrir');
    await pulsarYa('revision-linea-1-siguiente');
    expect(within(detalle()).getByTestId('revision-linea-2-pvp-valor')).toBeTruthy();
  });
});

// ── Post-E2E corrections (S5-S6): grouped blockers, stage scroll, batch decisions, read header ──

describe('post-E2E: blockers stay with their own line', () => {
  it('lists the document blockers first and every reason of a line inside that line group, with its own action', async () => {
    const repo = fakeRepo();
    await revisarLeido(repo);
    await aCompra();
    const todo = textoDeId('revision-bloqueos');
    expect(todo.indexOf('completitud')).toBeLessThan(todo.indexOf('Renglón 1'));
    const documento = textoDeId('revision-bloqueos-documento');
    expect(documento).toMatch(/completitud/);
    expect(documento).toMatch(/recepción/);
    expect(documento).toMatch(/incluyen IVA/);
    expect(documento).not.toMatch(/Renglón/);
    for (const n of [1, 2, 3]) {
      const grupo = screen.getByTestId(`revision-bloqueos-linea-${n}`);
      const texto = textoDe(grupo);
      expect(texto).toContain(`Renglón ${n} · Pendiente: producto, IVA, unidades`);
      expect(texto).toContain(`Renglón ${n}: Falta decidir la asociación con un producto.`);
      expect(texto).toContain(`Renglón ${n}: Falta la tasa de IVA.`);
      expect(texto).toContain(`Renglón ${n}: Falta confirmar el factor de conversión de unidades.`);
      for (const otro of [1, 2, 3].filter(m => m !== n)) expect(texto).not.toContain(`Renglón ${otro}`);
      expect(within(grupo).getByTestId(`revision-ir-linea-${n}`)).toBeTruthy();
      expect(within(grupo).getAllByText(/^Ir al renglón/)).toHaveLength(1);
    }
    await pulsarYa('revision-ir-linea-2');
    expect(etapaActual()).toBe('productos');
    expect(desplegado('revision-linea-2-abrir')).toBe(true);
  });

  it('sends a document blocker answered in Leer back to Leer', async () => {
    const repo = fakeRepo();
    await revisarLeido(repo);
    await aCompra();
    await pulsarYa('revision-ir-leer');
    expect(etapaActual()).toBe('leer');
  });
});

describe('post-E2E: scrolling', () => {
  const scrollTo = jest.mocked(ScrollView.prototype.scrollTo);
  const layout = (id: string, y: number) => fireEvent(screen.getByTestId(id), 'layout', { nativeEvent: { layout: { x: 0, y, width: 390, height: 400 } } });

  it('starts every stage at the top instead of carrying the previous offset', async () => {
    const repo = fakeRepo();
    await revisarLeido(repo);
    scrollTo.mockClear();
    await aProductos();
    expect(scrollTo).toHaveBeenLastCalledWith({ y: 0, animated: false });
    scrollTo.mockClear();
    await pulsarYa('revision-accion-principal');
    expect(etapaActual()).toBe('compra');
    expect(scrollTo).toHaveBeenLastCalledWith({ y: 0, animated: false });
    scrollTo.mockClear();
    await pulsarYa('revision-volver');
    expect(scrollTo).toHaveBeenLastCalledWith({ y: 0, animated: false });
  });

  it('on a phone, "Ir al renglón" scrolls to that line once it is laid out, only once', async () => {
    const repo = fakeRepo();
    await revisarLeido(repo);
    await aCompra();
    scrollTo.mockClear();
    await pulsarYa('revision-ir-linea-3');
    expect(scrollTo).toHaveBeenCalledWith({ y: 0, animated: false });
    await act(async () => {
      layout('revision-etapa-productos', 100);
      layout('revision-productos-filas', 200);
      layout('revision-fila-3', 300);
    });
    expect(scrollTo).toHaveBeenLastCalledWith({ y: 600, animated: true });
    scrollTo.mockClear();
    await act(async () => {
      layout('revision-fila-3', 320);
    });
    expect(scrollTo).not.toHaveBeenCalled();
  });

  it('on an expanded screen the list and the detail scroll on their own, outside the page scroll', async () => {
    tamanoPantalla.mockReturnValue(TAMANO_AMPLIO);
    const repo = fakeRepo();
    await revisarLeido(repo);
    expect(aqui('revision-cuerpo')).toBe(true);
    await aProductos();
    expect(aqui('revision-cuerpo')).toBe(false);
    const lista = screen.getByTestId('revision-productos-lista');
    const detalle = screen.getByTestId('revision-productos-detalle');
    expect(lista.type).toBe('RCTScrollView');
    expect(detalle.type).toBe('RCTScrollView');
    expect(StyleSheet.flatten(lista.props.style)?.maxHeight).toBeUndefined();
    expect(StyleSheet.flatten(screen.getByTestId('revision-productos-paneles').props.style).flex).toBe(1);
    expect(within(lista).getByTestId('revision-linea-3')).toBeTruthy();
    expect(within(lista).getByTestId('revision-filtro-todos')).toBeTruthy();
    expect(screen.getByTestId('revision-pie')).toBeTruthy();
    await pulsarYa('revision-accion-principal');
    expect(etapaActual()).toBe('compra');
    expect(aqui('revision-cuerpo')).toBe(true);
  });
});

describe('post-E2E: explicit batch VAT and units for unresolved lines', () => {
  const forma = (lineas: RevisionContenido['lineas']) => lineas.map(l => ({ correcciones: l.correcciones, factorConversion: l.factorConversion, asociacion: l.asociacion }));
  const guardadas = (repo: Mocks) => (repo.guardarRevision.mock.calls[0][0] as GuardarRevisionInput).contenido.lineas;

  async function guardarDesdeProductos(): Promise<void> {
    await pulsarYa('revision-accion-principal');
    await pulsarYa('revision-guardar');
  }

  it('applies the chosen VAT and factor to every unresolved line at once, with the payload of the per-line chips', async () => {
    const repoLote = fakeRepo();
    const vista = await revisarLeido(repoLote);
    await aProductos();
    expect(textoDeId('revision-lote')).toMatch(/Aplicar a renglones pendientes/);
    expect(textoDeId('revision-lote')).toMatch(/No cambia los renglones que ya tienen IVA o unidades\./);
    expect(aqui('revision-lote-iva-aplicar')).toBe(false);
    expect(aqui('revision-lote-factor-aplicar')).toBe(false);
    await pulsarYa('revision-lote-iva-16');
    expect(textoDeId('revision-lote-iva-aplicar')).toBe('Aplicar 16 % a 3 renglones sin IVA');
    await pulsarYa('revision-lote-iva-aplicar');
    await pulsarYa('revision-lote-factor-uno');
    expect(textoDeId('revision-lote-factor-aplicar')).toBe('Aplicar 1 por 1 a 3 renglones sin factor');
    await pulsarYa('revision-lote-factor-aplicar');
    expect(aqui('revision-lote')).toBe(false);
    await guardarDesdeProductos();
    const lote = guardadas(repoLote);
    vista.unmount();

    const repoManual = fakeRepo();
    await revisarLeido(repoManual);
    await aProductos();
    for (const n of [1, 2, 3]) {
      await pulsarYa(`revision-linea-${n}-abrir`);
      await pulsarYa(`revision-iva-${n}-16`);
      await pulsarYa(`revision-factor-${n}-uno`);
    }
    await guardarDesdeProductos();
    expect(forma(lote)).toEqual(forma(guardadas(repoManual)));
    expect(lote[0].correcciones.tasaIva).toEqual({ valor: '16', motivo: 'IVA indicado manualmente: 16 %' });
  });

  it('never touches an explicit zero or a line whose factor was already confirmed', async () => {
    const repo = fakeRepo();
    await revisarLeido(repo);
    await aProductos();
    await pulsarYa('revision-linea-1-abrir');
    await pulsarYa('revision-iva-1-0');
    await pulsarYa('revision-linea-2-abrir');
    await pulsarYa('revision-factor-2-otro');
    await escribirYa('revision-linea-2-factor-valor', '2');
    await pulsarYa('revision-linea-2-factor-aplicar');
    await pulsarYa('revision-lote-iva-16');
    expect(textoDeId('revision-lote-iva-aplicar')).toBe('Aplicar 16 % a 2 renglones sin IVA');
    await pulsarYa('revision-lote-iva-aplicar');
    await pulsarYa('revision-lote-factor-uno');
    expect(textoDeId('revision-lote-factor-aplicar')).toBe('Aplicar 1 por 1 a 2 renglones sin factor');
    await pulsarYa('revision-lote-factor-aplicar');
    await guardarDesdeProductos();
    const lineas = guardadas(repo);
    expect(lineas.map(l => l.correcciones.tasaIva?.valor)).toEqual(['0', '16', '16']);
    expect(lineas[0].correcciones.tasaIva).toEqual({ valor: '0', motivo: 'IVA indicado manualmente: 0 %' });
    expect(lineas.map(l => l.factorConversion)).toEqual(['1', '2', '1']);
    for (const l of lineas) expect(l.asociacion.tipo).toBe('pendiente');
  });

  it('rejects an invalid custom rate without changing any line, then applies a valid one', async () => {
    const repo = fakeRepo();
    await revisarLeido(repo);
    await aProductos();
    await pulsarYa('revision-lote-iva-otro');
    expect(screen.getByTestId('revision-lote-iva-aplicar').props.accessibilityState?.disabled).toBe(true);
    await escribirYa('revision-lote-iva-valor', 'abc');
    await pulsarYa('revision-lote-iva-aplicar');
    expect(textoDeId('revision-aviso')).toMatch(/Ese valor no es válido: no se cambió ningún renglón\./);
    expect(textoDeId('revision-lote-iva-aplicar')).toBe('Aplicar abc % a 3 renglones sin IVA');
    await escribirYa('revision-lote-iva-valor', '8');
    await pulsarYa('revision-lote-iva-aplicar');
    await guardarDesdeProductos();
    for (const l of guardadas(repo)) expect(l.correcciones.tasaIva).toEqual({ valor: '8', motivo: 'IVA indicado manualmente: 8 %' });
  });

  it('cannot apply once the session no longer matches the invoice', async () => {
    const repo = fakeRepo();
    let uid: string | null = OWNER_A;
    const vista = await revisarLeido(repo, { getSessionUid: () => uid });
    await aProductos();
    await pulsarYa('revision-lote-iva-16');
    uid = OWNER_B;
    vista.rerenderUi(<FacturaRevisionView {...props(repo, { getSessionUid: () => uid })} />);
    await settle();
    const aplicar = screen.queryByTestId('revision-lote-iva-aplicar');
    expect(aplicar === null || aplicar.props.accessibilityState?.disabled === true).toBe(true);
  });
});

describe('post-E2E: read header and document access', () => {
  it('reports the effective read header when ready and null otherwise, without looping a parent that stores it', async () => {
    const repo = fakeRepo();
    repo.leerExtracciones.mockResolvedValue([extraccionRow()]);
    const onCabeceraLeida = jest.fn<void, [CabeceraLeida | null]>();
    let renders = 0;
    function Anfitrion({ facturaId = FACTURA_1 }: { facturaId?: string }): React.JSX.Element {
      const [cabecera, setCabecera] = React.useState<CabeceraLeida | null>(null);
      renders += 1;
      return (
        <>
          <Text testID="anfitrion-numero">{cabecera?.numeroDocumento ?? 'sin dato'}</Text>
          <FacturaRevisionView {...props(repo, { facturaId, onCabeceraLeida: valor => { onCabeceraLeida(valor); setCabecera(valor); } })} />
        </>
      );
    }
    const vista = renderWithProviders(<Anfitrion />);
    await settle();
    expect(onCabeceraLeida).toHaveBeenLastCalledWith(null);
    await pulsarYa(`revision-iniciar-${EXT}`);
    expect(onCabeceraLeida).toHaveBeenLastCalledWith({ proveedorNombre: 'Proveedor Uno', numeroDocumento: 'DOC-1', fechaEmision: '2026-10-15' });
    expect(textoDeId('anfitrion-numero')).toBe('DOC-1');
    expect(screen.getByText('Leído de la foto')).toBeTruthy();
    const llamadas = onCabeceraLeida.mock.calls.length;
    const vueltas = renders;
    vista.rerenderUi(<Anfitrion />);
    await settle();
    expect(onCabeceraLeida.mock.calls.length).toBe(llamadas);
    expect(renders - vueltas).toBeLessThanOrEqual(2);

    await typeId('revision-cab-numeroDocumento-valor', 'DOC-9');
    await typeId('revision-cab-numeroDocumento-motivo', 'Leído mal');
    await pressId('revision-cab-numeroDocumento-aplicar');
    expect(onCabeceraLeida).toHaveBeenLastCalledWith({ proveedorNombre: 'Proveedor Uno', numeroDocumento: 'DOC-9', fechaEmision: '2026-10-15' });

    repo.leerExtracciones.mockResolvedValue([]);
    vista.rerenderUi(<Anfitrion facturaId="f0000000-0000-4000-8000-000000000002" />);
    await settle();
    expect(onCabeceraLeida).toHaveBeenLastCalledWith(null);
    expect(textoDeId('anfitrion-numero')).toBe('sin dato');
  });

  it('asks the shell to show the document from Leer and Productos only when there is one', async () => {
    const onVerDocumento = jest.fn();
    const repo = fakeRepo();
    await revisarLeido(repo, { onVerDocumento });
    await pulsarYa('revision-ver-documento');
    expect(onVerDocumento).toHaveBeenCalledTimes(1);
    await aProductos();
    await pulsarYa('revision-ver-documento');
    expect(onVerDocumento).toHaveBeenCalledTimes(2);
    expect(repo.extraer).not.toHaveBeenCalled();
  });

  it('offers no document action without a document or without a viewer', async () => {
    const vista = await openView(fakeRepo(), { documento: null, onVerDocumento: jest.fn() });
    expect(aqui('revision-ver-documento')).toBe(false);
    vista.unmount();
    await openView(fakeRepo());
    expect(aqui('revision-ver-documento')).toBe(false);
  });

  it('reports the read header only while its extraction was read from the current document, through reloads (B1)', async () => {
    const repo = fakeRepo({ leerRevisiones: jest.fn(async () => [savedRevision()]), leerExtracciones: jest.fn(async () => [extraccionRow()]) });
    const onCabeceraLeida = jest.fn<void, [CabeceraLeida | null]>();
    const vista = await openView(repo, { onCabeceraLeida });
    expect(onCabeceraLeida).toHaveBeenLastCalledWith({ proveedorNombre: 'Proveedor Uno', numeroDocumento: 'DOC-1', fechaEmision: '2026-10-15' });

    // Same saved review and extraction (read from SHA), but the invoice now holds another photo: never reported as read from it.
    const lecturas = repo.leerRevisiones.mock.calls.length;
    vista.rerenderUi(<FacturaRevisionView {...props(repo, { onCabeceraLeida, documento: { ...DOC, sha256: 'b'.repeat(64) } })} />);
    await settle();
    expect(repo.leerRevisiones.mock.calls.length).toBeGreaterThan(lecturas);
    expect(onCabeceraLeida).toHaveBeenLastCalledWith(null);

    vista.rerenderUi(<FacturaRevisionView {...props(repo, { onCabeceraLeida, documento: null })} />);
    await settle();
    expect(onCabeceraLeida).toHaveBeenLastCalledWith(null);

    vista.rerenderUi(<FacturaRevisionView {...props(repo, { onCabeceraLeida })} />);
    await settle();
    expect(onCabeceraLeida).toHaveBeenLastCalledWith({ proveedorNombre: 'Proveedor Uno', numeroDocumento: 'DOC-1', fechaEmision: '2026-10-15' });
  });

  it('explains a partial catalog with the manual SKU way out and without promising coverage', async () => {
    const repo = fakeRepo({ buscarCandidatos: jest.fn(async () => ({ productos: [], parcial: true })) });
    await revisarLeido(repo);
    await aProductos();
    expect(textoDeId('revision-catalogo-parcial')).toBe('Catálogo parcial: no se pudo revisar todo el inventario. Si no ves el producto, búscalo por SKU; márcalo como nuevo solo si confirmas que no existe.');
  });
});
