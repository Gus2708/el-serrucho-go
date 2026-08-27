import type {
  Producto,
  ProfitSummaryRow,
  ProfitDailyRow,
  ProfitHourlyRow,
  TopProductoRow,
  AtencionPendiente,
  SolicitudAyuda,
  AlertaZelleSpoof,
  VentaDetalleUSD,
} from '../lib/supabase';
import type { VentaHoy } from '../hooks/useVentasHoy';
import type { Tasa } from '../hooks/useTazas';
import type { VelocidadCounts } from '../components/DonutChart';

export function getLocalDateStr(): string {
  const d = new Date();
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function getDateDaysAgo(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

// ── Tasa de Cambio ─────────────────────────────────────────────────────────────
export const demoTasa: Tasa = {
  bcv_usd: 36.45,
  bcv_eur: 39.80,
  binance_p2p: 41.20,
  tasa_promedio: 38.82,
  nombre: 'actual',
  created_at: new Date().toISOString(),
};

// ── Resumen de Rentabilidad (KPIs Dashboard) ──────────────────────────────────
export const demoProfitSummary: ProfitSummaryRow = {
  ganancia_hoy:    2478.70,
  ingreso_hoy:     7640.50,
  ventas_hoy:      85,
  items_hoy:       248,

  ganancia_ayer:   2150.30,
  ingreso_ayer:    6890.00,
  ventas_ayer:     78,
  items_ayer:      215,

  ganancia_semana: 14820.50,
  ingreso_semana:  48250.00,
  ventas_semana:   540,
  items_semana:    1620,

  ganancia_mes:    58400.00,
  ingreso_mes:     194500.00,
  ventas_mes:      2180,
  items_mes:       6540,

  ticket_promedio: 89.88,
};

// ── Tendencia por Hora para Sparkline (24 Horas) ──────────────────────────────
// Curva realista con actividad comercial: pico matutino (10am), receso (1pm-2pm),
// y pico de la tarde (3pm-4pm).
export const demoProfitHourlyHoy: ProfitHourlyRow[] = [
  { hora: '00', num_ventas: 0,  ingreso_bruto: 0,       num_items: 0,  ganancia: 0      },
  { hora: '01', num_ventas: 0,  ingreso_bruto: 0,       num_items: 0,  ganancia: 0      },
  { hora: '02', num_ventas: 0,  ingreso_bruto: 0,       num_items: 0,  ganancia: 0      },
  { hora: '03', num_ventas: 0,  ingreso_bruto: 0,       num_items: 0,  ganancia: 0      },
  { hora: '04', num_ventas: 0,  ingreso_bruto: 0,       num_items: 0,  ganancia: 0      },
  { hora: '05', num_ventas: 0,  ingreso_bruto: 0,       num_items: 0,  ganancia: 0      },
  { hora: '06', num_ventas: 0,  ingreso_bruto: 0,       num_items: 0,  ganancia: 0      },
  { hora: '07', num_ventas: 2,  ingreso_bruto: 120.50,  num_items: 4,  ganancia: 39.10  },
  { hora: '08', num_ventas: 6,  ingreso_bruto: 510.00,  num_items: 16, ganancia: 165.75 },
  { hora: '09', num_ventas: 9,  ingreso_bruto: 840.00,  num_items: 27, ganancia: 273.00 },
  { hora: '10', num_ventas: 12, ingreso_bruto: 1180.00, num_items: 38, ganancia: 383.50 }, // Pico matutino de compras
  { hora: '11', num_ventas: 11, ingreso_bruto: 1040.00, num_items: 34, ganancia: 338.00 },
  { hora: '12', num_ventas: 8,  ingreso_bruto: 720.00,  num_items: 24, ganancia: 234.00 },
  { hora: '13', num_ventas: 4,  ingreso_bruto: 390.00,  num_items: 12, ganancia: 126.75 }, // Desaceleración almuerzo
  { hora: '14', num_ventas: 7,  ingreso_bruto: 620.00,  num_items: 20, ganancia: 201.50 },
  { hora: '15', num_ventas: 10, ingreso_bruto: 950.00,  num_items: 31, ganancia: 308.75 }, // Pico tarde
  { hora: '16', num_ventas: 8,  ingreso_bruto: 710.00,  num_items: 23, ganancia: 230.75 },
  { hora: '17', num_ventas: 5,  ingreso_bruto: 420.00,  num_items: 14, ganancia: 136.50 },
  { hora: '18', num_ventas: 3,  ingreso_bruto: 140.00,  num_items: 5,  ganancia: 41.10  },
  { hora: '19', num_ventas: 0,  ingreso_bruto: 0,       num_items: 0,  ganancia: 0      },
  { hora: '20', num_ventas: 0,  ingreso_bruto: 0,       num_items: 0,  ganancia: 0      },
  { hora: '21', num_ventas: 0,  ingreso_bruto: 0,       num_items: 0,  ganancia: 0      },
  { hora: '22', num_ventas: 0,  ingreso_bruto: 0,       num_items: 0,  ganancia: 0      },
  { hora: '23', num_ventas: 0,  ingreso_bruto: 0,       num_items: 0,  ganancia: 0      },
];

export const demoProfitHourlyAyer: ProfitHourlyRow[] = [
  { hora: '00', num_ventas: 0,  ingreso_bruto: 0,       num_items: 0,  ganancia: 0      },
  { hora: '01', num_ventas: 0,  ingreso_bruto: 0,       num_items: 0,  ganancia: 0      },
  { hora: '02', num_ventas: 0,  ingreso_bruto: 0,       num_items: 0,  ganancia: 0      },
  { hora: '03', num_ventas: 0,  ingreso_bruto: 0,       num_items: 0,  ganancia: 0      },
  { hora: '04', num_ventas: 0,  ingreso_bruto: 0,       num_items: 0,  ganancia: 0      },
  { hora: '05', num_ventas: 0,  ingreso_bruto: 0,       num_items: 0,  ganancia: 0      },
  { hora: '06', num_ventas: 0,  ingreso_bruto: 0,       num_items: 0,  ganancia: 0      },
  { hora: '07', num_ventas: 2,  ingreso_bruto: 110.00,  num_items: 4,  ganancia: 34.30  },
  { hora: '08', num_ventas: 5,  ingreso_bruto: 440.00,  num_items: 14, ganancia: 137.28 },
  { hora: '09', num_ventas: 8,  ingreso_bruto: 760.00,  num_items: 24, ganancia: 237.12 },
  { hora: '10', num_ventas: 11, ingreso_bruto: 1080.00, num_items: 34, ganancia: 336.96 }, // Pico matutino
  { hora: '11', num_ventas: 10, ingreso_bruto: 930.00,  num_items: 29, ganancia: 290.16 },
  { hora: '12', num_ventas: 7,  ingreso_bruto: 650.00,  num_items: 20, ganancia: 202.80 },
  { hora: '13', num_ventas: 4,  ingreso_bruto: 350.00,  num_items: 11, ganancia: 109.20 }, // Desaceleración almuerzo
  { hora: '14', num_ventas: 7,  ingreso_bruto: 590.00,  num_items: 19, ganancia: 184.08 },
  { hora: '15', num_ventas: 9,  ingreso_bruto: 880.00,  num_items: 27, ganancia: 274.56 }, // Pico tarde
  { hora: '16', num_ventas: 7,  ingreso_bruto: 610.00,  num_items: 19, ganancia: 190.32 },
  { hora: '17', num_ventas: 5,  ingreso_bruto: 360.00,  num_items: 10, ganancia: 112.32 },
  { hora: '18', num_ventas: 3,  ingreso_bruto: 130.00,  num_items: 4,  ganancia: 41.20  },
  { hora: '19', num_ventas: 0,  ingreso_bruto: 0,       num_items: 0,  ganancia: 0      },
  { hora: '20', num_ventas: 0,  ingreso_bruto: 0,       num_items: 0,  ganancia: 0      },
  { hora: '21', num_ventas: 0,  ingreso_bruto: 0,       num_items: 0,  ganancia: 0      },
  { hora: '22', num_ventas: 0,  ingreso_bruto: 0,       num_items: 0,  ganancia: 0      },
  { hora: '23', num_ventas: 0,  ingreso_bruto: 0,       num_items: 0,  ganancia: 0      },
];

// ── Datos Diarios para GananciaChart (Reportes y Dashboard) ────────────────────
export function getDemoDaily(days: number): ProfitDailyRow[] {
  const result: ProfitDailyRow[] = [];
  const baseRevenue = 6500;
  const baseProfit = 2100;

  for (let i = days - 1; i >= 0; i--) {
    const dia = getDateDaysAgo(i);
    // Variación pseudo-aleatoria estable basada en el índice
    const factor = 0.8 + ((i * 17) % 45) / 100;
    const ingreso_bruto = Math.round(baseRevenue * factor * 100) / 100;
    const ganancia = Math.round(baseProfit * factor * 100) / 100;
    const num_ventas = Math.round(75 * factor);
    const num_items = Math.round(220 * factor);

    result.push({
      dia,
      num_ventas,
      ingreso_bruto,
      num_items,
      ganancia,
    });
  }
  return result;
}

// ── Top Productos para TopProductsDonut ─────────────────────────────────────────
export const demoTopProductos: TopProductoRow[] = [
  {
    codigo_producto:   'CEM-001',
    descripcion:       'Cemento Portland Gris Tipo I 42.5kg',
    unidades_vendidas: 420,
    ingreso:           3780.00,
    ganancia:          840.00,
  },
  {
    codigo_producto:   'DW-412',
    descripcion:       'Disco Corte Fino DeWalt 4-1/2" Inox',
    unidades_vendidas: 310,
    ingreso:           620.00,
    ganancia:          217.00,
  },
  {
    codigo_producto:   'PIN-BLA-1G',
    descripcion:       'Pintura Caucho Blanco Montana 1 Galón',
    unidades_vendidas: 185,
    ingreso:           2960.00,
    ganancia:          888.00,
  },
  {
    codigo_producto:   'TUB-PVC-12',
    descripcion:       'Tubo PVC Presión 1/2" x 6m Tubrica',
    unidades_vendidas: 160,
    ingreso:           720.00,
    ganancia:          252.00,
  },
  {
    codigo_producto:   'TAL-BOS-12',
    descripcion:       'Taladro Percutor Bosch GSB 550 1/2"',
    unidades_vendidas: 28,
    ingreso:           1680.00,
    ganancia:          420.00,
  },
  {
    codigo_producto:   'ELE-LIN-6013',
    descripcion:       'Electrodo Lincoln 6013 1/8" Caja 5kg',
    unidades_vendidas: 95,
    ingreso:           1710.00,
    ganancia:          478.80,
  },
  {
    codigo_producto:   'CAN-CIS-70',
    descripcion:       'Candado Anticizalla Cisa Blindado 70mm',
    unidades_vendidas: 45,
    ingreso:           1575.00,
    ganancia:          441.00,
  },
];

// ── Velocidad de Rotación (DonutChart) ─────────────────────────────────────────
export const demoVelocidadCounts: VelocidadCounts = {
  rapido:         142,
  lento:          58,
  sin_movimiento: 14,
  total:          214,
};

// ── Catálogo de Inventario Completo ───────────────────────────────────────────
export const demoProductos: Producto[] = [
  {
    codigo_interno: 'CEM-001',
    descripcion:    'Cemento Portland Gris Tipo I 42.5kg',
    unidad:         'SACO',
    codigo_barras:  '7591234000018',
    referencia:     'Vencemos / Holcim',
    costo:          7.00,
    precio_venta:   9.00,
    existencia:     250,
    actualizado_en: new Date().toISOString(),
  },
  {
    codigo_interno: 'DW-412',
    descripcion:    'Disco de Corte DeWalt 4-1/2" Inox DWA8062',
    unidad:         'UND',
    codigo_barras:  '028877543210',
    referencia:     'DeWalt Original',
    costo:          1.30,
    precio_venta:   2.00,
    existencia:     140,
    actualizado_en: new Date().toISOString(),
  },
  {
    codigo_interno: 'PIN-BLA-1G',
    descripcion:    'Pintura Caucho Clase B Blanco Montana 1 Galón',
    unidad:         'GAL',
    codigo_barras:  '7591029384756',
    referencia:     'Montana AV-2000',
    costo:          11.20,
    precio_venta:   16.00,
    existencia:     45,
    actualizado_en: new Date().toISOString(),
  },
  {
    codigo_interno: 'PIN-CUN-4G',
    descripcion:    'Pintura Caucho Blanco Profesional Cuñete 4 Galones',
    unidad:         'CUN',
    codigo_barras:  '7591029384763',
    referencia:     'Montana Profesional',
    costo:          42.00,
    precio_venta:   58.00,
    existencia:     12,
    actualizado_en: new Date().toISOString(),
  },
  {
    codigo_interno: 'TUB-PVC-12',
    descripcion:    'Tubo PVC Presión Agua Fría 1/2" x 6m',
    unidad:         'TUBO',
    codigo_barras:  '7592938475610',
    referencia:     'Tubrica Oficial',
    costo:          2.90,
    precio_venta:   4.50,
    existencia:     80,
    actualizado_en: new Date().toISOString(),
  },
  {
    codigo_interno: 'TUB-PVC-4AG',
    descripcion:    'Tubo PVC Sanitario Aguas Negras 4" x 3m',
    unidad:         'TUBO',
    codigo_barras:  '7592938475627',
    referencia:     'Tubrica Sanitario',
    costo:          8.50,
    precio_venta:   13.00,
    existencia:     3, // Stock bajo
    actualizado_en: new Date().toISOString(),
  },
  {
    codigo_interno: 'TAL-BOS-12',
    descripcion:    'Taladro Percutor Bosch GSB 550W Mandril 1/2"',
    unidad:         'UND',
    codigo_barras:  '3165140889214',
    referencia:     'Bosch Heavy Duty',
    costo:          45.00,
    precio_venta:   60.00,
    existencia:     8,
    actualizado_en: new Date().toISOString(),
  },
  {
    codigo_interno: 'ESM-DEW-412',
    descripcion:    'Esmeril Angular DeWalt 820W 4-1/2" DWE4010',
    unidad:         'UND',
    codigo_barras:  '028877543999',
    referencia:     'DeWalt Pro',
    costo:          52.00,
    precio_venta:   72.00,
    existencia:     15,
    actualizado_en: new Date().toISOString(),
  },
  {
    codigo_interno: 'CAB-THW-12',
    descripcion:    'Cable Eléctrico 7 Hilos THW #12 AWG Cobre 100m',
    unidad:         'ROLLO',
    codigo_barras:  '7593847561029',
    referencia:     'Cabel 100% Cobre',
    costo:          34.00,
    precio_venta:   48.00,
    existencia:     22,
    actualizado_en: new Date().toISOString(),
  },
  {
    codigo_interno: 'CAB-THW-10',
    descripcion:    'Cable Eléctrico 7 Hilos THW #10 AWG Cobre 100m',
    unidad:         'ROLLO',
    codigo_barras:  '7593847561036',
    referencia:     'Cabel 100% Cobre',
    costo:          48.00,
    precio_venta:   65.00,
    existencia:     2, // Stock bajo
    actualizado_en: new Date().toISOString(),
  },
  {
    codigo_interno: 'ELE-LIN-6013',
    descripcion:    'Electrodo Soldadura Lincoln Fleetweld 6013 1/8" 5kg',
    unidad:         'CAJA',
    codigo_barras:  '015082103456',
    referencia:     'Lincoln Electric',
    costo:          12.50,
    precio_venta:   18.00,
    existencia:     34,
    actualizado_en: new Date().toISOString(),
  },
  {
    codigo_interno: 'CAN-CIS-70',
    descripcion:    'Candado Anticizalla Cisa Blindado 70mm Original',
    unidad:         'UND',
    codigo_barras:  '8015345678901',
    referencia:     'Cisa Made in Italy',
    costo:          24.50,
    precio_venta:   35.00,
    existencia:     18,
    actualizado_en: new Date().toISOString(),
  },
  {
    codigo_interno: 'SIL-SIK-PRO',
    descripcion:    'Sellador de Poliuretano Sikaflex 11FC Gris 300ml',
    unidad:         'TUBO',
    codigo_barras:  '7612895678123',
    referencia:     'Sika Suiza',
    costo:          5.80,
    precio_venta:   8.50,
    existencia:     0, // Sin stock
    actualizado_en: new Date().toISOString(),
  },
  {
    codigo_interno: 'PEI-PEGA-GRE',
    descripcion:    'Pego Gris Interiores Pego Plus Saco 15kg',
    unidad:         'SACO',
    codigo_barras:  '7591928374650',
    referencia:     'Pego Plus Industrial',
    costo:          2.60,
    precio_venta:   4.00,
    existencia:     120,
    actualizado_en: new Date().toISOString(),
  },
  {
    codigo_interno: 'BRO-STA-CON',
    descripcion:    'Juego Brocas Concreto Stanley 5 Piezas (4-10mm)',
    unidad:         'JGO',
    codigo_barras:  '076174209876',
    referencia:     'Stanley Tools',
    costo:          4.20,
    precio_venta:   6.50,
    existencia:     25,
    actualizado_en: new Date().toISOString(),
  },
  {
    codigo_interno: 'CINT-TFL-34',
    descripcion:    'Teflón Alta Densidad 3/4" x 12m Plomería',
    unidad:         'UND',
    codigo_barras:  '7591238475629',
    referencia:     'Pegatanke Seal',
    costo:          0.45,
    precio_venta:   0.85,
    existencia:     180,
    actualizado_en: new Date().toISOString(),
  },
  {
    codigo_interno: 'BOM-AGU-12HP',
    descripcion:    'Bomba de Agua Periférica Pedrollo 1/2 HP PKM60',
    unidad:         'UND',
    codigo_barras:  '8005432109876',
    referencia:     'Pedrollo Italia',
    costo:          42.00,
    precio_venta:   58.00,
    existencia:     6,
    actualizado_en: new Date().toISOString(),
  },
  {
    codigo_interno: 'BRA-CAR-LED',
    descripcion:    'Reflector LED Exterior 100W IP66 Luz Blanca',
    unidad:         'UND',
    codigo_barras:  '7592837465012',
    referencia:     'Silvania / Philips',
    costo:          14.00,
    precio_venta:   22.00,
    existencia:     16,
    actualizado_en: new Date().toISOString(),
  },
  {
    codigo_interno: 'VAL-ESF-12',
    descripcion:    'Válvula Esférica de Bronce Paso Rápido 1/2"',
    unidad:         'UND',
    codigo_barras:  '7591827364501',
    referencia:     'Giacomini Bronce',
    costo:          3.50,
    precio_venta:   5.50,
    existencia:     0, // Sin stock
    actualizado_en: new Date().toISOString(),
  },
  {
    codigo_interno: 'BAR-ROS-38',
    descripcion:    'Barra Roscada Zincada Grado 2 3/8" x 3 Metros',
    unidad:         'UND',
    codigo_barras:  '7592837465999',
    referencia:     'Fijaciones Metal',
    costo:          2.20,
    precio_venta:   3.80,
    existencia:     45,
    actualizado_en: new Date().toISOString(),
  },
];

// ── Facturas y Ventas para VentasView ──────────────────────────────────────────
export const demoVentas: VentaHoy[] = [
  {
    venta_id:                    1001,
    id:                          1001,
    id_unico:                    90001,
    documento:                   'FAC-001248',
    created_at:                  `${getLocalDateStr()}T15:42:00.000Z`,
    fecha_emision:               getLocalDateStr(),
    status:                      1,
    rif_cliente:                 'J-30491823-1',
    nombre_cliente:              'CONSTRUCTORA DEL VALLE C.A.',
    metodo_pago:                 'ZELLE',
    total_usd:                   485.50,
    ganancia_total_usd:          152.30,
    items_count:                 4,
    total_neto_usd:              485.50,
    total_bruto_usd:             418.53,
    total_impuesto_usd:          66.97,
    original_total_neto_ves:     485.50,
    original_total_impuesto_ves: 66.97,
  },
  {
    venta_id:                    1002,
    id:                          1002,
    id_unico:                    90002,
    documento:                   'FAC-001247',
    created_at:                  `${getLocalDateStr()}T14:15:00.000Z`,
    fecha_emision:               getLocalDateStr(),
    status:                      1,
    rif_cliente:                 'V-18492018',
    nombre_cliente:              'HERNANDEZ PEREZ CARLOS EDUARDO',
    metodo_pago:                 'EFECTIVO USD',
    total_usd:                   72.00,
    ganancia_total_usd:          20.00,
    items_count:                 1,
    total_neto_usd:              72.00,
    total_bruto_usd:             62.07,
    total_impuesto_usd:          9.93,
    original_total_neto_ves:     72.00,
    original_total_impuesto_ves: 9.93,
  },
  {
    venta_id:                    1003,
    id:                          1003,
    id_unico:                    90003,
    documento:                   'FAC-001246',
    created_at:                  `${getLocalDateStr()}T11:20:00.000Z`,
    fecha_emision:               getLocalDateStr(),
    status:                      1,
    rif_cliente:                 'J-40192831-2',
    nombre_cliente:              'INVERSIONES FERRE-CENTRO C.A.',
    metodo_pago:                 'T. DEBITO',
    total_usd:                   1250.00,
    ganancia_total_usd:          390.00,
    items_count:                 7,
    total_neto_usd:              1250.00,
    total_bruto_usd:             1077.59,
    total_impuesto_usd:          172.41,
    original_total_neto_ves:     1250.00,
    original_total_impuesto_ves: 172.41,
  },
  {
    venta_id:                    1004,
    id:                          1004,
    id_unico:                    90004,
    documento:                   'FAC-001245',
    created_at:                  `${getLocalDateStr()}T10:05:00.000Z`,
    fecha_emision:               getLocalDateStr(),
    status:                      1,
    rif_cliente:                 'V-22194820',
    nombre_cliente:              'SANCHEZ RODRIGUEZ MARIA ELENA',
    metodo_pago:                 'PAGO MOVIL',
    total_usd:                   34.50,
    ganancia_total_usd:          11.20,
    items_count:                 2,
    total_neto_usd:              34.50,
    total_bruto_usd:             29.74,
    total_impuesto_usd:          4.76,
    original_total_neto_ves:     34.50,
    original_total_impuesto_ves: 4.76,
  },
  {
    venta_id:                    1005,
    id:                          1005,
    id_unico:                    90005,
    documento:                   'FAC-001244',
    created_at:                  `${getLocalDateStr()}T09:12:00.000Z`,
    fecha_emision:               getLocalDateStr(),
    status:                      1,
    rif_cliente:                 'J-29381029-4',
    nombre_cliente:              'DESARROLLOS URBANOS METROPOLIS',
    metodo_pago:                 'ZELLE',
    total_usd:                   680.00,
    ganancia_total_usd:          215.00,
    items_count:                 5,
    total_neto_usd:              680.00,
    total_bruto_usd:             586.21,
    total_impuesto_usd:          93.79,
    original_total_neto_ves:     680.00,
    original_total_impuesto_ves: 93.79,
  },
  {
    venta_id:                    1006,
    id:                          1006,
    id_unico:                    90006,
    documento:                   'FAC-001243',
    created_at:                  `${getDateDaysAgo(1)}T16:30:00.000Z`,
    fecha_emision:               getDateDaysAgo(1),
    status:                      1,
    rif_cliente:                 'V-15829104',
    nombre_cliente:              'ALVAREZ JOSE GREGORIO',
    metodo_pago:                 'EFECTIVO USD',
    total_usd:                   118.00,
    ganancia_total_usd:          36.50,
    items_count:                 3,
    total_neto_usd:              118.00,
    total_bruto_usd:             101.72,
    total_impuesto_usd:          16.28,
    original_total_neto_ves:     118.00,
    original_total_impuesto_ves: 16.28,
  },
  {
    venta_id:                    1007,
    id:                          1007,
    id_unico:                    90007,
    documento:                   'FAC-001242',
    created_at:                  `${getDateDaysAgo(1)}T11:45:00.000Z`,
    fecha_emision:               getDateDaysAgo(1),
    status:                      1,
    rif_cliente:                 'J-31948501-9',
    nombre_cliente:              'CONSTRUCTORA HABITAT MODERNO',
    metodo_pago:                 'TRANSFERENCIA',
    total_usd:                   940.00,
    ganancia_total_usd:          295.00,
    items_count:                 8,
    total_neto_usd:              940.00,
    total_bruto_usd:             810.34,
    total_impuesto_usd:          129.66,
    original_total_neto_ves:     940.00,
    original_total_impuesto_ves: 129.66,
  },
];

// ── Detalle de Ítems por Factura ───────────────────────────────────────────────
export const demoVentaDetalles: Record<number, VentaDetalleUSD[]> = {
  1001: [
    {
      id:                  1,
      venta_id:            1001,
      documento:           'FAC-001248',
      codigo_producto:     'CEM-001',
      descripcion:         'Cemento Portland Gris Tipo I 42.5kg',
      cantidad:            30,
      precio_unitario_usd: 9.00,
      subtotal_usd:        270.00,
    },
    {
      id:                  2,
      venta_id:            1001,
      documento:           'FAC-001248',
      codigo_producto:     'DW-412',
      descripcion:         'Disco de Corte DeWalt 4-1/2" Inox DWA8062',
      cantidad:            20,
      precio_unitario_usd: 2.00,
      subtotal_usd:        40.00,
    },
    {
      id:                  3,
      venta_id:            1001,
      documento:           'FAC-001248',
      codigo_producto:     'CAB-THW-12',
      descripcion:         'Cable Eléctrico 7 Hilos THW #12 AWG Cobre 100m',
      cantidad:            2,
      precio_unitario_usd: 48.00,
      subtotal_usd:        96.00,
    },
    {
      id:                  4,
      venta_id:            1001,
      documento:           'FAC-001248',
      codigo_producto:     'TUB-PVC-12',
      descripcion:         'Tubo PVC Presión Agua Fría 1/2" x 6m',
      cantidad:            17.67,
      precio_unitario_usd: 4.50,
      subtotal_usd:        79.50,
    },
  ],
  1002: [
    {
      id:                  5,
      venta_id:            1002,
      documento:           'FAC-001247',
      codigo_producto:     'ESM-DEW-412',
      descripcion:         'Esmeril Angular DeWalt 820W 4-1/2" DWE4010',
      cantidad:            1,
      precio_unitario_usd: 72.00,
      subtotal_usd:        72.00,
    },
  ],
  1003: [
    {
      id:                  6,
      venta_id:            1003,
      documento:           'FAC-001246',
      codigo_producto:     'TAL-BOS-12',
      descripcion:         'Taladro Percutor Bosch GSB 550W Mandril 1/2"',
      cantidad:            4,
      precio_unitario_usd: 60.00,
      subtotal_usd:        240.00,
    },
    {
      id:                  7,
      venta_id:            1003,
      documento:           'FAC-001246',
      codigo_producto:     'PIN-CUN-4G',
      descripcion:         'Pintura Caucho Blanco Profesional Cuñete 4 Galones',
      cantidad:            10,
      precio_unitario_usd: 58.00,
      subtotal_usd:        580.00,
    },
    {
      id:                  8,
      venta_id:            1003,
      documento:           'FAC-001246',
      codigo_producto:     'CAN-CIS-70',
      descripcion:         'Candado Anticizalla Cisa Blindado 70mm Original',
      cantidad:            12,
      precio_unitario_usd: 35.00,
      subtotal_usd:        420.00,
    },
    {
      id:                  9,
      venta_id:            1003,
      documento:           'FAC-001246',
      codigo_producto:     'DW-412',
      descripcion:         'Disco de Corte DeWalt 4-1/2" Inox DWA8062',
      cantidad:            5,
      precio_unitario_usd: 2.00,
      subtotal_usd:        10.00,
    },
  ],
};

// Fallback dinámico para facturas sin detalle estático
export function getDemoVentaDetalle(ventaId: number): VentaDetalleUSD[] {
  if (demoVentaDetalles[ventaId]) {
    return demoVentaDetalles[ventaId];
  }
  const v = demoVentas.find(item => item.id === ventaId);
  const doc = v?.documento ?? `FAC-${ventaId}`;
  return [
    {
      id:                  100 + ventaId,
      venta_id:            ventaId,
      documento:           doc,
      codigo_producto:     'CEM-001',
      descripcion:         'Cemento Portland Gris Tipo I 42.5kg',
      cantidad:            Math.max(1, Math.round((v?.total_usd ?? 50) / 9)),
      precio_unitario_usd: 9.00,
      subtotal_usd:        v?.total_usd ?? 50,
    },
  ];
}

// ── Notificaciones de WhatsApp (Atenciones Pendientes) ────────────────────────
export const demoAtenciones: AtencionPendiente[] = [
  {
    id:           901,
    telefono:     '+58 414-2345678',
    nombre:       'Ing. Roberto Mendoza (Constructora)',
    motivo:       'Solicita presupuesto urgente de 120 sacos de cemento y cabillas de 1/2" para vaciado de losa.',
    creado_en:    new Date(Date.now() - 14 * 60_000).toISOString(), // Hace 14m
    status:       'pendiente',
    atendido_en:  null,
    atendido_por: null,
  },
  {
    id:           902,
    telefono:     '+58 424-9876543',
    nombre:       'Arq. Mariana Gómez',
    motivo:       'Pregunta si disponen de pintura epóxica para pisos y sellador Sikaflex en gris.',
    creado_en:    new Date(Date.now() - 42 * 60_000).toISOString(), // Hace 42m
    status:       'pendiente',
    atendido_en:  null,
    atendido_por: null,
  },
  {
    id:           903,
    telefono:     '+58 412-5551234',
    nombre:       'Taller Metalúrgico Los Andes',
    motivo:       'Consulta si tienen electrodos 7018 de 1/8" y discos de desbaste DeWalt en caja.',
    creado_en:    new Date(Date.now() - 110 * 60_000).toISOString(), // Hace ~2h
    status:       'pendiente',
    atendido_en:  null,
    atendido_por: null,
  },
];

// ── Solicitudes de Ayuda en Tienda ─────────────────────────────────────────────
export const demoSolicitudes: SolicitudAyuda[] = [
  {
    id:            801,
    telefono:      'Ext. 104 - Caja 2',
    nombre:        'Vendedor: Carlos Méndez',
    consulta:      'Cliente frecuente Constructora del Valle pide 5% de descuento adicional por pago en Zelle en orden > $1,000.',
    motivo:        'Autorización de Descuento Especial',
    status:        'pendiente',
    no_disponible: false,
    creado_en:     new Date(Date.now() - 8 * 60_000).toISOString(),
    resuelto_en:   null,
    resuelto_por:  null,
    enviado_en:    null,
  },
  {
    id:            802,
    telefono:      'Ext. 108 - Almacén',
    nombre:        'Supervisor Almacén: Pedro Ríos',
    consulta:      'Faltante de 2 unidades de Taladro Bosch en estantería B-4 contra sistema. Solicitud de ajuste de inventario.',
    motivo:        'Discrepancia de Stock Físico',
    status:        'pendiente',
    no_disponible: false,
    creado_en:     new Date(Date.now() - 35 * 60_000).toISOString(),
    resuelto_en:   null,
    resuelto_por:  null,
    enviado_en:    null,
  },
];

// ── Alertas Anti-Fraude Zelle Spoofing ─────────────────────────────────────────
export const demoAlertasSpoof: AlertaZelleSpoof[] = [
  {
    id:             'sp-001',
    message_id:     '<spoof-attempt-20260827-01@fake-zelle-mail.com>',
    from_addr:      'confirmations@zelle-payment-security.com',
    asunto:         'Zelle: You received a payment of $450.00 from John Miller',
    motivo:         'dominio_no_autorizado',
    auth_snippet:   'DKIM: fail (unauthorized signature); SPF: softfail (domain does not match IP)',
    cuerpo_snippet: 'Your funds have been approved and will reflect once you confirm your business email...',
    recibido_en:    new Date(Date.now() - 25 * 60_000).toISOString(),
    detectado_en:   new Date(Date.now() - 25 * 60_000).toISOString(),
    revisado:       false,
    revisado_por:   null,
  },
  {
    id:             'sp-002',
    message_id:     '<spoof-attempt-20260826-09@chase-secure-alerts.net>',
    from_addr:      'alerts@chase-secure-alerts.net',
    asunto:         'Notice: Business Account Credit Notification - $820.00',
    motivo:         'header_from_no_alinea',
    auth_snippet:   'DMARC: reject (header from does not align with sender envelope)',
    cuerpo_snippet: 'Automated credit advice notification. Click link to verify recipient credentials...',
    recibido_en:    new Date(Date.now() - 420 * 60_000).toISOString(),
    detectado_en:   new Date(Date.now() - 420 * 60_000).toISOString(),
    revisado:       true,
    revisado_por:   'Reclutador Demo',
  },
];

// ── Presupuestos para PresupuestosHistory ──────────────────────────────────────
export const demoPresupuestos = [
  {
    id:                 501,
    creado_por:         '00000000-0000-0000-0000-00000000demo',
    cliente_id:         'cli-01',
    total_usd:          1450.00,
    status:             'emitido' as const,
    pdf_url:            null,
    nota:               'Presupuesto para remodelación oficinas - Pintura y cableado',
    creado_en:          new Date(Date.now() - 60 * 60_000).toISOString(),
    en_bs:              false,
    items_count:        4,
    cliente_nombre:     'CONSTRUCTORA DEL VALLE C.A.',
    creado_por_nombre:  'Reclutador Demo',
  },
  {
    id:                 502,
    creado_por:         '00000000-0000-0000-0000-00000000demo',
    cliente_id:         'cli-02',
    total_usd:          320.00,
    status:             'borrador' as const,
    pdf_url:            null,
    nota:               'Cotización de bombas y conexiones de agua',
    creado_en:          new Date(Date.now() - 180 * 60_000).toISOString(),
    en_bs:              false,
    items_count:        2,
    cliente_nombre:     'INGENIERIA HIDRAULICA SUR',
    creado_por_nombre:  'Reclutador Demo',
  },
];

// ── Órdenes de Cambio para OrdenesHistory ──────────────────────────────────────
export const demoOrdenes = [
  {
    id:                 301,
    creado_por:         '00000000-0000-0000-0000-00000000demo',
    nota:               'Ajuste por conteo físico de fin de mes (Cemento y Electrodos)',
    status:             'emitido' as const,
    pdf_url:            null,
    creado_en:          new Date(Date.now() - 120 * 60_000).toISOString(),
    aprobacion_estado:  'aprobado' as const,
    aprobado_por:       '00000000-0000-0000-0000-00000000demo',
    aprobado_en:        new Date().toISOString(),
    rechazo_motivo:     null,
    item_count:         3,
    creado_por_nombre:  'Reclutador Demo',
  },
  {
    id:                 302,
    creado_por:         '00000000-0000-0000-0000-00000000demo',
    nota:               'Merma por daño de embalaje en transporte',
    status:             'emitido' as const,
    pdf_url:            null,
    creado_en:          new Date(Date.now() - 400 * 60_000).toISOString(),
    aprobacion_estado:  'pendiente' as const,
    aprobado_por:       null,
    aprobado_en:        null,
    rechazo_motivo:     null,
    item_count:         1,
    creado_por_nombre:  'Reclutador Demo',
  },
];

