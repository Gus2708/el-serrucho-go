/**
 * Source provenance of the read header across the REAL editor, the REAL review view and the REAL review hook. Only the
 * transport is fake: the harness Supabase client and the revision repository object behind the hook.
 *
 * Regression for V2 blocker B1: a header read from an older photo must never be shown, or offered for adoption, as read
 * from the current photo, after the photo was replaced and saved or removed (including a confirm dialog still open).
 */
import * as React from 'react';
import { fireEvent, screen } from '@testing-library/react-native';
import FacturaProveedorEditor from './FacturaProveedorEditor';
import { publishFacturaSession } from '../hooks/useFacturasProveedor';
import { crearRevisionDesdeExtraccion } from '../lib/facturaRevision';
import type { ExtraccionRow, RevisionRow } from '../lib/facturaRevisionRepository';
import type { FacturaRecord } from '../lib/facturaProveedor';
import { OWNER_A, backend, pressAlertButton, renderWithProviders, resetBackend, settle, spyOnAlert } from '../test-utils/facturaUiHarness';

jest.mock('../lib/supabase', () => ({ supabase: require('../test-utils/facturaUiHarness').backend.client }));
jest.mock('@react-native-async-storage/async-storage', () => ({ __esModule: true, default: require('../test-utils/facturaUiHarness').asyncStorage }));
jest.mock('./FacturaCamaraFoto', () => ({ __esModule: true, default: () => null }));
jest.mock('./BarcodeScannerModal', () => ({ BarcodeScannerModal: () => null }));
// Fake transport for the revision repository only; the hook itself is the real one.
jest.mock('../hooks/useFacturaRevision', () => {
  const actual = jest.requireActual('../hooks/useFacturaRevision');
  const g = globalThis as unknown as { __repoProcedencia: Record<string, jest.Mock> };
  const proxy = new Proxy({}, { get: (_t, k: string) => (...a: unknown[]) => g.__repoProcedencia[k](...a) });
  return { ...actual, facturaRevisionRepository: proxy };
});

const SHA = 'a'.repeat(64);
const SHA_B = 'b'.repeat(64);
const EXT = 'e0000000-0000-4000-8000-000000000001';
const FP = 'f'.repeat(64);
let idLinea = 0;
const newId = () => `90000000-0000-4000-8000-${String(++idLinea).padStart(12, '0')}`;

function payload() {
  const linea = (i: number) => ({ numeroLinea: i, pagina: 1, codigoProveedor: `Z-${i}`, descripcion: `Articulo ${i}`, cantidad: '2', unidad: 'UND', precioUnitario: '1.50', descuentos: [], tasaIva: null, total: '3.00', incertidumbre: { confianzaLectura: 0.6, advertencias: [], campoDudoso: [] } });
  return {
    version: 1,
    cabecera: { proveedorNombre: 'CORPORACION NORTE', proveedorRif: null, numeroDocumento: '48615', numeroControl: null, fechaEmision: '2026-11-13', moneda: 'USD', tasaCambio: null, subtotal: null, descuentos: [], impuestos: [], total: null },
    lineas: [linea(1), linea(2), linea(3)],
    metadatos: { totalPaginas: 1, paginasProcesadas: [1], documentoCompleto: true, advertencias: [], confianzaGlobal: null },
  } as never;
}

/** The extraction row read from the photo whose hash is `sha`. */
function extraccion(sha: string): ExtraccionRow {
  return { id: EXT, solicitudId: 's0000000-0000-4000-8000-000000000001', estado: 'completado', facturaVersion: 3, documentoSha256: sha, resultado: payload(), errorCodigo: null, iniciadoEn: '2026-11-13T10:00:00Z' };
}

/** The saved review built from that extraction, as the server returns it. */
function revision(sha: string): RevisionRow {
  const base = crearRevisionDesdeExtraccion(payload(), EXT, newId);
  if (!base.ok) throw new Error('fixture');
  return { revision: 1, clave: 'c0000000-0000-4000-8000-0000000000aa', facturaVersion: 3, extraccionId: EXT, documentoSha256: sha, contenido: base.contenido, fingerprint: FP, motivo: null, creadoPor: OWNER_A, aprobadoPor: null, aprobadoEn: null };
}

function repo(fuente: string) {
  const r = {
    leerRevisiones: jest.fn(async () => [revision(fuente)]),
    leerExtracciones: jest.fn(async () => [extraccion(fuente)]),
    guardarRevision: jest.fn(async () => ({ revision: 2, fingerprint: FP, replay: false })),
    aprobarRevision: jest.fn(),
    extraer: jest.fn(),
    buscarCandidatos: jest.fn(async () => ({ productos: [], parcial: false })),
    leerColisionesBarras: jest.fn(async (codes: string[]) => Object.fromEntries(codes.map(c => [c, { productos: [], completo: true }]))),
  };
  (globalThis as unknown as { __repoProcedencia: unknown }).__repoProcedencia = r;
  return r;
}

let facturaN = 0;
function record(over: Partial<FacturaRecord> = {}): FacturaRecord {
  const id = `f3000000-0000-4000-8000-${String(++facturaN).padStart(12, '0')}`;
  return { id, version: 3, proveedor_codigo: null, proveedor_nombre: 'CORPORACION NORTE C.A', numero_documento: null, numero_control: null, fecha_documento: null, moneda: 'USD', notas: null, documento_path: `${OWNER_A}/${id}/d.jpg`, documento_nombre: 'foto.jpg', documento_mime: 'image/jpeg', documento_bytes: 1000, documento_sha256: SHA, lineas: [], ...over };
}

let alerta: jest.SpyInstance;
beforeEach(() => {
  resetBackend();
  alerta = spyOnAlert();
  publishFacturaSession({ user: { id: OWNER_A } });
  backend.bucket.createSignedUrl.mockImplementation(async () => ({ data: { signedUrl: 'https://private.test/doc' }, error: null }));
});
afterEach(() => alerta.mockRestore());

const valor = (label: string): string => screen.getAllByLabelText(label)[0].props.value as string;
const pulsar = async (id: string): Promise<void> => {
  fireEvent.press(screen.getAllByTestId(id)[0]);
  await settle();
};
const notaLeida = () => screen.queryByTestId('factura-leido-numeroDocumento');
const botonAdoptar = () => screen.queryByTestId('factura-completar-leido');

/** Opens the saved invoice, enters the review (which loads the saved revision) and comes back to the form step. */
async function abrirYVolverAlFormulario(rec: FacturaRecord): Promise<void> {
  renderWithProviders(<FacturaProveedorEditor facturaId={rec.id} record={rec} ownerId={OWNER_A} onClose={jest.fn()} onReload={jest.fn()} />);
  await screen.findByLabelText('Número de factura');
  await pulsar('factura-abrir-revision');
  await settle();
  await pulsar('factura-paso-factura');
}

describe('read header provenance: real editor + real review', () => {
  it('shows the header read from the current photo and adopts it only on explicit confirmation (control)', async () => {
    const r = repo(SHA);
    await abrirYVolverAlFormulario(record());
    expect(notaLeida()).toHaveTextContent('Leído de la foto: 48615');
    expect(valor('Número de factura')).toBe('');
    await pulsar('factura-completar-leido');
    expect(valor('Número de factura')).toBe('');
    await pressAlertButton(alerta, 'Completar');
    await settle();
    expect(valor('Número de factura')).toBe('48615');
    expect(valor('Fecha')).toBe('2026-11-13');
    expect(valor('Proveedor')).toBe('CORPORACION NORTE C.A');
    expect(r.extraer).not.toHaveBeenCalled();
    expect(r.guardarRevision).not.toHaveBeenCalled();
    expect(backend.rpc).not.toHaveBeenCalled();
  });

  it('after the photo was replaced and saved, the old photo header is neither shown nor adoptable', async () => {
    // Saved invoice v4 with the new photo (SHA_B); the latest review and its extraction belong to the old photo (SHA).
    const r = repo(SHA);
    await abrirYVolverAlFormulario(record({ version: 4, documento_sha256: SHA_B }));
    expect(r.leerRevisiones).toHaveBeenCalled();
    expect(notaLeida()).toBeNull();
    expect(botonAdoptar()).toBeNull();
    expect(screen.queryByText(/Factura 48615 \(leída\)/)).toBeNull();
    expect(valor('Número de factura')).toBe('');
  });

  it('after "Quitar" the header disappears and stays gone once the review has reloaded', async () => {
    const r = repo(SHA);
    await abrirYVolverAlFormulario(record());
    expect(notaLeida()).not.toBeNull();
    const lecturas = r.leerRevisiones.mock.calls.length;
    await pulsar('factura-quitar-documento');
    await settle();
    expect(r.leerRevisiones.mock.calls.length).toBeGreaterThan(lecturas);
    expect(notaLeida()).toBeNull();
    expect(botonAdoptar()).toBeNull();
    expect(screen.queryByText(/Factura 48615 \(leída\)/)).toBeNull();
  });

  it('a confirmation still open when the photo is removed fills nothing', async () => {
    repo(SHA);
    await abrirYVolverAlFormulario(record());
    fireEvent.changeText(screen.getAllByLabelText('Proveedor')[0], 'PROVEEDOR ESCRITO');
    await pulsar('factura-completar-leido');
    await pulsar('factura-quitar-documento');
    await pressAlertButton(alerta, 'Completar');
    await settle();
    expect(valor('Número de factura')).toBe('');
    expect(valor('Fecha')).toBe('');
    expect(valor('Proveedor')).toBe('PROVEEDOR ESCRITO');
  });
});
