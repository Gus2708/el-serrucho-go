import * as React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import { useConsultaProveedor } from './useConsultaProveedor';

type Fila = Record<string, unknown> & { id: string; tabla: string };

/** In-memory bridge table: only the calls useConsultaProveedor makes. The reuse window is not modeled. */
const mockDb = { filas: [] as Fila[], inserts: 0 };

jest.mock('../lib/supabase', () => ({ supabase: { from: (tabla: string) => mockFrom(tabla) } }));

function mockFrom(tabla: string) {
  const filtros: Record<string, unknown> = {};
  let nueva: Record<string, unknown> | null = null;
  const buscar = () => mockDb.filas.find(f => f.tabla === tabla && Object.entries(filtros).every(([k, v]) => f[k] === v));
  const q = {
    select: () => q,
    eq: (k: string, v: unknown) => { filtros[k] = v; return q; },
    gte: () => q,
    order: () => q,
    limit: () => q,
    insert: (fila: Record<string, unknown>) => { nueva = fila; return q; },
    maybeSingle: async () => ({ data: buscar() ?? null, error: null }),
    single: async () => {
      if (!nueva) return { data: buscar(), error: null };
      const fila: Fila = { ...nueva, id: `nueva-${++mockDb.inserts}`, tabla, status: 'pendiente', error: null, resultado: null };
      mockDb.filas.push(fila);
      return { data: fila, error: null };
    },
  };
  return q;
}

const clients: QueryClient[] = [];

function renderConsulta() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } } });
  clients.push(client);
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return renderHook(() => useConsultaProveedor('consultas_maxcam', 'P-1'), { wrapper });
}

beforeEach(() => {
  mockDb.inserts = 0;
  mockDb.filas = [{
    id: 'reciente', tabla: 'consultas_maxcam', codigo_interno: 'P-1', status: 'listo', error: null,
    resultado: { metodo: 'codigo', candidatos: [], consultado_en: '2026-10-22T12:00:00Z' },
  }];
});

afterEach(() => {
  clients.splice(0).forEach(c => c.clear());
  jest.useRealTimers();
});

describe('useConsultaProveedor', () => {
  it('consultar reutiliza la respuesta lista reciente sin pedirle de nuevo al proveedor', async () => {
    const { result } = renderConsulta();

    act(() => result.current.consultar());

    await waitFor(() => expect(result.current.consulta?.id).toBe('reciente'));
    expect(mockDb.inserts).toBe(0);
    expect(result.current.esperando).toBe(false);
  });

  it('reintentar pide una respuesta nueva aunque haya una lista reciente', async () => {
    const { result } = renderConsulta();
    act(() => result.current.consultar());
    await waitFor(() => expect(result.current.consulta?.id).toBe('reciente'));

    act(() => result.current.reintentar());

    await waitFor(() => expect(result.current.consulta?.id).toBe('nueva-1'));
    expect(mockDb.inserts).toBe(1);
    expect(result.current.esperando).toBe(true);
  });

  it('reintentar tras agotar el tiempo de espera vuelve a esperar una consulta nueva', async () => {
    jest.useFakeTimers();
    mockDb.filas = [];
    const { result } = renderConsulta();
    act(() => result.current.consultar());
    await waitFor(() => expect(result.current.consulta?.id).toBe('nueva-1'));

    await act(async () => { jest.advanceTimersByTime(151_000); });
    expect(result.current.vencida).toBe(true);

    act(() => result.current.reintentar());

    expect(result.current.vencida).toBe(false);
    await waitFor(() => expect(result.current.consulta?.id).toBe('nueva-2'));
    expect(result.current.esperando).toBe(true);
  });
});
