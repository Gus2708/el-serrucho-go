import { create } from 'zustand';
import { StockFilter } from './useProductos';

interface InventarioState {
  search: string;
  filter: StockFilter;
  scrollOffset: number;
  scrollOffsetReportes: number;
  scrollOffsetVentas: number;
  scrollOffsetDashboard: number;
  scrollOffsetAlertas: number;
  scrollOffsetOrdenes: number;
  setSearch: (search: string) => void;
  setFilter: (filter: StockFilter) => void;
  setScrollOffset: (offset: number) => void;
  setScrollOffsetReportes: (offset: number) => void;
  setScrollOffsetVentas: (offset: number) => void;
  setScrollOffsetDashboard: (offset: number) => void;
  setScrollOffsetAlertas: (offset: number) => void;
  setScrollOffsetOrdenes: (offset: number) => void;
  reset: () => void;
}

export const useInventarioStore = create<InventarioState>((set) => ({
  search: '',
  filter: 'todos',
  scrollOffset: 0,
  scrollOffsetReportes: 0,
  scrollOffsetVentas: 0,
  scrollOffsetDashboard: 0,
  scrollOffsetAlertas: 0,
  scrollOffsetOrdenes: 0,
  setSearch: (search) => set({ search }),
  setFilter: (filter) => set({ filter }),
  setScrollOffset: (scrollOffset) => set({ scrollOffset }),
  setScrollOffsetReportes: (scrollOffsetReportes) => set({ scrollOffsetReportes }),
  setScrollOffsetVentas: (scrollOffsetVentas) => set({ scrollOffsetVentas }),
  setScrollOffsetDashboard: (scrollOffsetDashboard) => set({ scrollOffsetDashboard }),
  setScrollOffsetAlertas: (scrollOffsetAlertas) => set({ scrollOffsetAlertas }),
  setScrollOffsetOrdenes: (scrollOffsetOrdenes) => set({ scrollOffsetOrdenes }),
  reset: () => set({ 
    search: '', 
    filter: 'todos', 
    scrollOffset: 0, 
    scrollOffsetReportes: 0,
    scrollOffsetVentas: 0,
    scrollOffsetDashboard: 0,
    scrollOffsetAlertas: 0,
    scrollOffsetOrdenes: 0
  }),
}));
