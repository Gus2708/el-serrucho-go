import * as React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react-native';
import { ProveedoresDisponibilidad } from './ProveedoresDisponibilidad';
import { ThemeProvider } from '../theme/ThemeContext';

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
  it('muestra ambas tarjetas para productos con stock suficiente sin consultar al proveedor', async () => {
    renderProveedores(20);

    expect(await screen.findByText('Disponibilidad en Maxcam (BQ)')).toBeTruthy();
    expect(await screen.findByText('Disponibilidad en Corporación Norte')).toBeTruthy();
    expect(screen.getAllByRole('button', { name: 'Consultar' })).toHaveLength(2);
    expect(mockRpc).not.toHaveBeenCalled();
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it('muestra ambas tarjetas para productos agotados sin consultar al proveedor en render', async () => {
    renderProveedores(0);

    expect(await screen.findByText('Disponibilidad en Maxcam (BQ)')).toBeTruthy();
    expect(await screen.findByText('Disponibilidad en Corporación Norte')).toBeTruthy();
    expect(screen.getAllByRole('button', { name: 'Consultar' })).toHaveLength(2);
    expect(mockRpc).not.toHaveBeenCalled();
    expect(mockFrom).not.toHaveBeenCalled();
  });
});
