import { useDemoStore, isDemoActive, DEMO_USER_ID, DEMO_SESSION } from './useDemoStore';
import {
  demoProfitSummary,
  demoProfitHourlyHoy,
  demoProfitHourlyAyer,
  getDemoDaily,
  demoTopProductos,
  demoProductos,
  demoVentas,
  getDemoVentaDetalle,
  demoAtenciones,
  demoSolicitudes,
  demoAlertasSpoof,
  demoPagosZelle,
  demoProveedores,
  demoUsuarios,
  getDemoOrdenItems,
  demoOrdenes,
} from './demoData';

describe('Demo Mode Infrastructure', () => {
  beforeEach(() => {
    useDemoStore.getState().disableDemo();
  });

  it('toggles demo mode state correctly', () => {
    expect(isDemoActive()).toBe(false);

    useDemoStore.getState().enableDemo();
    expect(isDemoActive()).toBe(true);
    expect(useDemoStore.getState().isDemoMode).toBe(true);

    useDemoStore.getState().disableDemo();
    expect(isDemoActive()).toBe(false);
    expect(useDemoStore.getState().isDemoMode).toBe(false);
  });

  it('provides a valid mock session and user ID', () => {
    expect(DEMO_USER_ID).toBeDefined();
    expect(DEMO_SESSION.user.id).toBe(DEMO_USER_ID);
    expect(DEMO_SESSION.access_token).toBeDefined();
  });

  it('contains valid hourly datasets for the 24-hour Sparkline', () => {
    expect(demoProfitHourlyHoy.length).toBe(24);
    expect(demoProfitHourlyAyer.length).toBe(24);

    // Verify 10am peak has positive revenue
    const hour10 = demoProfitHourlyHoy.find(h => h.hora === '10');
    expect(hour10).toBeDefined();
    expect(hour10!.ingreso_bruto).toBeGreaterThan(0);
    expect(hour10!.ganancia).toBeGreaterThan(0);

    // Verify lunch recess exists at 13h (1pm)
    const hour13 = demoProfitHourlyHoy.find(h => h.hora === '13');
    expect(hour13).toBeDefined();
    expect(hour13!.ingreso_bruto).toBeLessThan(hour10!.ingreso_bruto);
  });

  it('generates daily historical profit data for GananciaChart', () => {
    const daily7 = getDemoDaily(7);
    expect(daily7.length).toBe(7);

    const daily30 = getDemoDaily(30);
    expect(daily30.length).toBe(30);

    for (const item of daily7) {
      expect(item.dia).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(item.ingreso_bruto).toBeGreaterThan(0);
      expect(item.ganancia).toBeGreaterThan(0);
    }
  });

  it('provides rich catalog and filters for inventory', () => {
    expect(demoProductos.length).toBeGreaterThanOrEqual(15);

    const sinStock = demoProductos.filter(p => p.existencia <= 0);
    expect(sinStock.length).toBeGreaterThan(0);

    const normalStock = demoProductos.filter(p => p.existencia > 5);
    expect(normalStock.length).toBeGreaterThan(0);
  });

  it('provides detailed sales and invoices with line items', () => {
    expect(demoVentas.length).toBeGreaterThan(0);

    const firstVenta = demoVentas[0];
    expect(firstVenta.documento).toBeDefined();
    expect(firstVenta.total_usd).toBeGreaterThan(0);

    const items = getDemoVentaDetalle(firstVenta.id);
    expect(items.length).toBeGreaterThan(0);
    expect(items[0].precio_unitario_usd).toBeGreaterThan(0);
  });

  it('provides realistic WhatsApp and security notifications', () => {
    expect(demoAtenciones.length).toBeGreaterThan(0);
    expect(demoSolicitudes.length).toBeGreaterThan(0);
    expect(demoAlertasSpoof.length).toBeGreaterThan(0);

    // Security alert contains spoof details
    const spoof = demoAlertasSpoof[0];
    expect(spoof.motivo).toBe('dominio_no_autorizado');
    expect(spoof.revisado).toBe(false);
  });

  it('activates zero-trust demo guard flag', () => {
    useDemoStore.getState().enableDemo();
    expect(isDemoActive()).toBe(true);
    expect(useDemoStore.getState().isDemoMode).toBe(true);
  });

  it('exposes a valid UUID as the demo user id', () => {
    expect(DEMO_USER_ID).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  });

  it('provides fallback data for every screen that used to hit Supabase', () => {
    expect(demoPagosZelle.length).toBeGreaterThan(0);
    expect(demoProveedores.length).toBeGreaterThan(0);
    expect(demoUsuarios.length).toBeGreaterThan(0);
  });

  it('returns items for each demo order and an empty list for unknown ones', () => {
    for (const orden of demoOrdenes) {
      expect(getDemoOrdenItems(orden.id).length).toBe(orden.item_count);
    }
    expect(getDemoOrdenItems(-1)).toEqual([]);
  });
});
