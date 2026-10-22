import { useConsultaProveedor, ConsultaProveedor } from './useConsultaProveedor';

export type MaxcamCandidato = {
  sku:        string;
  nombre:     string;
  marca:      string | null;
  similitud:  number;
  disponible: boolean;
  stock_bq:   number;
  precio:     number | null;
  cant_caja:  number | null;
};

export type MaxcamConsulta = ConsultaProveedor<MaxcamCandidato>;

/** Availability at Maxcam (Barquisimeto branch). */
export function useMaxcamConsulta(codigoInterno: string) {
  return useConsultaProveedor<MaxcamCandidato>('consultas_maxcam', codigoInterno);
}
