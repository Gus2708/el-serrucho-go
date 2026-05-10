import { create } from 'zustand';
import { StockFilter } from './useProductos';

interface InventarioState {
  search: string;
  filter: StockFilter;
  setSearch: (search: string) => void;
  setFilter: (filter: StockFilter) => void;
  reset: () => void;
}

export const useInventarioStore = create<InventarioState>((set) => ({
  search: '',
  filter: 'todos',
  setSearch: (search) => set({ search }),
  setFilter: (filter) => set({ filter }),
  reset: () => set({ search: '', filter: 'todos' }),
}));
