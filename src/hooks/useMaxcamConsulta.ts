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
  imagen?:    string | null; // photo URL on Maxcam's server; the app loads it directly
};

export type MaxcamConsulta = ConsultaProveedor<MaxcamCandidato>;

/** Availability at Maxcam (Barquisimeto branch). */
export function useMaxcamConsulta(codigoInterno: string) {
  return useConsultaProveedor<MaxcamCandidato>('consultas_maxcam', codigoInterno);
}
