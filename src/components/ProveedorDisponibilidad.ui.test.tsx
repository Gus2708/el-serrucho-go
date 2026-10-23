import * as React from 'react';
import { StyleSheet } from 'react-native';
import type { StyleProp, TextStyle, ViewStyle } from 'react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { ProveedorDisponibilidad } from './ProveedorDisponibilidad';
import { ThemeProvider } from '../theme/ThemeContext';
import { elSerrucho } from '../theme/brands/el-serrucho';

type Candidato = { sku: string; nombre: string; similitud: number; disponible: boolean; precio: number | null };
type Fila = Record<string, unknown> & { id: string };

/** In-memory bridge table: only the calls useConsultaProveedor makes. The reuse window is not modeled. */
const mockDb = { filas: [] as Fila[], inserts: 0 };

jest.mock('../lib/supabase', () => ({ supabase: { from: () => mockFrom() } }));

function mockFrom() {
  const filtros: Record<string, unknown> = {};
  let nueva: Record<string, unknown> | null = null;
  const buscar = () => mockDb.filas.find(f => Object.entries(filtros).every(([k, v]) => f[k] === v));
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
      const fila: Fila = { ...nueva, id: `nueva-${++mockDb.inserts}`, status: 'pendiente', error: null, resultado: null };
      mockDb.filas.push(fila);
      return { data: fila, error: null };
    },
  };
  return q;
}

const LARGO = 'Llave ajustable cromada de 12 pulgadas con mango ergonómico antideslizante y escala métrica';

function sembrarListo(candidatos: Candidato[]): void {
  mockDb.filas = [{
    id: 'reciente', codigo_interno: 'P-1', status: 'listo', error: null,
    resultado: { metodo: 'codigo', candidatos, consultado_en: '2026-10-22T12:00:00Z' },
  }];
}

const clients: QueryClient[] = [];

function renderTarjeta() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false, gcTime: 0 } } });
  clients.push(client);
  const rendered = render(
    <QueryClientProvider client={client}>
      <ThemeProvider>
        <ProveedorDisponibilidad<Candidato>
          tabla="consultas_maxcam"
          codigoInterno="P-1"
          titulo="Disponibilidad en Maxcam (BQ)"
          ayuda="Consulta si Maxcam lo tiene."
          nota="Solo cuenta el stock de Barquisimeto."
          sinResultado="No se encontró un equivalente en el catálogo de Maxcam."
          badge={(c) => (c.disponible ? 'Disponible · 3 uds' : 'Agotado en BQ')}
        />
      </ThemeProvider>
    </QueryClientProvider>,
  );
  return { ...rendered, client };
}

/** Waits inside act's scope until react-query has no request in flight, so no update lands after the test. */
async function esperarInactivo(client: QueryClient): Promise<void> {
  await waitFor(() => {
    expect(client.isMutating()).toBe(0);
    expect(client.isFetching()).toBe(0);
  });
}

function estilo(node: { props: { style?: unknown } }): ViewStyle & TextStyle {
  return StyleSheet.flatten(node.props.style as StyleProp<ViewStyle & TextStyle>) ?? {};
}

beforeEach(() => {
  mockDb.inserts = 0;
  sembrarListo([]);
});

afterEach(() => {
  clients.splice(0).forEach(c => c.clear());
});

describe('tarjeta de disponibilidad en un proveedor', () => {
  it('Consultar muestra la respuesta lista reciente sin pedir otra', async () => {
    renderTarjeta();

    fireEvent.press(screen.getByRole('button', { name: 'Consultar' }));

    expect(await screen.findByText('No se encontró un equivalente en el catálogo de Maxcam.')).toBeTruthy();
    expect(mockDb.inserts).toBe(0);
  });

  it('un solo toque en Reintentar envía una consulta nueva', async () => {
    const { client } = renderTarjeta();
    fireEvent.press(screen.getByRole('button', { name: 'Consultar' }));
    await screen.findByText('No se encontró un equivalente en el catálogo de Maxcam.');

    fireEvent.press(screen.getByRole('button', { name: 'Reintentar' }));

    expect(await screen.findByText('Consultando… puede tardar unos segundos.')).toBeTruthy();
    expect(mockDb.inserts).toBe(1);
    expect(screen.queryByText('No se encontró un equivalente en el catálogo de Maxcam.')).toBeNull();
    await esperarInactivo(client);
  });

  it('un solo toque en Consultar de nuevo envía una consulta nueva', async () => {
    sembrarListo([{ sku: 'MX-1', nombre: LARGO, similitud: 1, disponible: true, precio: 12.5 }]);
    const { client } = renderTarjeta();
    fireEvent.press(screen.getByRole('button', { name: 'Consultar' }));
    await screen.findByText(LARGO);

    fireEvent.press(screen.getByRole('button', { name: 'Consultar de nuevo' }));

    expect(await screen.findByText('Consultando… puede tardar unos segundos.')).toBeTruthy();
    expect(mockDb.inserts).toBe(1);
    await esperarInactivo(client);
  });

  it('respeta el margen lateral y el radio de las tarjetas vecinas', () => {
    renderTarjeta();

    const card = estilo(screen.getByTestId('proveedor-disponibilidad'));
    expect(card.marginHorizontal).toBe(16);
    expect(card.borderRadius).toBe(14);
  });

  it('las acciones son botones accesibles de al menos 44 de alto', async () => {
    sembrarListo([{ sku: 'MX-1', nombre: LARGO, similitud: 1, disponible: false, precio: null }]);
    renderTarjeta();
    const consultar = screen.getByRole('button', { name: 'Consultar' });
    expect(estilo(consultar).minHeight).toBeGreaterThanOrEqual(44);

    fireEvent.press(consultar);
    await screen.findByText(LARGO);

    expect(estilo(screen.getByRole('button', { name: 'Consultar de nuevo' })).minHeight).toBeGreaterThanOrEqual(44);
  });

  it('nombres largos y etiquetas se ajustan al ancho y la nota al pie se lee', async () => {
    sembrarListo([{ sku: 'MX-1', nombre: LARGO, similitud: 1, disponible: false, precio: null }]);
    renderTarjeta();
    fireEvent.press(screen.getByRole('button', { name: 'Consultar' }));

    const nombre = await screen.findByText(LARGO);
    expect(nombre.props.numberOfLines).toBe(2);
    const badge = estilo(screen.getByText('Agotado en BQ').parent!.parent as never);
    expect(badge.maxWidth).toBe('100%');
    const nota = estilo(screen.getByText(/Solo cuenta el stock de Barquisimeto\./));
    expect(nota.color).toBe(elSerrucho.colors.textMuted);
  });
});
