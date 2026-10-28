-- Supplier-invoice automation: optional PVP review keys in revision content (review_schema 1).
--
-- Scope: the content validator accepts two OPTIONAL keys, validated and nothing else:
--   cabecera.tipoDocumento  'factura' | 'nota_entrega'  (the human's document-type choice)
--   renglon.precioVenta     positive decimal string, same bounds as the other decimals
--                           (up to 12 integer and 8 fraction digits): a price the user typed
-- Both are omitted when unset. Content without them is accepted exactly as before, so every
-- stored revision, fingerprint (sha256 of the jsonb text) and attestation is unchanged: no row
-- is read or rewritten here. Unknown keys, null/blank/zero/negative values and malformed
-- shapes are still refused with 22023. A suggested price is never stored: it is derived by
-- the client from the approved net unit cost, and a later purchase step must recompute it
-- from the approved data. Nothing here trusts a client amount, materializes a purchase or
-- changes any other function.
--
-- The validator is replaced IN PLACE (CREATE OR REPLACE keeps its identity and ACL), so
-- guardar_revision_factura and aprobar_revision_factura, including calls already warmed in an
-- open session, pick the new body up without being touched. All earlier rules are kept
-- verbatim: required keys, the manual-line motive rule (a price alone does not satisfy it),
-- extraction coverage and source-line uniqueness.
--
-- Rollout limit: a client that sends the new keys needs this migration applied first; an
-- older server refuses them with 22023. Old clients cannot read revisions containing the new
-- keys (they fail closed), so the client update and migration must be coordinated. Not applied remotely.

CREATE OR REPLACE FUNCTION facturas_privado.validar_contenido_revision(p_contenido jsonb, p_extraccion_id uuid, p_resultado jsonb)
RETURNS void
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_cab      jsonb;
  v_cab_base jsonb;
  v_linea_base jsonb;
  v_linea    jsonb;
  v_pos      bigint;
  v_ids      text[] := ARRAY[]::text[];
  v_origenes bigint[] := ARRAY[]::bigint[];
  v_origen   bigint;
  v_id       text;
  v_factor   jsonb;
  v_aso      jsonb;
  v_tipo     text;
  v_evidencia text;
  v_motivo   jsonb;
  v_fuentes  integer;
BEGIN
  IF NOT facturas_privado.claves_exactas(p_contenido, ARRAY[
       'review_schema', 'calculo_version', 'matching_version', 'extraccion_id', 'cabecera', 'lineas']) THEN
    RAISE EXCEPTION 'payload_invalido: claves de contenido' USING ERRCODE = '22023';
  END IF;
  IF jsonb_typeof(p_contenido -> 'review_schema') IS DISTINCT FROM 'number'
     OR (p_contenido ->> 'review_schema') IS DISTINCT FROM '1'
     OR (p_contenido -> 'calculo_version') IS DISTINCT FROM to_jsonb('calc-v1'::text)
     OR (p_contenido -> 'matching_version') IS DISTINCT FROM to_jsonb('matching-v1'::text) THEN
    RAISE EXCEPTION 'payload_invalido: version de contrato' USING ERRCODE = '22023';
  END IF;
  IF (p_contenido -> 'extraccion_id') IS DISTINCT FROM COALESCE(to_jsonb(p_extraccion_id), 'null'::jsonb) THEN
    RAISE EXCEPTION 'payload_invalido: extraccion_id no coincide con el argumento' USING ERRCODE = '22023';
  END IF;

  v_cab := p_contenido -> 'cabecera';
  -- The only optional header key is tipoDocumento; every other key still has to be one of the five required ones.
  v_cab_base := CASE WHEN jsonb_typeof(v_cab) = 'object' THEN v_cab - 'tipoDocumento' ELSE v_cab END;
  IF NOT facturas_privado.claves_exactas(v_cab_base, ARRAY[
       'correcciones', 'tasaConfirmada', 'precioIncluyeIva', 'recepcionCompleta', 'documentoCompletoConfirmado'])
     OR jsonb_typeof(v_cab -> 'tasaConfirmada') IS DISTINCT FROM 'null'
     OR jsonb_typeof(v_cab -> 'precioIncluyeIva') NOT IN ('boolean', 'null')
     OR jsonb_typeof(v_cab -> 'recepcionCompleta') NOT IN ('boolean', 'null')
     OR jsonb_typeof(v_cab -> 'documentoCompletoConfirmado') NOT IN ('boolean', 'null') THEN
    RAISE EXCEPTION 'payload_invalido: cabecera' USING ERRCODE = '22023';
  END IF;
  IF v_cab ? 'tipoDocumento'
     AND (jsonb_typeof(v_cab -> 'tipoDocumento') IS DISTINCT FROM 'string'
          OR (v_cab ->> 'tipoDocumento') NOT IN ('factura', 'nota_entrega')) THEN
    RAISE EXCEPTION 'payload_invalido: cabecera tipoDocumento' USING ERRCODE = '22023';
  END IF;
  PERFORM facturas_privado.validar_correcciones_revision(v_cab -> 'correcciones', ARRAY[
    'proveedorNombre', 'proveedorRif', 'numeroDocumento', 'numeroControl', 'fechaEmision',
    'moneda', 'tasaCambio', 'subtotal', 'descuentos', 'impuestos', 'total'], 'cabecera');

  IF jsonb_typeof(p_contenido -> 'lineas') IS DISTINCT FROM 'array'
     OR jsonb_array_length(p_contenido -> 'lineas') > 500 THEN
    RAISE EXCEPTION 'payload_invalido: lineas' USING ERRCODE = '22023';
  END IF;

  FOR v_pos, v_linea IN
    SELECT l.pos, l.elem FROM jsonb_array_elements(p_contenido -> 'lineas') WITH ORDINALITY AS l(elem, pos)
  LOOP
    -- The only optional line key is precioVenta: a positive decimal string the user typed.
    v_linea_base := CASE WHEN jsonb_typeof(v_linea) = 'object' THEN v_linea - 'precioVenta' ELSE v_linea END;
    IF NOT facturas_privado.claves_exactas(v_linea_base, ARRAY[
         'lineaId', 'origen', 'correcciones', 'factorConversion', 'asociacion', 'codigoBarras']) THEN
      RAISE EXCEPTION 'payload_invalido: renglon % claves', v_pos USING ERRCODE = '22023';
    END IF;
    IF v_linea ? 'precioVenta'
       AND (jsonb_typeof(v_linea -> 'precioVenta') IS DISTINCT FROM 'string'
            OR (v_linea ->> 'precioVenta') !~ '^[0-9]{1,12}(\.[0-9]{1,8})?$'
            OR (v_linea ->> 'precioVenta') !~ '[1-9]') THEN
      RAISE EXCEPTION 'payload_invalido: renglon % precioVenta', v_pos USING ERRCODE = '22023';
    END IF;

    -- Stable line identity: unique lowercase UUID per line, repeated SKUs included.
    v_id := CASE WHEN jsonb_typeof(v_linea -> 'lineaId') = 'string' THEN v_linea ->> 'lineaId' END;
    IF v_id IS NULL OR v_id !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
      RAISE EXCEPTION 'payload_invalido: renglon % lineaId', v_pos USING ERRCODE = '22023';
    END IF;
    IF v_id = ANY (v_ids) THEN
      RAISE EXCEPTION 'payload_invalido: renglon % lineaId repetido', v_pos USING ERRCODE = '22023';
    END IF;
    v_ids := v_ids || v_id;

    PERFORM facturas_privado.validar_correcciones_revision(v_linea -> 'correcciones', ARRAY[
      'codigoProveedor', 'descripcion', 'cantidad', 'unidad', 'precioUnitario', 'descuentos', 'tasaIva', 'total'],
      'renglon ' || v_pos);

    -- Source reference: null (manual line, needs a motivated correction) or an extraction line.
    IF jsonb_typeof(v_linea -> 'origen') = 'null' THEN
      IF v_linea -> 'correcciones' = '{}'::jsonb THEN
        RAISE EXCEPTION 'payload_invalido: renglon % manual requiere correccion con motivo', v_pos USING ERRCODE = '22023';
      END IF;
    ELSE
      IF NOT facturas_privado.claves_exactas(v_linea -> 'origen', ARRAY['numeroLinea'])
         OR jsonb_typeof(v_linea -> 'origen' -> 'numeroLinea') IS DISTINCT FROM 'number'
         OR (v_linea -> 'origen' ->> 'numeroLinea') !~ '^[1-9][0-9]{0,8}$' THEN
        RAISE EXCEPTION 'payload_invalido: renglon % origen', v_pos USING ERRCODE = '22023';
      END IF;
      v_origen := (v_linea -> 'origen' ->> 'numeroLinea')::bigint;
      IF p_resultado IS NULL THEN
        RAISE EXCEPTION 'payload_invalido: renglon % origen sin extraccion', v_pos USING ERRCODE = '22023';
      END IF;
      IF v_origen = ANY (v_origenes) THEN
        RAISE EXCEPTION 'payload_invalido: renglon % origen repetido', v_pos USING ERRCODE = '22023';
      END IF;
      v_origenes := v_origenes || v_origen;
      SELECT count(*) INTO v_fuentes
        FROM jsonb_array_elements(p_resultado -> 'lineas') WITH ORDINALITY AS e(elem, pos)
       WHERE CASE WHEN jsonb_typeof(e.elem -> 'numeroLinea') = 'number'
                  THEN (e.elem ->> 'numeroLinea')::numeric ELSE e.pos::numeric END = v_origen;
      IF v_fuentes <> 1 THEN
        RAISE EXCEPTION 'payload_invalido: renglon % origen desconocido o ambiguo', v_pos USING ERRCODE = '22023';
      END IF;
    END IF;

    v_factor := v_linea -> 'factorConversion';
    IF jsonb_typeof(v_factor) IS DISTINCT FROM 'null'
       AND (jsonb_typeof(v_factor) IS DISTINCT FROM 'string'
            OR (v_factor #>> '{}') !~ '^[0-9]{1,12}(\.[0-9]{1,8})?$'
            OR (v_factor #>> '{}')::numeric <= 0) THEN
      RAISE EXCEPTION 'payload_invalido: renglon % factorConversion', v_pos USING ERRCODE = '22023';
    END IF;

    -- Explicit association decision.
    v_aso := v_linea -> 'asociacion';
    IF NOT facturas_privado.claves_exactas(v_aso, ARRAY['tipo', 'codigoInterno', 'evidencia', 'motivo'])
       OR jsonb_typeof(v_aso -> 'tipo') IS DISTINCT FROM 'string'
       OR jsonb_typeof(v_aso -> 'codigoInterno') NOT IN ('string', 'null')
       OR jsonb_typeof(v_aso -> 'evidencia') NOT IN ('string', 'null')
       OR jsonb_typeof(v_aso -> 'motivo') NOT IN ('string', 'null') THEN
      RAISE EXCEPTION 'payload_invalido: renglon % asociacion', v_pos USING ERRCODE = '22023';
    END IF;
    v_tipo := v_aso ->> 'tipo';
    v_evidencia := v_aso ->> 'evidencia';
    v_motivo := v_aso -> 'motivo';
    IF jsonb_typeof(v_motivo) = 'string' AND (btrim(v_motivo #>> '{}') = '' OR char_length(v_motivo #>> '{}') > 500) THEN
      RAISE EXCEPTION 'payload_invalido: renglon % asociacion motivo', v_pos USING ERRCODE = '22023';
    END IF;

    IF v_tipo = 'pendiente' THEN
      IF jsonb_typeof(v_aso -> 'codigoInterno') <> 'null' OR v_evidencia IS NOT NULL OR jsonb_typeof(v_motivo) <> 'null' THEN
        RAISE EXCEPTION 'payload_invalido: renglon % pendiente no admite producto ni evidencia', v_pos USING ERRCODE = '22023';
      END IF;
    ELSIF v_tipo = 'confirmado' THEN
      IF jsonb_typeof(v_aso -> 'codigoInterno') <> 'string'
         OR char_length(v_aso ->> 'codigoInterno') NOT BETWEEN 1 AND 80
         OR v_evidencia IS NULL OR v_evidencia NOT IN ('sugerencia', 'manual')
         OR (v_evidencia = 'manual' AND jsonb_typeof(v_motivo) <> 'string') THEN
        RAISE EXCEPTION 'payload_invalido: renglon % confirmado requiere producto, evidencia y motivo manual', v_pos USING ERRCODE = '22023';
      END IF;
    ELSIF v_tipo = 'producto_nuevo' THEN
      IF jsonb_typeof(v_aso -> 'codigoInterno') <> 'null' OR v_evidencia IS DISTINCT FROM 'manual' OR jsonb_typeof(v_motivo) <> 'string' THEN
        RAISE EXCEPTION 'payload_invalido: renglon % producto_nuevo requiere evidencia manual y motivo', v_pos USING ERRCODE = '22023';
      END IF;
    ELSE
      RAISE EXCEPTION 'payload_invalido: renglon % tipo de asociacion', v_pos USING ERRCODE = '22023';
    END IF;

    IF NOT facturas_privado.claves_exactas(v_linea -> 'codigoBarras', ARRAY['usarCodigoFactura'])
       OR jsonb_typeof(v_linea -> 'codigoBarras' -> 'usarCodigoFactura') IS DISTINCT FROM 'boolean' THEN
      RAISE EXCEPTION 'payload_invalido: renglon % codigoBarras', v_pos USING ERRCODE = '22023';
    END IF;
  END LOOP;

  -- Each referenced source line was checked to exist once and to be used once, so equal
  -- counts mean every raw extraction line is represented exactly once (manual rows extra).
  IF p_resultado IS NOT NULL AND jsonb_array_length(p_resultado -> 'lineas') <> cardinality(v_origenes) THEN
    RAISE EXCEPTION 'payload_invalido: faltan renglones de la extraccion' USING ERRCODE = '22023';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION facturas_privado.validar_contenido_revision(jsonb, uuid, jsonb) FROM PUBLIC, anon, authenticated, service_role;
