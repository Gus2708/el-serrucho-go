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
