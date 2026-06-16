import 'react-native-url-polyfill/auto';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';
import { Platform } from 'react-native';

const supabaseUrl  = process.env.EXPO_PUBLIC_SUPABASE_URL!;
const supabaseAnon = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY!;

export const supabase = createClient(supabaseUrl, supabaseAnon, {
  auth: {
    // Web uses localStorage by default; native needs AsyncStorage
    storage:            Platform.OS === 'web' ? undefined : AsyncStorage,
    autoRefreshToken:   true,
    persistSession:     true,
    // Enable URL session detection on web for magic link / OAuth callbacks
    detectSessionInUrl: Platform.OS === 'web',
  },
});

// ── Type helpers ──────────────────────────────────────────────────────────────

export type Producto = {
  codigo_interno: string;
  descripcion:    string;
  unidad:         string;
  codigo_barras:  string;
  referencia?:    string; // supplier reference field
  costo:          number;
  precio_venta:   number;
  existencia:     number;
  actualizado_en: string;
  es_placeholder?: boolean;
};

export type Venta = {
  id:             number;
  id_unico:       number | null;   // V2: identificador único de HybridLite (upsert key)
  documento:      string;
  fecha_emision:  string;
  rif_cliente:    string | null;
  total_neto:     number | null;   // total CON IVA en USD (post-fix backend)
  total_bruto:    number | null;   // subtotal SIN IVA en USD
  total_impuesto: number | null;   // IVA en USD
  metodo_pago:    string | null;   // V2: "EFECTIVO USD", "ZELLE", "T. DEBITO", etc.
  status:         number;
  numero_control: string | null;
  created_at:     string;          // V2: hora REAL de la transacción (no de inserción en nube)
  total_usd?:     number | string;
  total_items?:   number | string;
  original_total_neto_ves?:     number | string;
  original_total_impuesto_ves?: number | string;
};

export type VentaDetalle = {
  id:              number;
  documento:       string | null;
  codigo_producto: string | null;
  cantidad:        number | null;
  precio_venta:    number | null;
  costo_str:       string | null;
  created_at:      string;
  venta_id:        number | null;
};

export type VentaDetalleUSD = {
  id:                  number;
  venta_id:            number;
  documento:           string;
  codigo_producto:     string;
  cantidad:            number;
  descripcion:         string;
  precio_unitario_usd: number;
  subtotal_usd:        number;
};

export type Anomalia = {
  id:              number;
  codigo_producto: string | null;
  tipo:            string;
  severidad:       'alta' | 'media' | 'baja';
  explicacion:     string | null;
  detectado_en:    string;
  resuelto:        boolean;
};

export type OrdenCambio = {
  id:         number;
  creado_por: string;
  nota:       string | null;
  status:     'borrador' | 'emitido';
  pdf_url:    string | null;
  creado_en:  string;
};

export type OrdenCambioItem = {
  id:                 number;
  orden_id:           number;
  codigo_producto:    string;
  descripcion:        string | null;
  existencia_actual:  number | null;
  nueva_existencia:   number;
  delta:              number;
  nota:               string | null;
};

export type Presupuesto = {
  id:         number;
  creado_por: string;
  cliente_id: string | null;
  total_usd:  number;
  status:     'borrador' | 'emitido';
  pdf_url:    string | null;
  nota:       string | null;
  creado_en:  string;
};

export type PresupuestoDetalle = {
  id:              number;
  presupuesto_id:  number;
  codigo_producto: string;
  descripcion:     string;
  cantidad:        number;
  precio_unitario: number;
  subtotal:        number;
};

export type Profile = {
  id:           string;
  role:         'admin' | 'empleado';
  email:        string | null;
  display_name: string | null;
  updated_at:   string;
};

export type AtencionPendiente = {
  id:           number;
  telefono:     string;
  nombre:       string;
  motivo:       string;
  creado_en:    string;
  status:       'pendiente' | 'atendido';
  atendido_en:  string | null;
  atendido_por: string | null;
};

export type SolicitudAyuda = {
  id:           number;
  telefono:     string;
  nombre:       string | null;
  consulta:     string | null;
  motivo:       string;
  status:        'pendiente' | 'resuelto' | 'enviado' | 'descartado';
  no_disponible: boolean;
  creado_en:     string;
  resuelto_en:   string | null;
  resuelto_por:  string | null;
  enviado_en:    string | null;
};


// ── View row types ────────────────────────────────────────────────────────────

export type ProfitSummaryRow = {
  ganancia_hoy:    number;
  ingreso_hoy:     number;
  ventas_hoy:      number;
  items_hoy:       number;
  ganancia_ayer:   number;
  ingreso_ayer:    number;
  ventas_ayer:     number;
  items_ayer:      number;
  ganancia_semana: number;
  ingreso_semana:  number;
  ventas_semana:   number;
  items_semana:    number;
  ganancia_mes:    number;
  ingreso_mes:     number;
  ventas_mes:      number;
  items_mes:       number;
  ticket_promedio: number;
};

export type ProfitDailyRow = {
  dia:          string;
  num_ventas:   number;
  ingreso_bruto:number;
  num_items:    number;
  ganancia:     number;
};

export type ProfitHourlyRow = {
  hora:          string;
  num_ventas:    number;
  ingreso_bruto: number;
  num_items:     number;
  ganancia:      number;
};



export type TopProductoRow = {
  codigo_producto:   string;
  descripcion:       string;
  unidades_vendidas: number;
  ingreso:           number;
  ganancia:          number;
};

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Retorna la fecha local en formato YYYY-MM-DD sin depender de UTC.
 */
export function getLocalDateStr(): string {
  const d = new Date();
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Retorna la fecha local restando días en formato YYYY-MM-DD.
 */
export function getDateDaysAgo(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}
