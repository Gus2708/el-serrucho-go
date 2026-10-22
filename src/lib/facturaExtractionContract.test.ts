import {
  EXTRACTION_CONTRACT_VERSION,
  parseFacturaExtraction,
  type FacturaExtraccionPayload,
} from './facturaExtractionContract';
import { MAX_LINEAS, normalizeDecimal } from './facturaProveedor';

describe('facturaExtractionContract', () => {
  const FIXTURE_CLEAN: FacturaExtraccionPayload = {
    version: EXTRACTION_CONTRACT_VERSION,
    cabecera: {
      proveedorNombre: 'Ferretería Industrial El Serrucho C.A.',
      proveedorRif: 'J-12345678-9',
      numeroDocumento: 'FACT-00921',
      numeroControl: '00-019283',
      fechaEmision: '2026-10-15',
      moneda: 'USD',
      tasaCambio: null,
      subtotal: '120.00',
      descuentos: [],
      impuestos: [{ tasa: '16.00', base: '120.00', monto: '19.20', exento: false }],
      total: '139.20',
    },
    lineas: [
      {
        numeroLinea: 1,
        pagina: 1,
        codigoProveedor: '004128',
        descripcion: 'TORNILLO DRYWALL 6X1',
        cantidad: '100',
        unidad: 'PZA',
        precioUnitario: '0.50',
        descuentos: [],
        tasaIva: '16.00',
        total: '50.00',
        incertidumbre: {
          confianzaLectura: 0.98,
          advertencias: [],
          campoDudoso: [],
        },
      },
    ],
    metadatos: {
      totalPaginas: 1,
      paginasProcesadas: [1],
      documentoCompleto: true,
      advertencias: [],
      confianzaGlobal: 0.95,
    },
  };

  describe('valid payload parsing', () => {
    it('parses clean valid synthetic invoice without data loss', () => {
      const result = parseFacturaExtraction(FIXTURE_CLEAN);
      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.data.version).toBe(1);
      expect(result.data.cabecera.proveedorNombre).toBe('Ferretería Industrial El Serrucho C.A.');
      expect(result.data.cabecera.proveedorRif).toBe('J-12345678-9');
      expect(result.data.cabecera.moneda).toBe('USD');
      expect(result.data.lineas).toHaveLength(1);
      expect(result.data.lineas[0].codigoProveedor).toBe('004128');
      expect(result.data.lineas[0].cantidad).toBe('100');
    });

    it('does not mutate the input payload', () => {
      const copy = JSON.parse(JSON.stringify(FIXTURE_CLEAN));
      Object.freeze(copy);
      Object.freeze(copy.cabecera);
      Object.freeze(copy.lineas);
      Object.freeze(copy.metadatos);

      const result = parseFacturaExtraction(copy);
      expect(result.ok).toBe(true);
      expect(copy).toEqual(FIXTURE_CLEAN);
    });

    it('is strictly deterministic on identical input', () => {
      const result1 = parseFacturaExtraction(FIXTURE_CLEAN);
      const result2 = parseFacturaExtraction(FIXTURE_CLEAN);
      expect(result1).toEqual(result2);
    });
  });

  describe('parent regressions: malformed object and collection types', () => {
    it('rejects payload when cabecera is a primitive number like 42', () => {
      const payload = {
        version: 1,
        cabecera: 42,
        lineas: [],
        metadatos: {
          totalPaginas: 1,
          paginasProcesadas: [1],
          documentoCompleto: true,
          advertencias: [],
          confianzaGlobal: null,
        },
      };

      const result = parseFacturaExtraction(payload);
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe('invalid_field_type');
      expect(result.error.message).toMatch(/cabecera.*objeto/i);
    });

    it('rejects payload when cabecera.descuentos is a string instead of an array', () => {
      const payload = {
        ...FIXTURE_CLEAN,
        cabecera: {
          ...FIXTURE_CLEAN.cabecera,
          descuentos: '10%',
        },
      };

      const result = parseFacturaExtraction(payload);
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe('invalid_field_type');
      expect(result.error.message).toMatch(/descuentos.*arreglo/i);
    });

    it('rejects payload when metadatos contains negative pages or invalid numbers', () => {
      const payload = {
        ...FIXTURE_CLEAN,
        metadatos: {
          totalPaginas: -2,
          paginasProcesadas: [0, -1],
          documentoCompleto: true,
          advertencias: [],
          confianzaGlobal: null,
        },
      };

      const result = parseFacturaExtraction(payload);
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe('invalid_field_value');
    });

    it('rejects payload when metadatos is a non-object', () => {
      const payload = {
        version: 1,
        cabecera: FIXTURE_CLEAN.cabecera,
        lineas: [],
        metadatos: 'complete',
      };

      const result = parseFacturaExtraction(payload);
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe('invalid_field_type');
    });

    it('rejects malformed elements in advertencias instead of silently filtering them', () => {
      const payload = {
        ...FIXTURE_CLEAN,
        metadatos: {
          ...FIXTURE_CLEAN.metadatos,
          advertencias: [123, null],
        },
      };

      const result = parseFacturaExtraction(payload);
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe('invalid_field_type');
    });

    it('rejects malformed elements in paginasProcesadas instead of silently filtering them', () => {
      const payload = {
        ...FIXTURE_CLEAN,
        metadatos: {
          ...FIXTURE_CLEAN.metadatos,
          paginasProcesadas: ['1', 2],
        },
      };

      const result = parseFacturaExtraction(payload);
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe('invalid_field_type');
    });
  });

  describe('completeness and page count consistency', () => {
    it('rejects documentoCompleto true when processed pages do not match totalPaginas', () => {
      const payload = {
        ...FIXTURE_CLEAN,
        metadatos: {
          totalPaginas: 3,
          paginasProcesadas: [1, 2],
          documentoCompleto: true, // claiming complete when page 3 is missing
          advertencias: [],
          confianzaGlobal: 0.9,
        },
      };

      const result = parseFacturaExtraction(payload);
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe('inconsistent_document_completeness');
    });

    it('accepts incomplete document staging with documentoCompleto false and partial pages', () => {
      const payload = {
        ...FIXTURE_CLEAN,
        metadatos: {
          totalPaginas: 3,
          paginasProcesadas: [1, 2],
          documentoCompleto: false,
          advertencias: ['Falta página 3'],
          confianzaGlobal: 0.9,
        },
      };

      const result = parseFacturaExtraction(payload);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.data.metadatos.documentoCompleto).toBe(false);
    });

    it('accepts document with documentoCompleto null when page count is unknown', () => {
      const payload = {
        ...FIXTURE_CLEAN,
        metadatos: {
          totalPaginas: null,
          paginasProcesadas: [1],
          documentoCompleto: null,
          advertencias: [],
          confianzaGlobal: null,
        },
      };

      const result = parseFacturaExtraction(payload);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.data.metadatos.documentoCompleto).toBeNull();
    });
  });

  describe('reading confidence validation', () => {
    it.each([-0.1, 1.1, NaN, Infinity, '0.9'])(
      'rejects invalid reading confidence value %s',
      (badValue) => {
        const payload = {
          ...FIXTURE_CLEAN,
          metadatos: {
            ...FIXTURE_CLEAN.metadatos,
            confianzaGlobal: badValue,
          },
        };

        const result = parseFacturaExtraction(payload);
        expect(result.ok).toBe(false);
        if (result.ok) return;
        expect(result.error.code).toMatch(/invalid_field_value|invalid_field_type/);
      },
    );

    it('rejects line reading confidence outside [0, 1]', () => {
      const payload = {
        ...FIXTURE_CLEAN,
        lineas: [
          {
            ...FIXTURE_CLEAN.lineas[0],
            incertidumbre: {
              confianzaLectura: 1.5,
              advertencias: [],
              campoDudoso: [],
            },
          },
        ],
      };

      const result = parseFacturaExtraction(payload);
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe('invalid_field_value');
    });
  });

  describe('unexpected keys rejection (no silent drop)', () => {
    it('rejects unexpected key at root of payload', () => {
      const payload = {
        ...FIXTURE_CLEAN,
        unrecognizedRootKey: 'unexpected',
      };

      const result = parseFacturaExtraction(payload);
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe('unexpected_field');
      expect(result.error.message).toMatch(/campo no reconocido.*unrecognizedRootKey/i);
    });

    it('rejects unexpected key in cabecera', () => {
      const payload = {
        ...FIXTURE_CLEAN,
        cabecera: {
          ...FIXTURE_CLEAN.cabecera,
          foo: 'bar',
        },
      };

      const result = parseFacturaExtraction(payload);
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe('unexpected_field');
    });

    it('rejects unexpected key in line item', () => {
      const payload = {
        ...FIXTURE_CLEAN,
        lineas: [
          {
            ...FIXTURE_CLEAN.lineas[0],
            extraLineParam: 99,
          },
        ],
      };

      const result = parseFacturaExtraction(payload);
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe('unexpected_field');
    });
  });

  describe('raw evidence preservation (no silent trimming)', () => {
    it('preserves untrimmed raw strings exactly as provided', () => {
      const payload = {
        ...FIXTURE_CLEAN,
        cabecera: {
          ...FIXTURE_CLEAN.cabecera,
          proveedorNombre: ' Ferretería Industrial El Serrucho C.A. ',
        },
        lineas: [
          {
            ...FIXTURE_CLEAN.lineas[0],
            codigoProveedor: ' 004128 ',
            descripcion: ' TORNILLO DRYWALL 6X1 ',
          },
        ],
      };

      const result = parseFacturaExtraction(payload);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.data.cabecera.proveedorNombre).toBe(' Ferretería Industrial El Serrucho C.A. ');
      expect(result.data.lineas[0].codigoProveedor).toBe(' 004128 ');
      expect(result.data.lineas[0].descripcion).toBe(' TORNILLO DRYWALL 6X1 ');
    });
  });

  describe('unknown nullables: description, taxes, and amount-only discounts', () => {
    it('accepts null line description when item text is unreadable or torn', () => {
      const payload = {
        ...FIXTURE_CLEAN,
        lineas: [
          {
            ...FIXTURE_CLEAN.lineas[0],
            descripcion: null,
            incertidumbre: {
              confianzaLectura: 0.1,
              advertencias: ['Descripción ilegible en papel rasgado'],
              campoDudoso: ['descripcion'],
            },
          },
        ],
      };

      const result = parseFacturaExtraction(payload);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.data.lineas[0].descripcion).toBeNull();
    });

    it('accepts amount-only discount with null percentage', () => {
      const payload = {
        ...FIXTURE_CLEAN,
        lineas: [
          {
            ...FIXTURE_CLEAN.lineas[0],
            descuentos: [
              { orden: 1, porcentaje: null, monto: '5.00', alcance: 'renglon', incluidoEnPrecio: false },
            ],
          },
        ],
      };

      const result = parseFacturaExtraction(payload);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.data.lineas[0].descuentos[0].porcentaje).toBeNull();
      expect(result.data.lineas[0].descuentos[0].monto).toBe('5.00');
      expect(result.data.lineas[0].descuentos[0].alcance).toBe('renglon');
      expect(result.data.lineas[0].descuentos[0].incluidoEnPrecio).toBe(false);
    });

    it('preserves null exento and null tasa on tax item when unknown without asserting false', () => {
      const payload = {
        ...FIXTURE_CLEAN,
        cabecera: {
          ...FIXTURE_CLEAN.cabecera,
          impuestos: [
            { tasa: null, base: '120.00', monto: null, exento: null },
          ],
        },
      };

      const result = parseFacturaExtraction(payload);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.data.cabecera.impuestos[0].tasa).toBeNull();
      expect(result.data.cabecera.impuestos[0].exento).toBeNull();
    });
  });

  describe('literal printed codes and leading zeros', () => {
    it('preserves leading zeros and alphanumeric characters in printed supplier code', () => {
      const payload = {
        ...FIXTURE_CLEAN,
        lineas: [
          {
            ...FIXTURE_CLEAN.lineas[0],
            codigoProveedor: '0000845-BR',
          },
        ],
      };

      const result = parseFacturaExtraction(payload);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.data.lineas[0].codigoProveedor).toBe('0000845-BR');
    });

    it('rejects numeric supplier code without coercing to string to prevent loss of leading zeros', () => {
      const payload = {
        ...FIXTURE_CLEAN,
        lineas: [
          {
            ...FIXTURE_CLEAN.lineas[0],
            codigoProveedor: 4128,
          },
        ],
      };

      const result = parseFacturaExtraction(payload);
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe('invalid_field_type');
      expect(result.error.message).toMatch(/código de proveedor.*texto/i);
    });
  });

  describe('decimal numbers and bounds', () => {
    it('rejects numeric amounts without silently converting them to strings', () => {
      const payload = {
        ...FIXTURE_CLEAN,
        lineas: [
          {
            ...FIXTURE_CLEAN.lineas[0],
            cantidad: 100,
          },
        ],
      };

      const result = parseFacturaExtraction(payload);
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe('invalid_field_type');
      expect(result.error.message).toMatch(/cantidad.*texto/i);
    });

    it('accepts both comma and dot decimals without mutating the literal text', () => {
      const payload = {
        ...FIXTURE_CLEAN,
        lineas: [
          {
            ...FIXTURE_CLEAN.lineas[0],
            cantidad: '12,500',
            precioUnitario: '1.250000',
          },
        ],
      };

      const result = parseFacturaExtraction(payload);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.data.lineas[0].cantidad).toBe('12,500');
      expect(result.data.lineas[0].precioUnitario).toBe('1.250000');
    });

    it('rejects invalid decimal strings using normalizeDecimal shape rules', () => {
      const payload = {
        ...FIXTURE_CLEAN,
        lineas: [
          {
            ...FIXTURE_CLEAN.lineas[0],
            precioUnitario: '12.34.56',
          },
        ],
      };

      const result = parseFacturaExtraction(payload);
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe('invalid_decimal_format');
    });

    it('pins normalizeDecimal compatibility with existing domain bounds', () => {
      const shape = { intDigits: 9, scale: 6 };
      expect(normalizeDecimal('12.345678', shape)).toEqual({ ok: true, value: '12.345678' });
      expect(normalizeDecimal('12,345678', shape)).toEqual({ ok: true, value: '12.345678' });
      expect(normalizeDecimal('abc', shape)).toEqual({ ok: false, error: expect.any(String) });
      expect(normalizeDecimal('-5', shape)).toEqual({ ok: false, error: expect.any(String) });
    });
  });

  describe('unreadable values remain null', () => {
    it('preserves null for unreadable header and line fields without zero-filling', () => {
      const payload = {
        ...FIXTURE_CLEAN,
        cabecera: {
          ...FIXTURE_CLEAN.cabecera,
          moneda: null,
          subtotal: null,
          total: null,
        },
        lineas: [
          {
            ...FIXTURE_CLEAN.lineas[0],
            codigoProveedor: null,
            cantidad: null,
            precioUnitario: null,
            total: null,
          },
        ],
      };

      const result = parseFacturaExtraction(payload);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.data.cabecera.moneda).toBeNull();
      expect(result.data.cabecera.subtotal).toBeNull();
      expect(result.data.cabecera.total).toBeNull();
      expect(result.data.lineas[0].codigoProveedor).toBeNull();
      expect(result.data.lineas[0].cantidad).toBeNull();
      expect(result.data.lineas[0].precioUnitario).toBeNull();
      expect(result.data.lineas[0].total).toBeNull();
    });

    it('does not infer or default currency to USD when missing or unreadable', () => {
      const payload = {
        ...FIXTURE_CLEAN,
        cabecera: {
          ...FIXTURE_CLEAN.cabecera,
          moneda: 'VES',
        },
      };

      const result = parseFacturaExtraction(payload);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.data.cabecera.moneda).toBe('VES');
    });
  });

  describe('ordered cascaded discounts', () => {
    it('preserves ordered array of discounts without collapsing or calculating net', () => {
      const payload = {
        ...FIXTURE_CLEAN,
        lineas: [
          {
            ...FIXTURE_CLEAN.lineas[0],
            descuentos: [
              { orden: 1, porcentaje: '20.00', monto: null, alcance: 'renglon', incluidoEnPrecio: null },
              { orden: 2, porcentaje: '5.00', monto: null, alcance: 'renglon', incluidoEnPrecio: null },
            ],
          },
        ],
      };

      const result = parseFacturaExtraction(payload);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.data.lineas[0].descuentos).toHaveLength(2);
      expect(result.data.lineas[0].descuentos[0]).toEqual({
        orden: 1,
        porcentaje: '20.00',
        monto: null,
        alcance: 'renglon',
        incluidoEnPrecio: null,
      });
      expect(result.data.lineas[0].descuentos[1]).toEqual({
        orden: 2,
        porcentaje: '5.00',
        monto: null,
        alcance: 'renglon',
        incluidoEnPrecio: null,
      });
    });
  });

  describe('repeated SKU preservation', () => {
    it('preserves distinct repeated SKU lines without deduplication or merging', () => {
      const payload = {
        ...FIXTURE_CLEAN,
        lineas: [
          {
            ...FIXTURE_CLEAN.lineas[0],
            numeroLinea: 1,
            codigoProveedor: 'SKU-REPEAT',
            cantidad: '10',
            precioUnitario: '2.00',
            total: '20.00',
          },
          {
            ...FIXTURE_CLEAN.lineas[0],
            numeroLinea: 2,
            codigoProveedor: 'SKU-REPEAT',
            cantidad: '15',
            precioUnitario: '2.10',
            total: '31.50',
          },
        ],
      };

      const result = parseFacturaExtraction(payload);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.data.lineas).toHaveLength(2);
      expect(result.data.lineas[0].codigoProveedor).toBe('SKU-REPEAT');
      expect(result.data.lineas[1].codigoProveedor).toBe('SKU-REPEAT');
      expect(result.data.lineas[0].cantidad).toBe('10');
      expect(result.data.lineas[1].cantidad).toBe('15');
    });
  });

  describe('rejection of unauthorized authority fields', () => {
    it.each([
      ['compraId', { compraId: 'compra_123' }],
      ['aprobado', { aprobado: true }],
      ['skuMatch', { skuMatch: 'COD-001' }],
      ['compensacionNegativo', { compensacionNegativo: 5 }],
      ['stockAjuste', { stockAjuste: 10 }],
    ])('rejects payload attempting authority with %s at root', (_, forbidden) => {
      const payload = { ...FIXTURE_CLEAN, ...forbidden };
      const result = parseFacturaExtraction(payload);
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe('forbidden_authority_field');
      expect(result.error.message).toMatch(/campo no autorizado/i);
    });

    it('rejects line-level catalog match authority fields like codigoProducto', () => {
      const payload = {
        ...FIXTURE_CLEAN,
        lineas: [
          {
            ...FIXTURE_CLEAN.lineas[0],
            codigoProducto: 'INT-001',
          },
        ],
      };

      const result = parseFacturaExtraction(payload);
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe('forbidden_authority_field');
    });

    it('rejects forbidden authority key placed inside uncertainty object', () => {
      const payload = {
        ...FIXTURE_CLEAN,
        lineas: [
          {
            ...FIXTURE_CLEAN.lineas[0],
            incertidumbre: {
              confianzaLectura: 0.9,
              advertencias: [],
              campoDudoso: [],
              aprobado: true, // smuggled authority
            },
          },
        ],
      };

      const result = parseFacturaExtraction(payload);
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe('forbidden_authority_field');
    });
  });

  describe('version and bounds enforcement', () => {
    it('rejects unsupported contract version', () => {
      const payload = { ...FIXTURE_CLEAN, version: 99 };
      const result = parseFacturaExtraction(payload);
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe('unsupported_version');
    });

    it('rejects payload exceeding MAX_LINEAS', () => {
      const lineas = Array.from({ length: MAX_LINEAS + 1 }, (_, index) => ({
        ...FIXTURE_CLEAN.lineas[0],
        numeroLinea: index + 1,
      }));
      const payload = { ...FIXTURE_CLEAN, lineas };

      const result = parseFacturaExtraction(payload);
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe('max_lines_exceeded');
    });

    it('rejects text fields exceeding length bounds before processing', () => {
      const payload = {
        ...FIXTURE_CLEAN,
        cabecera: {
          ...FIXTURE_CLEAN.cabecera,
          proveedorNombre: 'A'.repeat(250),
        },
      };

      const result = parseFacturaExtraction(payload);
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe('text_length_exceeded');
    });
  });
});
