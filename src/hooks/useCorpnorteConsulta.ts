import { useConsultaProveedor, ConsultaProveedor } from './useConsultaProveedor';

export type CorpnorteCandidato = {
  sku:        string;   // the supplier's product code
  nombre:     string;
  marca:      string | null;
  similitud:  number;
  disponible: boolean;  // stock > 0 (the supplier's own "disponible" flag is always on)
  stock:      number;
  precio:     number | null;
  bulto:      string | null; // minimum sale, e.g. "12 PIEZAS"
  en_vivo?:   boolean;       // false: the site was unreachable and a saved copy was used
};

export type CorpnorteConsulta = ConsultaProveedor<CorpnorteCandidato>;

/** Availability at Corporación Norte. */
export function useCorpnorteConsulta(codigoInterno: string) {
  return useConsultaProveedor<CorpnorteCandidato>('consultas_corpnorte', codigoInterno);
}
