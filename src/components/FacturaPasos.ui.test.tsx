import * as React from 'react';
import { fireEvent, screen } from '@testing-library/react-native';
import { FacturaEstadoPill, FacturaPasos, type PasoFactura } from './FacturaPasos';
import { renderWithProviders } from '../test-utils/facturaUiHarness';

jest.mock('../lib/supabase', () => ({ supabase: require('../test-utils/facturaUiHarness').backend.client }));

const PASOS: PasoFactura[] = ['factura', 'leer', 'productos', 'compra'];

function renderPasos(seleccionado: PasoFactura, deshabilitados: PasoFactura[] = []) {
  const onSeleccionar = jest.fn();
  renderWithProviders(<FacturaPasos seleccionado={seleccionado} onSeleccionar={onSeleccionar} deshabilitados={deshabilitados} />);
  return onSeleccionar;
}

describe('FacturaPasos', () => {
  it('muestra los cuatro pasos con nombre y marca solo el seleccionado', () => {
    renderPasos('productos');

    expect(screen.getByLabelText('Paso 1: Factura')).toBeTruthy();
    expect(screen.getByLabelText('Paso 2: Leer')).toBeTruthy();
    expect(screen.getByLabelText('Paso 3: Productos')).toBeTruthy();
    expect(screen.getByLabelText('Paso 4: Compra')).toBeTruthy();
    expect(PASOS.map(paso => screen.getByTestId(`factura-paso-${paso}`).props.accessibilityState.selected)).toEqual([false, false, true, false]);
  });

  it('cada paso es un botón y avisa cuál se eligió', () => {
    const onSeleccionar = renderPasos('factura');

    PASOS.forEach(paso => expect(screen.getByTestId(`factura-paso-${paso}`).props.accessibilityRole).toBe('button'));
    fireEvent.press(screen.getByTestId('factura-paso-compra'));

    expect(onSeleccionar).toHaveBeenCalledTimes(1);
    expect(onSeleccionar).toHaveBeenCalledWith('compra');
  });

  it('un paso no disponible queda deshabilitado y no avisa al pulsarlo', () => {
    const onSeleccionar = renderPasos('factura', ['leer', 'productos', 'compra']);

    expect(screen.getByTestId('factura-paso-leer').props.accessibilityState).toMatchObject({ disabled: true, selected: false });
    expect(screen.getByTestId('factura-paso-factura').props.accessibilityState).toMatchObject({ disabled: false, selected: true });
    fireEvent.press(screen.getByTestId('factura-paso-leer'));

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
