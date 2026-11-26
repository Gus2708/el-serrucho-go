import * as React from 'react';
import { StyleSheet } from 'react-native';
import { fireEvent, screen, within } from '@testing-library/react-native';
import { FacturaEstadoPill, FacturaPasos, type PasoFactura } from './FacturaPasos';
import { renderWithProviders } from '../test-utils/facturaUiHarness';
import { elSerrucho } from '../theme/brands/el-serrucho';

jest.mock('../lib/supabase', () => ({ supabase: require('../test-utils/facturaUiHarness').backend.client }));

const PASOS: PasoFactura[] = ['factura', 'productos', 'compra'];

function renderPasos(seleccionado: PasoFactura, deshabilitados: PasoFactura[] = []) {
  const onSeleccionar = jest.fn();
  renderWithProviders(<FacturaPasos seleccionado={seleccionado} onSeleccionar={onSeleccionar} deshabilitados={deshabilitados} />);
  return onSeleccionar;
}

describe('FacturaPasos', () => {
  it('muestra exactamente tres pasos visibles sin Leer y marca solo el seleccionado', () => {
    renderPasos('productos');

    expect(screen.getByLabelText('Paso 1: Factura')).toBeTruthy();
    expect(screen.getByLabelText('Paso 2: Productos')).toBeTruthy();
    expect(screen.getByLabelText('Paso 3: Compra')).toBeTruthy();
    expect(screen.queryByTestId('factura-paso-leer')).toBeNull();
    expect(screen.queryByLabelText(/Leer/i)).toBeNull();
    expect(PASOS.map(paso => screen.getByTestId(`factura-paso-${paso}`).props.accessibilityState.selected)).toEqual([false, true, false]);
  });

  it('mapea el paso heredado leer al paso visible Productos', () => {
    renderPasos('leer');

    expect(screen.queryByTestId('factura-paso-leer')).toBeNull();
    expect(PASOS.map(paso => screen.getByTestId(`factura-paso-${paso}`).props.accessibilityState.selected)).toEqual([false, true, false]);
  });

  it('cada paso es un botón y avisa cuál se eligió', () => {
    const onSeleccionar = renderPasos('factura');

    PASOS.forEach(paso => expect(screen.getByTestId(`factura-paso-${paso}`).props.accessibilityRole).toBe('button'));
    fireEvent.press(screen.getByTestId('factura-paso-compra'));

    expect(onSeleccionar).toHaveBeenCalledTimes(1);
    expect(onSeleccionar).toHaveBeenCalledWith('compra');
  });

  it('un paso no disponible queda deshabilitado y no avisa al pulsarlo', () => {
    const onSeleccionar = renderPasos('factura', ['productos', 'compra']);

    expect(screen.getByTestId('factura-paso-productos').props.accessibilityState).toMatchObject({ disabled: true, selected: false });
    expect(screen.getByTestId('factura-paso-compra').props.accessibilityState).toMatchObject({ disabled: true, selected: false });
    expect(screen.getByTestId('factura-paso-factura').props.accessibilityState).toMatchObject({ disabled: false, selected: true });
    fireEvent.press(screen.getByTestId('factura-paso-productos'));

    expect(onSeleccionar).not.toHaveBeenCalled();
  });

  it('deshabilita Productos cuando recibe el alias heredado leer', () => {
    const onSeleccionar = renderPasos('factura', ['leer', 'compra']);

    expect(screen.getByTestId('factura-paso-productos').props.accessibilityState).toMatchObject({ disabled: true, selected: false });
    fireEvent.press(screen.getByTestId('factura-paso-productos'));

    expect(onSeleccionar).not.toHaveBeenCalled();
  });

  it('mantiene legibles los pasos deshabilitados sin doble opacidad ni texto #444444', () => {
    const onSeleccionar = renderPasos('factura', ['productos', 'compra']);
    const productosBtn = screen.getByTestId('factura-paso-productos');
    const productosLabel = within(productosBtn).getByText('Productos');
    const labelStyle = StyleSheet.flatten(productosLabel.props.style);

    expect(productosBtn.props.accessibilityState).toMatchObject({ disabled: true, selected: false });
    expect(productosBtn.props.dimmed).not.toBe(true);
    expect(labelStyle.color).toBe(elSerrucho.colors.textMuted);
    expect(labelStyle.color).not.toBe(elSerrucho.colors.textDim);
    fireEvent.press(productosBtn);
    expect(onSeleccionar).not.toHaveBeenCalled();
  });
});

describe('FacturaEstadoPill', () => {
  it('muestra el estado con texto, no solo con color', () => {
    renderWithProviders(<FacturaEstadoPill texto="Cambios sin guardar" tono="aviso" />);

    expect(screen.getByTestId('factura-estado-pill')).toBeTruthy();
    expect(screen.getByText('Cambios sin guardar')).toBeTruthy();
  });
});
