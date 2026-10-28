/**
 * Strict JSON Schema definition for OpenRouter structured extraction.
 * Mirrors src/lib/facturaExtractionContract.ts (Contract Version 1).
 *
 * Strict Mode Rules:
 * - additionalProperties: false on every object.
 * - Every property defined in properties must be in required.
 * - Optional/nullable fields declare type as an array containing 'null'.
 * - Zero authority keys (compraId, aprobado, skuMatch, stockAjuste, etc.).
 */

export const EXTRACTION_JSON_SCHEMA = {
  type: 'object',
  properties: {
    version: {
      type: 'integer',
      enum: [1],
      description: 'Versión del contrato, debe ser exactamente 1',
    },
    cabecera: {
      type: 'object',
      properties: {
        proveedorNombre: {
          type: ['string', 'null'],
          description: 'Nombre o razón social del proveedor según el encabezado',
        },
        proveedorRif: {
          type: ['string', 'null'],
          description: 'RIF o número fiscal del proveedor',
        },
        numeroDocumento: {
          type: ['string', 'null'],
          description: 'Número de factura impreso',
        },
        numeroControl: {
          type: ['string', 'null'],
          description: 'Número de control fiscal si está presente',
        },
        fechaEmision: {
          type: ['string', 'null'],
          description: 'Fecha de emisión en formato YYYY-MM-DD o literal legible',
        },
        moneda: {
          type: ['string', 'null'],
          description: 'Moneda del documento, e.g. USD, VES',
        },
        tasaCambio: {
          type: ['string', 'null'],
          description: 'Tasa de cambio como texto decimal exacto, nunca número',
        },
        subtotal: {
          type: ['string', 'null'],
          description: 'Only an explicitly printed, labeled subtotal as exact decimal text. Null when absent or illegible; do not derive it from total or line sums. Equal separately printed subtotal and total are valid.',
        },
        descuentos: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              orden: {
                type: 'integer',
                description: 'Orden secuencial de aplicación del descuento',
              },
              porcentaje: {
                type: ['string', 'null'],
                description: 'Porcentaje de descuento como texto decimal exacto',
              },
              monto: {
                type: ['string', 'null'],
                description: 'Monto de descuento como texto decimal exacto',
              },
              alcance: {
                type: ['string', 'null'],
                enum: ['renglon', 'global', null],
                description: 'Alcance del descuento',
              },
              incluidoEnPrecio: {
                type: ['boolean', 'null'],
                description: 'Indica si el descuento ya está restado del precio',
              },
            },
            required: ['orden', 'porcentaje', 'monto', 'alcance', 'incluidoEnPrecio'],
            additionalProperties: false,
          },
          description: 'Descuentos globales a nivel de cabecera',
        },
        impuestos: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              tasa: {
                type: ['string', 'null'],
                description: 'Tasa o alícuota del impuesto como texto decimal',
              },
              base: {
                type: ['string', 'null'],
                description: 'Base imponible como texto decimal',
              },
              monto: {
                type: ['string', 'null'],
                description: 'Monto del impuesto como texto decimal',
              },
              exento: {
                type: ['boolean', 'null'],
                description: 'Indica si la base o monto corresponde a renglones exentos',
              },
            },
            required: ['tasa', 'base', 'monto', 'exento'],
            additionalProperties: false,
          },
          description: 'Desglose de impuestos',
        },
        total: {
          type: ['string', 'null'],
          description: 'Only the explicitly printed total payable as exact decimal text; null if absent or illegible. Do not calculate it from other fields.',
        },
      },
      required: [
        'proveedorNombre',
        'proveedorRif',
        'numeroDocumento',
        'numeroControl',
        'fechaEmision',
        'moneda',
        'tasaCambio',
        'subtotal',
        'descuentos',
        'impuestos',
        'total',
      ],
      additionalProperties: false,
    },
    lineas: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          numeroLinea: {
            type: 'integer',
            description: 'Número de línea secuencial comenzando en 1',
          },
          pagina: {
            type: ['integer', 'null'],
            description: 'Número de página donde se ubica el renglón (>= 1)',
          },
          codigoProveedor: {
            type: ['string', 'null'],
            description: 'Código del producto impreso en factura. OBLIGATORIO cadena para preservar ceros a la izquierda, NUNCA número',
          },
          descripcion: {
            type: ['string', 'null'],
            description: 'Descripción textual del producto o null si no existe',
          },
          cantidad: {
            type: ['string', 'null'],
            description: 'Cantidad facturada como texto decimal exacto',
          },
          unidad: {
            type: ['string', 'null'],
            description: 'Unidad de medida literal, e.g. UND, PZA, CJA, KG',
          },
          precioUnitario: {
            type: ['string', 'null'],
            description: 'Precio unitario como texto decimal exacto',
          },
          descuentos: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                orden: {
                  type: 'integer',
                  description: 'Orden de aplicación del descuento',
                },
                porcentaje: {
                  type: ['string', 'null'],
                  description: 'Porcentaje de descuento como texto decimal',
                },
                monto: {
                  type: ['string', 'null'],
                  description: 'Monto de descuento como texto decimal',
                },
                alcance: {
                  type: ['string', 'null'],
                  enum: ['renglon', 'global', null],
                  description: 'Alcance del descuento',
                },
                incluidoEnPrecio: {
                  type: ['boolean', 'null'],
                  description: 'Si está preincluido en el precio unitario',
                },
              },
              required: ['orden', 'porcentaje', 'monto', 'alcance', 'incluidoEnPrecio'],
              additionalProperties: false,
            },
            description: 'Descuentos aplicados específicamente a esta línea',
          },
          tasaIva: {
            type: ['string', 'null'],
            description: 'Porcentaje de IVA aplicable a la línea como texto decimal o null',
          },
          total: {
            type: ['string', 'null'],
            description: 'Importe total de la línea como texto decimal exacto',
          },
          incertidumbre: {
            type: ['object', 'null'],
            properties: {
              confianzaLectura: {
                type: ['number', 'null'],
                description: 'Confianza estimada de lectura entre 0.0 y 1.0',
              },
              advertencias: {
                type: 'array',
                items: { type: 'string' },
                description: 'Lista de advertencias sobre la legibilidad de la línea',
              },
              campoDudoso: {
                type: 'array',
                items: { type: 'string' },
                description: 'Nombres de campos con lectura incierta',
              },
            },
            required: ['confianzaLectura', 'advertencias', 'campoDudoso'],
            additionalProperties: false,
          },
        },
        required: [
          'numeroLinea',
          'pagina',
          'codigoProveedor',
          'descripcion',
          'cantidad',
          'unidad',
          'precioUnitario',
          'descuentos',
          'tasaIva',
          'total',
          'incertidumbre',
        ],
        additionalProperties: false,
      },
      description: 'Lista de renglones o artículos facturados',
    },
    metadatos: {
      type: 'object',
      properties: {
        totalPaginas: {
          type: ['integer', 'null'],
          description: 'Total de páginas detectadas en el documento fuente',
        },
        paginasProcesadas: {
          type: 'array',
          items: { type: 'integer' },
          description: 'Páginas efectivamente leídas y procesadas',
        },
        documentoCompleto: {
          type: ['boolean', 'null'],
          description: 'True si todas las páginas fueron procesadas sin truncamiento',
        },
        advertencias: {
          type: 'array',
          items: { type: 'string' },
          description: 'Advertencias globales sobre el documento',
        },
        confianzaGlobal: {
          type: ['number', 'null'],
          description: 'Estimación de confianza global entre 0.0 y 1.0',
        },
      },
      required: [
        'totalPaginas',
        'paginasProcesadas',
        'documentoCompleto',
        'advertencias',
        'confianzaGlobal',
      ],
      additionalProperties: false,
    },
  },
  required: ['version', 'cabecera', 'lineas', 'metadatos'],
  additionalProperties: false,
} as const;
