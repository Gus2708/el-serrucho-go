import * as React from 'react';
import { StyleSheet } from 'react-native';
import { act, fireEvent, screen, within } from '@testing-library/react-native';
import ProductoPickerModal from './ProductoPickerModal';
import type { Producto } from '../lib/producto';
import { renderWithProviders } from '../test-utils/facturaUiHarness';

interface Lectura {
  productos?: Producto[];
  isLoading: boolean;
  isFetchingMore: boolean;
  hasMore: boolean;
  fetchMore: jest.Mock;
  error: unknown;
}

let mockLectura: Lectura;
const mockBusquedas: string[] = [];

jest.mock('../lib/supabase', () => ({ supabase: { from: jest.fn() } }));
jest.mock('./BarcodeScannerModal', () => ({ BarcodeScannerModal: () => null }));
jest.mock('../hooks/useProductos', () => {
  const actual = jest.requireActual('../hooks/useProductos');
  return {
    ...actual,
    useProductos: (search: string) => {
      mockBusquedas.push(search);
      return mockLectura;
    },
  };
});

function producto(codigo_interno: string, descripcion: string, over: Partial<Producto> = {}): Producto {
  return { codigo_interno, descripcion, unidad: 'UND', codigo_barras: '', costo: 1, precio_venta: 2, existencia: 4, actualizado_en: '2026-01-01T00:00:00Z', ...over };
}

function lectura(over: Partial<Lectura> = {}): Lectura {
  return { productos: [], isLoading: false, isFetchingMore: false, hasMore: false, fetchMore: jest.fn(), error: null, ...over };
}

const ID = 'producto-picker';
const textos = (testID: string): string[] => within(screen.getByTestId(testID)).queryAllByText(/./).map(el => [el.props.children].flat().join(''));

function abrir(over: Partial<React.ComponentProps<typeof ProductoPickerModal>> = {}) {
  const props = { visible: true, titulo: 'Buscar en inventario', onClose: jest.fn(), onSelect: jest.fn(), ...over };
  const view = renderWithProviders(<ProductoPickerModal {...props} />);
  return { props, view };
}

beforeEach(() => {
  mockLectura = lectura();
  mockBusquedas.length = 0;
});

describe('shared inventory picker (S7)', () => {
  it('lists inventory rows by name with code, barcode and stock, and returns the full product on selection', () => {
    const taladro = producto('TAL-500', 'TALADRO PERCUTOR 500W', { codigo_barras: '7591', existencia: 0, precio_venta: 48.5 });
    mockLectura = lectura({ productos: [taladro, producto('CL-1', 'CLAVO 2 PULGADAS', { existencia: -3 })] });
    const { props } = abrir();
    expect(textos(`${ID}-fila-TAL-500`)).toEqual(['TALADRO PERCUTOR 500W', 'TAL-500  ·  CB: 7591', '0 UND']);
    fireEvent.press(screen.getByTestId(`${ID}-fila-TAL-500`));
    expect(props.onSelect).toHaveBeenCalledWith(taladro);
    // Purchases may restock a product with zero or negative stock.
    fireEvent.press(screen.getByTestId(`${ID}-fila-CL-1`));
    expect(props.onSelect).toHaveBeenCalledTimes(2);
  });

  it('searches the typed name, code or barcode through the inventory query', () => {
    abrir({ busquedaInicial: 'taladro' });
    expect(mockBusquedas.at(-1)).toBe('TALADRO');
    fireEvent.changeText(screen.getByTestId(`${ID}-buscar`), 'tal 500');
    expect(mockBusquedas.at(-1)).toBe('TAL 500');
    expect(screen.getByTestId(`${ID}-buscar`).props.accessibilityLabel).toBe('Buscar por nombre, código o código de barras');
  });

  it('shows POS placeholders disabled, never selectable', () => {
    mockLectura = lectura({ productos: [producto('P0', '..', { es_placeholder: true })] });
    const { props } = abrir();
    const fila = screen.getByTestId(`${ID}-fila-P0`);
    expect(fila.props.accessibilityState).toMatchObject({ disabled: true });
    fireEvent.press(fila);
    expect(props.onSelect).not.toHaveBeenCalled();
  });

  it('keeps loading, empty and failed reads distinct; a failure offers a retry and never reads as "no product"', () => {
    mockLectura = lectura({ isLoading: true });
    const { view } = abrir({ busquedaInicial: 'tornillo' });
    expect(textos(`${ID}-cargando`)).toEqual(['Buscando en el inventario…']);
    expect(screen.queryByTestId(`${ID}-vacio`)).toBeNull();

    mockLectura = lectura({ error: new Error('PRIVATE permission denied') });
    view.rerenderUi(<ProductoPickerModal visible titulo="Buscar en inventario" busquedaInicial="tornillo" onClose={jest.fn()} onSelect={jest.fn()} />);
    expect(textos(`${ID}-error`).join(' ')).toBe('No se pudo leer el inventario. Revisa la conexión o tus permisos. Reintentar');
    expect(screen.queryByTestId(`${ID}-vacio`)).toBeNull();
    expect(JSON.stringify(screen.toJSON())).not.toContain('PRIVATE');
    view.invalidate.mockClear();
    fireEvent.press(screen.getByTestId(`${ID}-reintentar`));
    expect(view.invalidate).toHaveBeenCalledWith({ queryKey: ['productos', 'TORNILLO'] });

    mockLectura = lectura();
    view.rerenderUi(<ProductoPickerModal visible titulo="Buscar en inventario" busquedaInicial="tornillo" onClose={jest.fn()} onSelect={jest.fn()} />);
    expect(textos(`${ID}-vacio`)).toEqual(['Sin resultados. Prueba con otra palabra o con el código. Que no aparezca aquí no prueba que el producto no exista.']);
  });

  it('loads more pages on request and keeps a failed next page retryable without hiding the rows already shown', () => {
    const fetchMore = jest.fn();
    mockLectura = lectura({ productos: [producto('A1', 'ALICATE')], hasMore: true, fetchMore });
    const { view } = abrir();
    fireEvent.press(screen.getByTestId(`${ID}-mas`));
    expect(fetchMore).toHaveBeenCalledTimes(1);

    mockLectura = lectura({ productos: [producto('A1', 'ALICATE')], hasMore: true, isFetchingMore: true, fetchMore });
    view.rerenderUi(<ProductoPickerModal visible titulo="Buscar en inventario" onClose={jest.fn()} onSelect={jest.fn()} />);
    expect(screen.getByTestId(`${ID}-mas`).props.accessibilityState).toMatchObject({ disabled: true, busy: true });

    mockLectura = lectura({ productos: [producto('A1', 'ALICATE')], hasMore: true, error: new Error('red'), fetchMore });
    view.rerenderUi(<ProductoPickerModal visible titulo="Buscar en inventario" onClose={jest.fn()} onSelect={jest.fn()} />);
    expect(screen.getByTestId(`${ID}-fila-A1`)).toBeTruthy();
    expect(textos(`${ID}-mas`)).toEqual(['No se pudo cargar más. Reintentar']);
    fireEvent.press(screen.getByTestId(`${ID}-mas`));
    expect(fetchMore).toHaveBeenCalledTimes(2);
  });

  it('closes without choosing anything', async () => {
    mockLectura = lectura({ productos: [producto('A1', 'ALICATE')] });
    const { props } = abrir();
    await act(async () => {
      fireEvent.press(screen.getByTestId(`${ID}-cerrar`));
    });
    expect(props.onClose).toHaveBeenCalledTimes(1);
    expect(props.onSelect).not.toHaveBeenCalled();
    expect(screen.getByTestId(`${ID}-cerrar`).props.accessibilityLabel).toBe('Cerrar sin elegir');
  });
});

describe('search bar layout (NEW-V2)', () => {
  it('keeps the scanner outside the search field with a full touch target and a short placeholder', () => {
    abrir();
    const campo = screen.getByTestId(`${ID}-busqueda`);
    expect(within(campo).queryByTestId(`${ID}-escanear`)).toBeNull();
    const escanear = StyleSheet.flatten(screen.getByTestId(`${ID}-escanear`).props.style);
    expect(escanear.minWidth).toBeGreaterThanOrEqual(44);
    expect(escanear.minHeight).toBeGreaterThanOrEqual(44);
    expect(screen.getByTestId(`${ID}-buscar`).props.placeholder).toBe('Nombre, código o barras');
    expect(screen.getByTestId(`${ID}-buscar`).props.accessibilityLabel).toBe('Buscar por nombre, código o código de barras');
    expect(screen.getByTestId(`${ID}-escanear`).props.accessibilityLabel).toBe('Escanear código de barras');
  });
});
