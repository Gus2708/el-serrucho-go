(global as any).__DEV__ = true;

const mockUpdate = jest.fn();
const mockEq = jest.fn();
const mockIn = jest.fn();

let mockDemoActiveValue = false;

jest.mock('../demo/useDemoStore', () => ({
  isDemoActive: () => mockDemoActiveValue,
}));

jest.mock('../lib/supabase', () => ({
  supabase: {
    from: jest.fn((table: string) => ({
      update: (...args: any[]) => {
        mockUpdate(table, ...args);
        return {
          eq: (col: string, val: any) => {
            mockEq(col, val);
            return {
              eq: (col2: string, val2: any) => {
                mockEq(col2, val2);
                return Promise.resolve({ error: null });
              },
              then: (resolve: (r: { error: null }) => void) => resolve({ error: null }),
            };
          },
          in: (col: string, val: any) => {
            mockIn(col, val);
            return Promise.resolve({ error: null });
          },
        };
      },
    })),
  },
}));

import { renderHook, act } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import { useResolverSolicitud } from './useResolverSolicitud';

let activeQueryClient: QueryClient;

function createWrapper() {
  activeQueryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false, gcTime: 0 },
    },
  });
  return ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: activeQueryClient }, children);
}

describe('useResolverSolicitud - descartar y descartar todas', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockDemoActiveValue = false;
  });

  afterEach(() => {
    if (activeQueryClient) {
      activeQueryClient.clear();
    }
  });

  it('descartarSolicitud updates status to descartado for single id', async () => {
    const { result } = renderHook(() => useResolverSolicitud(), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      await result.current.descartarSolicitud(42);
    });

    expect(mockUpdate).toHaveBeenCalledWith('solicitudes_ayuda', { status: 'descartado' });
    expect(mockEq).toHaveBeenCalledWith('id', 42);
    expect(mockEq).toHaveBeenCalledWith('status', 'pendiente');
  });

  it('descartarTodasSolicitudes updates status for given ids', async () => {
    const { result } = renderHook(() => useResolverSolicitud(), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      await result.current.descartarTodasSolicitudes([1, 2, 3]);
    });

    expect(mockUpdate).toHaveBeenCalledWith('solicitudes_ayuda', { status: 'descartado' });
    expect(mockIn).toHaveBeenCalledWith('id', [1, 2, 3]);
  });

  it('descartarTodasSolicitudes does not call supabase if demo is active', async () => {
    mockDemoActiveValue = true;
    const { result } = renderHook(() => useResolverSolicitud(), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      await result.current.descartarTodasSolicitudes([10, 20]);
    });

    expect(mockUpdate).not.toHaveBeenCalled();
  });
});
