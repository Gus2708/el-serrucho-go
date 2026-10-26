import {
  aplicarEdicion,
  calcularRevision,
  crearRevisionDesdeExtraccion,
  resolverPrecioVenta,
  type Edicion,
  type RevisionContenido,
} from '../src/lib/facturaRevision.ts';
import type { FacturaExtraccionPayload } from '../src/lib/facturaExtractionContract.ts';

const EXTRACTION_ID = '0a0a0a0a-0a0a-4a0a-8a0a-0a0a0a0a0a0a';
const LINE_ID = '10000000-0000-4000-8000-000000000001';

function extraction(moneda: string | null): FacturaExtraccionPayload {
  return {
    version: 1,
    cabecera: {
      proveedorNombre: 'Proveedor Uno',
      proveedorRif: null,
      numeroDocumento: 'DOC-001',
      numeroControl: null,
      fechaEmision: '2026-10-15',
      moneda,
      tasaCambio: null,
      subtotal: null,
      descuentos: [],
      impuestos: [],
      total: null,
    },
    lineas: [{
      numeroLinea: 1,
      pagina: 1,
      codigoProveedor: 'COD-1',
      descripcion: 'Articulo 1',
      cantidad: '10',
      unidad: 'UND',
      precioUnitario: '0.80',
      descuentos: [],
      tasaIva: '16',
      total: null,
      incertidumbre: null,
    }],
    metadatos: {
      totalPaginas: 1,
      paginasProcesadas: [1],
      documentoCompleto: true,
      advertencias: [],
      confianzaGlobal: null,
    },
  };
}

function confirmedRevision(source: FacturaExtraccionPayload): RevisionContenido {
  const created = crearRevisionDesdeExtraccion(source, EXTRACTION_ID, () => LINE_ID);
  if (!created.ok) throw new Error(JSON.stringify(created.error));

  let content = created.contenido;
  const edits: Edicion[] = [
    { tipo: 'decision_cabecera', campo: 'documentoCompletoConfirmado', valor: true },
    { tipo: 'decision_cabecera', campo: 'recepcionCompleta', valor: true },
    { tipo: 'decision_cabecera', campo: 'precioIncluyeIva', valor: false },
    { tipo: 'factor_conversion', lineaId: LINE_ID, valor: '1' },
    {
      tipo: 'asociacion',
      lineaId: LINE_ID,
      asociacion: { tipo: 'confirmado', codigoInterno: 'SKU-1', evidencia: 'sugerencia', motivo: null },
    },
  ];

  for (const edit of edits) {
    const result = aplicarEdicion(content, source, edit);
    if (!result.ok) throw new Error(JSON.stringify(result.error));
    content = result.contenido;
  }

  return content;
}

let assertions = 0;
function expectEqual(name: string, actual: unknown, expected: unknown): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${name}: expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`);
  }
  assertions += 1;
}

expectEqual(
  'delivery note at cost 10',
  resolverPrecioVenta({ tipoDocumento: 'nota_entrega', costoNetoUnitario: '10.00', precioVenta: null }),
  { valor: '13.00', origen: 'sugerido' },
);
expectEqual(
  'invoice at cost 10',
  resolverPrecioVenta({ tipoDocumento: 'factura', costoNetoUnitario: '10.00', precioVenta: null }),
  { valor: '15.08', origen: 'sugerido' },
);
expectEqual(
  'exact delivery-note decimal',
  resolverPrecioVenta({ tipoDocumento: 'nota_entrega', costoNetoUnitario: '0.1234', precioVenta: null })?.valor,
  '0.16042',
);
expectEqual(
  'exact invoice decimal',
  resolverPrecioVenta({ tipoDocumento: 'factura', costoNetoUnitario: '0.1234', precioVenta: null })?.valor,
  '0.1860872',
);
expectEqual(
  'typed price overrides an unknown type and cost',
  resolverPrecioVenta({ tipoDocumento: null, costoNetoUnitario: null, precioVenta: '20' }),
  { valor: '20', origen: 'usuario' },
);
expectEqual(
  'unknown type has no suggestion',
  resolverPrecioVenta({ tipoDocumento: null, costoNetoUnitario: '10.00', precioVenta: null }),
  null,
);

const unknownCurrency = extraction(null);
const blocked = calcularRevision({
  extraccion: unknownCurrency,
  contenido: confirmedRevision(unknownCurrency),
});
expectEqual('unknown currency remains blocked under production defaults', blocked.bloqueos.map(({ codigo }) => codigo), ['moneda_desconocida']);
console.log(`Invoice calculator verification passed (${assertions} assertions).`);
