import * as React from 'react';
import { StyleSheet } from 'react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react-native';
import { ProveedoresDisponibilidad } from './ProveedoresDisponibilidad';
import { ThemeProvider } from '../theme/ThemeContext';
import { elSerrucho } from '../theme/brands/el-serrucho';

const mockRpc = jest.fn();
const mockFrom = jest.fn();

jest.mock('../lib/supabase', () => ({
  supabase: { rpc: (...args: unknown[]) => mockRpc(...args), from: (...args: unknown[]) => mockFrom(...args) },
}));

const clients: QueryClient[] = [];

function renderProveedores(existencia: number) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  clients.push(client);
  return render(
    <QueryClientProvider client={client}>
      <ThemeProvider>
        <ProveedoresDisponibilidad codigoInterno="P-1" existencia={existencia} />
      </ThemeProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  mockRpc.mockReset();
  mockFrom.mockReset();
});

afterEach(() => {
  clients.splice(0).forEach(c => c.clear());
});

describe('tarjetas de proveedores en el detalle del producto', () => {
  it('con stock suficiente no muestra nada ni consulta la elegibilidad', () => {
    renderProveedores(6);

    expect(screen.toJSON()).toBeNull();
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it('un producto de rotación baja muestra una nota legible con margen lateral', async () => {
    mockRpc.mockResolvedValue({ data: { elegible: false, motivo: 'baja_rotacion', facturas: 1, ultima_venta: null }, error: null });
    renderProveedores(0);

    const nota = await screen.findByText(/no se consulta a los proveedores/);
    const estilo = StyleSheet.flatten(nota.props.style);
    expect(estilo.marginHorizontal).toBe(16);
    expect(estilo.color).toBe(elSerrucho.colors.textMuted);
    expect(nota.props.children).toEqual(expect.arrayContaining(['factura']));
  });

  it('un producto elegible muestra ambas tarjetas sin consultar a los proveedores', async () => {
    mockRpc.mockResolvedValue({ data: { elegible: true, motivo: 'rotacion', facturas: 8, ultima_venta: null }, error: null });
    renderProveedores(2);

    expect(await screen.findByText('Disponibilidad en Maxcam (BQ)')).toBeTruthy();
    expect(screen.getAllByRole('button', { name: 'Consultar' })).toHaveLength(2);
    expect(mockRpc).toHaveBeenCalledWith('proveedor_elegible', { p_codigo: 'P-1' });
    expect(mockFrom).not.toHaveBeenCalled();
  });
});
