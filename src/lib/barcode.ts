/**
 * barcode.ts
 *
 * Utilidades puras para normalización, variantes y conversión de códigos de barras 1D:
 * - UPC-A (12 dígitos) <-> EAN-13 (13 dígitos con '0' inicial) y sin ceros a la izquierda.
 * - UPC-E (6 u 8 dígitos) <-> UPC-A (12 dígitos).
 * - ITF-14 / DUN-14 / GTIN-14 (14 dígitos) -> EAN-13 (13 dígitos) y UPC-A (12 dígitos).
 * - GS1-128 / DataBar con Application Identifier (01) y prefijos de simbología (]C1).
 * - Code 39 con guardas (*CODIGO*) y Codabar (A..D).
 * - Limpieza de caracteres de control, BOM y whitespace invisible.
 */

/** Normaliza texto de búsqueda eliminando acentos/diacríticos y convirtiendo a mayúsculas */
export function normalizeSearchTerm(str: string): string {
  if (!str) return '';
  return str
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase();
}

/** Calcula el dígito verificador módulo 10 estándar GS1 (UPC-A, EAN-8, EAN-13, ITF-14 / GTIN-14) */
export function computeGtinCheckDigit(payloadWithoutCheck: string): string {
  let sum = 0;
  const len = payloadWithoutCheck.length;
  for (let i = 0; i < len; i++) {
    const digit = payloadWithoutCheck.charCodeAt(i) - 48;
    if (digit < 0 || digit > 9) return '';
    const weight = (len - 1 - i) % 2 === 0 ? 3 : 1;
    sum += digit * weight;
  }
  return String((10 - (sum % 10)) % 10);
}

/** Expande un código UPC-E (6, 7 u 8 dígitos) a su equivalente UPC-A de 12 dígitos */
export function expandUPCEtoUPCA(upceRaw: string): string | null {
  const upce = upceRaw.trim();
  if (!/^\d{6,8}$/.test(upce)) return null;

  let numSys = '0';
  let middle = '';
  let providedCheck: string | null = null;

  if (upce.length === 6) {
    middle = upce;
  } else if (upce.length === 7 && (upce[0] === '0' || upce[0] === '1')) {
    numSys = upce[0];
    middle = upce.slice(1, 7);
  } else if (upce.length === 8 && (upce[0] === '0' || upce[0] === '1')) {
    numSys = upce[0];
    middle = upce.slice(1, 7);
    providedCheck = upce[7];
  } else {
    return null;
  }

  const last = middle[5];
  let eleven = '';
  if (last === '0' || last === '1' || last === '2') {
    eleven = `${numSys}${middle.slice(0, 2)}${last}0000${middle.slice(2, 5)}`;
  } else if (last === '3') {
    eleven = `${numSys}${middle.slice(0, 3)}00000${middle.slice(3, 5)}`;
  } else if (last === '4') {
    eleven = `${numSys}${middle.slice(0, 4)}00000${middle[4]}`;
  } else {
    eleven = `${numSys}${middle.slice(0, 5)}0000${last}`;
  }

  const expectedCheck = computeGtinCheckDigit(eleven);
  if (!expectedCheck) return null;
  if (providedCheck !== null && providedCheck !== expectedCheck) {
    return null;
  }
  return `${eleven}${expectedCheck}`;
}

/** Comprime un UPC-A de 12 dígitos a UPC-E (8 y 6 dígitos) cuando cumple el patrón de ceros */
export function compressUPCAtoUPCE(upcaRaw: string): { upce8: string; upce6: string } | null {
  const upca = upcaRaw.trim();
  if (!/^[01]\d{11}$/.test(upca)) return null;
  const expectedCheck = computeGtinCheckDigit(upca.slice(0, 11));
  if (expectedCheck !== upca[11]) return null;

  const ns = upca[0];
  const check = upca[11];
  let middle: string | null = null;

  if (['0', '1', '2'].includes(upca[3]) && upca.slice(4, 8) === '0000') {
    middle = `${upca.slice(1, 3)}${upca.slice(8, 11)}${upca[3]}`;
  } else if (upca.slice(4, 9) === '00000' && ['3', '4', '5', '6', '7', '8', '9'].includes(upca[3])) {
    middle = `${upca.slice(1, 4)}${upca.slice(9, 11)}3`;
  } else if (upca.slice(5, 10) === '00000' && upca[4] !== '0') {
    middle = `${upca.slice(1, 5)}${upca[10]}4`;
  } else if (
    upca.slice(6, 10) === '0000' &&
    upca[5] !== '0' &&
    ['5', '6', '7', '8', '9'].includes(upca[10])
  ) {
    middle = `${upca.slice(1, 6)}${upca[10]}`;
  }

  if (!middle) return null;
  return {
    upce8: `${ns}${middle}${check}`,
    upce6: middle,
  };
}

/**
 * Limpia prefijos de simbología GS1 (]C1, ]e0, ]d1), caracteres de control invisibles
 * y guardas de inicio/fin de Code 39 (*...*) devueltos por distintos motores de escaneo.
 */
export function cleanScannedBarcode(raw: string): string {
  if (!raw) return '';
  let cleaned = raw
    .replace(/^(\]C1|\]e0|\]d1|\]E0|\]I1)/i, '')
    .replace(/[\x00-\x1f\x7f\u200b]/g, '')
    .trim();

  // Code 39 con asteriscos de guarda (*CODIGO*)
  if (/^\*[^*]+\*$/.test(cleaned) && cleaned.length > 2) {
    cleaned = cleaned.slice(1, -1).trim();
  }

  // GS1-128 / DataBar con Application Identifier (01) + GTIN-14
  const gs1Match = cleaned.match(/^(?:\(01\)|01)(\d{14})(?:$|\D|\d{2,})/);
  if (gs1Match && cleaned.length >= 16) {
    return gs1Match[1];
  }

  return cleaned;
}

/**
 * Genera todas las variantes equivalentes entre formatos de códigos de barras:
 * - UPC-A (12 dígitos) <-> EAN-13 (13 dígitos con 0 inicial) y versión sin ceros a la izquierda
 * - UPC-E (6, 7 u 8 dígitos) <-> UPC-A (12 dígitos) <-> EAN-13 (13 dígitos)
 * - ITF-14 / DUN-14 / GTIN-14 / GS1 DataBar (14 dígitos) -> EAN-13 (13 dígitos) y UPC-A (12 dígitos)
 * - GS1-128 con prefijo ]C1 / AI (01)
 * - Suplementos EAN/UPC de 2 o 5 dígitos (14, 15, 17, 18 dígitos)
 * - Codabar con letras de guarda (A..D / T, N, *, E) y Code 39 con guardas (*)
 */
export function buildBarcodeSearchVariants(rawCode: string): string[] {
  const initialTrimmed = (rawCode || '').trim();
  if (!initialTrimmed) return [];

  const variants = new Set<string>();
  const cleaned = cleanScannedBarcode(initialTrimmed);
  variants.add(initialTrimmed);
  if (cleaned) {
    variants.add(cleaned);
  }

  // Code 39 (*...*) si se pasó directo sin limpiar
  if (/^\*[^*]+\*$/.test(initialTrimmed) && initialTrimmed.length > 2) {
    variants.add(initialTrimmed.slice(1, -1).trim());
  }

  // Codabar: guardas A, B, C, D, T, N, E al inicio y al final envolviendo dígitos/símbolos Codabar
  if (/^[A-DTNE][0-9\-$:/.+]{3,}[A-DTNE]$/i.test(cleaned)) {
    const innerCodabar = cleaned.slice(1, -1);
    variants.add(innerCodabar);
  }

  const addUpcEanFamily = (numCode: string): void => {
    if (!/^\d{6,18}$/.test(numCode)) return;
    variants.add(numCode);

    // 1. Si es UPC-E (6, 7 u 8 dígitos), expandir a UPC-A (12) y EAN-13 (13)
    if (numCode.length >= 6 && numCode.length <= 8) {
      const expandedUpca = expandUPCEtoUPCA(numCode);
      if (expandedUpca) {
        variants.add(expandedUpca);
        variants.add(`0${expandedUpca}`);
        if (numCode.length === 8) {
          variants.add(numCode.slice(1, 7));
        }
      }
    }

    // 2. Si es UPC-A (12 dígitos)
    if (numCode.length === 12) {
      variants.add(`0${numCode}`);
      const compressed = compressUPCAtoUPCE(numCode);
      if (compressed) {
        variants.add(compressed.upce8);
        variants.add(compressed.upce6);
      }
    }

    // 3. Si es EAN-13 (13 dígitos) con 0 inicial -> equivale a UPC-A de 12 dígitos
    if (numCode.length === 13 && numCode.startsWith('0')) {
      const upca = numCode.slice(1);
      variants.add(upca);
      const compressed = compressUPCAtoUPCE(upca);
      if (compressed) {
        variants.add(compressed.upce8);
        variants.add(compressed.upce6);
      }
    }

    // 4. Si es ITF-14 / DUN-14 / GTIN-14 / GS1 DataBar (14 dígitos)
    if (numCode.length === 14) {
      if (numCode.startsWith('0')) {
        const ean13 = numCode.slice(1);
        variants.add(ean13);
        if (ean13.startsWith('0')) {
          variants.add(ean13.slice(1));
        }
      }
      // Extraer los 12 dígitos base del producto (quitando indicador de empaque [0] y check digit [13])
      // y recalcular el check digit EAN-13 de la unidad individual
      const itemBase12 = numCode.slice(1, 13);
      const unitCheck = computeGtinCheckDigit(itemBase12);
      if (unitCheck) {
        const unitEan13 = `${itemBase12}${unitCheck}`;
        variants.add(unitEan13);
        if (unitEan13.startsWith('0')) {
          variants.add(unitEan13.slice(1));
        }
      }
    }

    // 5. EAN/UPC con suplemento de 2 o 5 dígitos (15, 17, 18 dígitos)
    if (numCode.length === 15 || numCode.length === 18) {
      const ean13Base = numCode.slice(0, 13);
      variants.add(ean13Base);
      if (ean13Base.startsWith('0')) {
        variants.add(ean13Base.slice(1));
      }
    } else if (numCode.length === 17) {
      const upcaBase = numCode.slice(0, 12);
      variants.add(upcaBase);
      variants.add(`0${upcaBase}`);
    }

    // 6. Versión sin ceros a la izquierda (para códigos cargados como entero en POS)
    const stripped = numCode.replace(/^0+/, '');
    if (stripped.length >= 6 && stripped !== numCode) {
      variants.add(stripped);
      if (stripped.length === 11) {
        variants.add(`0${stripped}`);
        variants.add(`00${stripped}`);
      }
    }
  };

  if (/^\d{6,18}$/.test(cleaned)) {
    addUpcEanFamily(cleaned);
  }

  return Array.from(variants);
}
