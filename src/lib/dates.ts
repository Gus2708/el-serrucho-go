/**
 * Helpers de fecha local sin dependencias de React Native, para que puedan
 * usarse tanto en la app como en módulos que corren en Node (tests, data demo).
 */

/** Retorna la fecha local de hoy en formato YYYY-MM-DD. */
export function getLocalDateStr(): string {
  const d = new Date();
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/** Retorna la fecha local restando días en formato YYYY-MM-DD. */
export function getDateDaysAgo(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}
