import type { BrandColors } from '../theme/brands/types';

/**
 * Lógica compartida del libro de créditos.
 *
 * Todo lo que traduce un número a algo que el usuario lee vive aquí, para que la
 * lista, el detalle y los modales nunca discrepen sobre qué significa un saldo.
 */

/** Un saldo positivo es deuda; negativo es plata que el cliente adelantó. */
export type SaldoEstado = 'debe' | 'al_dia' | 'a_favor';

export function saldoEstado(saldo: number): SaldoEstado {
  // Tolerancia de medio centavo: el saldo viene de numeric(14,2), pero JSON lo
  // entrega como float. Sin esto, un 0 exacto podría leerse como 1e-15 y pintar
  // "Debe $0.00", que es justo la clase de detalle que hace desconfiar del sistema.
  if (saldo > 0.005) return 'debe';
  if (saldo < -0.005) return 'a_favor';
  return 'al_dia';
}

export function saldoColor(saldo: number, colors: BrandColors): string {
  const estado = saldoEstado(saldo);
  if (estado === 'debe') return colors.danger;
  if (estado === 'a_favor') return colors.primary;
  return colors.success;
}

/** Etiqueta en lenguaje de mostrador, no de contador. */
export function saldoLabel(saldo: number): string {
  const estado = saldoEstado(saldo);
  if (estado === 'debe') return 'Debe';
  if (estado === 'a_favor') return 'A favor';
  return 'Al día';
}

export const METODOS = [
  { value: 'efectivo',      label: 'Efectivo',      icon: 'dollar-sign'   },
  { value: 'zelle',         label: 'Zelle',         icon: 'send'          },
  { value: 'pago_movil',    label: 'Pago Móvil',    icon: 'smartphone'    },
  { value: 'transferencia', label: 'Transferencia', icon: 'repeat'        },
  { value: 'otro',          label: 'Otro',          icon: 'more-horizontal' },
] as const;

export type CreditoMetodo = (typeof METODOS)[number]['value'];

export function metodoLabel(metodo: string | null): string {
  return METODOS.find(m => m.value === metodo)?.label ?? 'Efectivo';
}

/**
 * Convierte lo que el usuario tecleó en un monto confiable, o `null` si no lo es.
 *
 * Acepta la coma decimal venezolana ("12,50") y separadores de miles ("1.250,00"),
 * porque el cajero va a escribir ambos. Rechaza vacío, negativos, cero, NaN e
 * Infinity — no hay monto válido fuera de (0, 1.000.000).
 *
 * Redondea a 2 decimales para calzar con el `numeric(14,2)` de la base: así lo
 * que se ve en pantalla es exactamente lo que se guarda.
 */
export function parseMonto(texto: string): number | null {
  const limpio = texto.trim();
  if (limpio === '') return null;

  // "1.250,00" → coma decimal: el punto es separador de miles.
  // "1250.00"  → punto decimal: se deja tal cual.
  const normalizado = limpio.includes(',')
    ? limpio.replace(/\./g, '').replace(',', '.')
    : limpio;

  if (!/^\d*\.?\d*$/.test(normalizado)) return null;

  const valor = Number(normalizado);
  if (!Number.isFinite(valor) || valor <= 0 || valor >= 1_000_000) return null;

  return Math.round(valor * 100) / 100;
}

/** Fecha corta para timelines: "4 ago", o "4 ago 2025" si es de otro año. */
export function fechaCorta(fecha: string): string {
  const d = new Date(`${fecha.slice(0, 10)}T12:00:00`);
  if (Number.isNaN(d.getTime())) return fecha;

  const mes = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'][d.getMonth()];
  const esteAno = d.getFullYear() === new Date().getFullYear();
  return esteAno ? `${d.getDate()} ${mes}` : `${d.getDate()} ${mes} ${d.getFullYear()}`;
}

/**
 * "Hace 3 días" — para que el usuario sepa de un vistazo si una deuda se enfrió
 * sin tener que restar fechas mentalmente.
 */
export function antiguedad(fecha: string | null): string {
  if (!fecha) return 'sin movimientos';

  const d = new Date(`${fecha.slice(0, 10)}T12:00:00`);
  if (Number.isNaN(d.getTime())) return '';

  const hoy = new Date();
  const dias = Math.floor((hoy.getTime() - d.getTime()) / 86_400_000);

  if (dias <= 0) return 'hoy';
  if (dias === 1) return 'ayer';
  if (dias < 30) return `hace ${dias} días`;
  if (dias < 60) return 'hace 1 mes';
  if (dias < 365) return `hace ${Math.floor(dias / 30)} meses`;
  return 'hace más de un año';
}
