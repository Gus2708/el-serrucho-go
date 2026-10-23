-- Supplier-invoice automation: append-only human review revisions.
--
-- Scope: storage of explicit review revisions and a human-review attestation.
-- A revision references an immutable extraction result and never copies or alters it.
-- Never writes invoice drafts, lines, purchases, stock, catalog, storage or queues.
-- The attestation records that a person reviewed the revision. It is NOT purchase
-- authority: the app and any later transfer must recompute every financial blocker.
--
-- Content contract (review_schema 1) is validated fail-closed by
-- facturas_privado.validar_contenido_revision; the client never supplies results,
-- blockers or fingerprints that the server trusts.
-- Error codes the client maps:
--   42501 not authorized · PV409 stale invoice version · PR409 stale revision
--   PI409 key reused with other content / fingerprint mismatch · 22023 invalid payload
--   P0002 invoice or revision not found

-- ── 1. Table ─────────────────────────────────────────────────────────────────
CREATE TABLE public.facturas_proveedores_revisiones (
  factura_id        uuid NOT NULL REFERENCES public.facturas_proveedores(id) ON DELETE CASCADE,
  revision          integer NOT NULL CHECK (revision >= 1),
  clave             uuid NOT NULL,
  factura_version   integer NOT NULL CHECK (factura_version >= 1),
  extraccion_id     uuid REFERENCES public.facturas_proveedores_extracciones(id),
  documento_sha256  text CHECK (documento_sha256 IS NULL OR documento_sha256 ~ '^[0-9a-f]{64}$'),
  contenido         jsonb NOT NULL CHECK (
    jsonb_typeof(contenido) = 'object' AND octet_length(contenido::text) <= 1048576
  ),
  fingerprint       text NOT NULL CHECK (fingerprint ~ '^[0-9a-f]{64}$'),
  motivo            text CHECK (motivo IS NULL OR char_length(motivo) BETWEEN 1 AND 500),
  creado_por        uuid NOT NULL REFERENCES auth.users(id),
  creado_en         timestamptz NOT NULL DEFAULT now(),
  aprobado_por      uuid REFERENCES auth.users(id),
  aprobado_en       timestamptz,
  PRIMARY KEY (factura_id, revision),
  CONSTRAINT facturas_proveedores_revisiones_clave_key UNIQUE (factura_id, clave),
  CONSTRAINT facturas_proveedores_revisiones_aprobacion CHECK ((aprobado_por IS NULL) = (aprobado_en IS NULL))
);

CREATE INDEX facturas_revisiones_propias_idx
  ON public.facturas_proveedores_revisiones (creado_por, factura_id);

-- ── 2. Privileges and RLS ────────────────────────────────────────────────────
-- Supabase default privileges grant ALL to anon/authenticated/service_role on new tables.
REVOKE ALL ON public.facturas_proveedores_revisiones FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.facturas_proveedores_revisiones TO authenticated;

ALTER TABLE public.facturas_proveedores_revisiones ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Privileged owner - read own facturas revisiones"
  ON public.facturas_proveedores_revisiones
  FOR SELECT TO authenticated
  USING (
    creado_por = (SELECT auth.uid())
    AND (SELECT public.is_privileged())
    AND (SELECT public.validate_session())
  );

-- ── 3. Append-only guard ─────────────────────────────────────────────────────
-- The only allowed change to a stored row is the one-time attestation.
CREATE SCHEMA IF NOT EXISTS facturas_privado;
REVOKE ALL ON SCHEMA facturas_privado FROM PUBLIC, anon;

CREATE FUNCTION facturas_privado.proteger_revision_factura()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF OLD.aprobado_por IS NULL AND NEW.aprobado_por IS NOT NULL
       AND (OLD.factura_id, OLD.revision, OLD.clave, OLD.factura_version, OLD.extraccion_id,
            OLD.documento_sha256, OLD.contenido, OLD.fingerprint, OLD.motivo, OLD.creado_por, OLD.creado_en)
          IS NOT DISTINCT FROM
          (NEW.factura_id, NEW.revision, NEW.clave, NEW.factura_version, NEW.extraccion_id,
            NEW.documento_sha256, NEW.contenido, NEW.fingerprint, NEW.motivo, NEW.creado_por, NEW.creado_en)
    THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'revision_inmutable' USING ERRCODE = '55000';
  END IF;

  -- DELETE: only the cascade from a deleted invoice may remove revisions.
  IF TG_OP = 'DELETE' THEN
    IF EXISTS (SELECT 1 FROM public.facturas_proveedores WHERE id = OLD.factura_id) THEN
      RAISE EXCEPTION 'revision_inmutable' USING ERRCODE = '55000';
    END IF;
    RETURN OLD;
  END IF;

  RAISE EXCEPTION 'revision_inmutable' USING ERRCODE = '55000';
END;
$$;

REVOKE ALL ON FUNCTION facturas_privado.proteger_revision_factura() FROM PUBLIC, anon, authenticated, service_role;

CREATE TRIGGER facturas_revisiones_inmutable
  BEFORE UPDATE OR DELETE ON public.facturas_proveedores_revisiones
  FOR EACH ROW EXECUTE FUNCTION facturas_privado.proteger_revision_factura();

CREATE TRIGGER facturas_revisiones_sin_truncate
  BEFORE TRUNCATE ON public.facturas_proveedores_revisiones
  FOR EACH STATEMENT EXECUTE FUNCTION facturas_privado.proteger_revision_factura();

-- ── 4. Content validation helpers (unexposed) ────────────────────────────────
CREATE FUNCTION facturas_privado.claves_exactas(p jsonb, p_claves text[])
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT CASE
    WHEN jsonb_typeof(p) = 'object'
    THEN ARRAY(SELECT jsonb_object_keys(p) ORDER BY 1) = (SELECT array_agg(k ORDER BY k) FROM unnest(p_claves) AS k)
    ELSE false
  END
$$;

-- Mirrors normalizeDecimal in src/lib/facturaProveedor.ts as used by the extraction
-- contract: <= 30 raw chars, digits with an optional . or , fraction, bounded integer
-- digits and (trailing-zero-trimmed) scale. A blank string is rejected, not read as null.
CREATE FUNCTION facturas_privado.decimal_extraido_valido(p jsonb, p_enteros integer, p_escala integer)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT CASE jsonb_typeof(p)
    WHEN 'null' THEN true
    WHEN 'string' THEN
      char_length(p #>> '{}') <= 30
      AND btrim(p #>> '{}') ~ '^[0-9]+([.,][0-9]+)?$'
      AND char_length(regexp_replace(split_part(replace(btrim(p #>> '{}'), ',', '.'), '.', 1), '^0+(?=[0-9])', '')) <= p_enteros
      AND char_length(regexp_replace(split_part(replace(btrim(p #>> '{}'), ',', '.'), '.', 2), '0+$', '')) <= p_escala
    ELSE false
  END
$$;

-- Complete typed arrays of the extraction contract (ExtraidoDescuento / ExtraidoImpuesto):
-- at most 20 members, every member key present, exact member types. [] is a deliberate clear.
CREATE FUNCTION facturas_privado.validar_lista_tipada_revision(p_lista jsonb, p_campo text, p_ctx text)
RETURNS void
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_item   jsonb;
  v_ordenes text[] := ARRAY[]::text[];
BEGIN
  IF jsonb_typeof(p_lista) IS DISTINCT FROM 'array' OR jsonb_array_length(p_lista) > 20 THEN
    RAISE EXCEPTION 'payload_invalido: % % debe ser un arreglo de hasta 20', p_ctx, p_campo USING ERRCODE = '22023';
  END IF;

  FOR v_item IN SELECT value FROM jsonb_array_elements(p_lista) LOOP
    IF p_campo = 'descuentos' THEN
      IF NOT facturas_privado.claves_exactas(v_item, ARRAY['orden', 'porcentaje', 'monto', 'alcance', 'incluidoEnPrecio'])
         OR jsonb_typeof(v_item -> 'orden') IS DISTINCT FROM 'number'
         OR (v_item ->> 'orden') !~ '^[1-9][0-9]{0,14}$'
         OR NOT facturas_privado.decimal_extraido_valido(v_item -> 'porcentaje', 5, 4)
         OR NOT facturas_privado.decimal_extraido_valido(v_item -> 'monto', 11, 4)
         OR (v_item -> 'alcance') NOT IN ('null'::jsonb, '"renglon"'::jsonb, '"global"'::jsonb)
         OR jsonb_typeof(v_item -> 'incluidoEnPrecio') NOT IN ('boolean', 'null') THEN
        RAISE EXCEPTION 'payload_invalido: % descuento invalido', p_ctx USING ERRCODE = '22023';
      END IF;
      IF (v_item ->> 'orden') = ANY (v_ordenes) THEN
        RAISE EXCEPTION 'payload_invalido: % orden de descuento repetido', p_ctx USING ERRCODE = '22023';
      END IF;
      v_ordenes := v_ordenes || (v_item ->> 'orden');
    ELSE
      IF NOT facturas_privado.claves_exactas(v_item, ARRAY['tasa', 'base', 'monto', 'exento'])
         OR NOT facturas_privado.decimal_extraido_valido(v_item -> 'tasa', 5, 4)
         OR NOT facturas_privado.decimal_extraido_valido(v_item -> 'base', 11, 4)
         OR NOT facturas_privado.decimal_extraido_valido(v_item -> 'monto', 11, 4)
         OR jsonb_typeof(v_item -> 'exento') NOT IN ('boolean', 'null') THEN
        RAISE EXCEPTION 'payload_invalido: % impuesto invalido', p_ctx USING ERRCODE = '22023';
      END IF;
    END IF;
  END LOOP;
END;
$$;

-- Corrections: field -> {valor, motivo: non-blank string}. valor is string|null for
-- scalar fields and a complete typed array for descuentos/impuestos.
CREATE FUNCTION facturas_privado.validar_correcciones_revision(p_correcciones jsonb, p_campos text[], p_ctx text)
RETURNS void
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_campo text;
  v_corr  jsonb;
  v_valor text;
  v_max   integer;
BEGIN
  IF jsonb_typeof(p_correcciones) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'payload_invalido: % correcciones debe ser objeto', p_ctx USING ERRCODE = '22023';
  END IF;

  FOR v_campo, v_corr IN SELECT key, value FROM jsonb_each(p_correcciones) LOOP
    IF v_campo <> ALL (p_campos) THEN
      RAISE EXCEPTION 'payload_invalido: % campo no corregible %', p_ctx, v_campo USING ERRCODE = '22023';
    END IF;
    IF NOT facturas_privado.claves_exactas(v_corr, ARRAY['valor', 'motivo'])
       OR jsonb_typeof(v_corr -> 'motivo') IS DISTINCT FROM 'string'
       OR btrim(v_corr ->> 'motivo') = ''
       OR char_length(v_corr ->> 'motivo') > 500 THEN
      RAISE EXCEPTION 'payload_invalido: % correccion % requiere valor y motivo', p_ctx, v_campo USING ERRCODE = '22023';
    END IF;
    IF v_campo IN ('descuentos', 'impuestos') THEN
      PERFORM facturas_privado.validar_lista_tipada_revision(v_corr -> 'valor', v_campo, p_ctx);
      CONTINUE;
    END IF;
    IF jsonb_typeof(v_corr -> 'valor') = 'null' THEN
      CONTINUE;
    END IF;
    IF jsonb_typeof(v_corr -> 'valor') IS DISTINCT FROM 'string' THEN
      RAISE EXCEPTION 'payload_invalido: % valor de % debe ser texto o null', p_ctx, v_campo USING ERRCODE = '22023';
    END IF;

    v_valor := v_corr ->> 'valor';
    IF v_campo IN ('tasaCambio', 'subtotal', 'total', 'cantidad', 'precioUnitario', 'tasaIva') THEN
      IF v_valor !~ '^[0-9]{1,12}(\.[0-9]{1,8})?$' THEN
        RAISE EXCEPTION 'payload_invalido: % % no es un decimal valido', p_ctx, v_campo USING ERRCODE = '22023';
      END IF;
    ELSIF v_campo = 'fechaEmision' THEN
      BEGIN
        IF v_valor !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN
          RAISE EXCEPTION 'fecha';
        END IF;
        PERFORM v_valor::date;
      EXCEPTION WHEN OTHERS THEN
        RAISE EXCEPTION 'payload_invalido: % fechaEmision invalida', p_ctx USING ERRCODE = '22023';
      END;
    ELSIF v_campo = 'moneda' THEN
      IF v_valor !~ '^[A-Z]{3}$' THEN
        RAISE EXCEPTION 'payload_invalido: % moneda invalida', p_ctx USING ERRCODE = '22023';
      END IF;
    ELSE
      v_max := CASE v_campo
        WHEN 'proveedorNombre' THEN 200
        WHEN 'proveedorRif' THEN 40
        WHEN 'numeroDocumento' THEN 60
        WHEN 'numeroControl' THEN 60
        WHEN 'codigoProveedor' THEN 80
        WHEN 'unidad' THEN 40
        ELSE 500
      END;
      IF char_length(v_valor) NOT BETWEEN 1 AND v_max THEN
        RAISE EXCEPTION 'payload_invalido: % % excede su longitud', p_ctx, v_campo USING ERRCODE = '22023';
      END IF;
    END IF;
  END LOOP;
END;
$$;

-- p_resultado is the staged extraction result (null when the revision has no extraction).
CREATE FUNCTION facturas_privado.validar_contenido_revision(p_contenido jsonb, p_extraccion_id uuid, p_resultado jsonb)
RETURNS void
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_cab      jsonb;
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
  IF NOT facturas_privado.claves_exactas(v_cab, ARRAY[
       'correcciones', 'tasaConfirmada', 'precioIncluyeIva', 'recepcionCompleta', 'documentoCompletoConfirmado'])
     OR jsonb_typeof(v_cab -> 'tasaConfirmada') IS DISTINCT FROM 'null'
     OR jsonb_typeof(v_cab -> 'precioIncluyeIva') NOT IN ('boolean', 'null')
     OR jsonb_typeof(v_cab -> 'recepcionCompleta') NOT IN ('boolean', 'null')
     OR jsonb_typeof(v_cab -> 'documentoCompletoConfirmado') NOT IN ('boolean', 'null') THEN
    RAISE EXCEPTION 'payload_invalido: cabecera' USING ERRCODE = '22023';
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
    IF NOT facturas_privado.claves_exactas(v_linea, ARRAY[
         'lineaId', 'origen', 'correcciones', 'factorConversion', 'asociacion', 'codigoBarras']) THEN
      RAISE EXCEPTION 'payload_invalido: renglon % claves', v_pos USING ERRCODE = '22023';
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

-- Attestation requires every human decision to be explicit; it never infers one.
CREATE FUNCTION facturas_privado.exigir_revision_completa(p_contenido jsonb)
RETURNS void
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF (p_contenido -> 'cabecera' -> 'documentoCompletoConfirmado') IS DISTINCT FROM 'true'::jsonb
     OR jsonb_typeof(p_contenido -> 'cabecera' -> 'precioIncluyeIva') IS DISTINCT FROM 'boolean'
     OR jsonb_typeof(p_contenido -> 'cabecera' -> 'recepcionCompleta') IS DISTINCT FROM 'boolean'
     OR jsonb_array_length(p_contenido -> 'lineas') = 0 THEN
    RAISE EXCEPTION 'aprobacion_incompleta: cabecera o renglones sin decision explicita' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_contenido -> 'lineas') AS l(elem)
     WHERE l.elem -> 'asociacion' ->> 'tipo' = 'pendiente'
        OR jsonb_typeof(l.elem -> 'factorConversion') = 'null'
  ) THEN
    RAISE EXCEPTION 'aprobacion_incompleta: renglon pendiente o sin conversion de unidad' USING ERRCODE = '22023';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION facturas_privado.claves_exactas(jsonb, text[]) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION facturas_privado.decimal_extraido_valido(jsonb, integer, integer) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION facturas_privado.validar_lista_tipada_revision(jsonb, text, text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION facturas_privado.validar_correcciones_revision(jsonb, text[], text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION facturas_privado.validar_contenido_revision(jsonb, uuid, jsonb) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION facturas_privado.exigir_revision_completa(jsonb) FROM PUBLIC, anon, authenticated, service_role;

-- ── 5. Save a revision ───────────────────────────────────────────────────────
-- p_revision_esperada = 0 creates the first revision; N >= 1 appends after revision N.
CREATE FUNCTION facturas_privado.guardar_revision_factura(
  p_factura_id        uuid,
  p_revision_esperada integer,
  p_clave             uuid,
  p_factura_version   integer,
  p_extraccion_id     uuid,
  p_contenido         jsonb,
  p_motivo            text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid        uuid := auth.uid();
  v_factura    public.facturas_proveedores%ROWTYPE;
  v_previa     public.facturas_proveedores_revisiones%ROWTYPE;
  v_extraccion public.facturas_proveedores_extracciones%ROWTYPE;
  v_ultima_rev public.facturas_proveedores_revisiones%ROWTYPE;
  v_fp         text;
  v_ultima     integer;
BEGIN
  IF v_uid IS NULL OR NOT public.is_privileged() OR NOT public.validate_session() THEN
    RAISE EXCEPTION 'no_autorizado' USING ERRCODE = '42501';
  END IF;

  IF p_factura_id IS NULL OR p_clave IS NULL OR p_revision_esperada IS NULL OR p_revision_esperada < 0
     OR p_factura_version IS NULL OR p_factura_version < 1 THEN
    RAISE EXCEPTION 'payload_invalido: identificadores o version' USING ERRCODE = '22023';
  END IF;
  IF jsonb_typeof(p_contenido) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'payload_invalido: contenido' USING ERRCODE = '22023';
  END IF;
  IF p_motivo IS NOT NULL AND (btrim(p_motivo) = '' OR char_length(p_motivo) > 500) THEN
    RAISE EXCEPTION 'payload_invalido: motivo' USING ERRCODE = '22023';
  END IF;

  -- Same per-invoice lock as the manual save and the extraction lifecycle.
  PERFORM pg_advisory_xact_lock(hashtextextended(p_factura_id::text, 0));

  SELECT * INTO v_factura FROM public.facturas_proveedores WHERE id = p_factura_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'factura_no_encontrada' USING ERRCODE = 'P0002';
  END IF;
  IF v_factura.creado_por <> v_uid THEN
    RAISE EXCEPTION 'no_autorizado' USING ERRCODE = '42501';
  END IF;

  -- The server derives the fingerprint; the client never supplies one.
  v_fp := encode(sha256(convert_to(p_contenido::text, 'UTF8')), 'hex');

  SELECT * INTO v_previa FROM public.facturas_proveedores_revisiones
   WHERE factura_id = p_factura_id AND clave = p_clave;
  IF FOUND THEN
    IF v_previa.fingerprint = v_fp
       AND v_previa.revision = p_revision_esperada + 1
       AND v_previa.factura_version = p_factura_version
       AND v_previa.extraccion_id IS NOT DISTINCT FROM p_extraccion_id
       AND v_previa.motivo IS NOT DISTINCT FROM p_motivo THEN
      RETURN jsonb_build_object(
        'factura_id', p_factura_id, 'revision', v_previa.revision,
        'fingerprint', v_previa.fingerprint, 'replay', true
      );
    END IF;
    RAISE EXCEPTION 'clave_idempotencia_reutilizada' USING ERRCODE = 'PI409';
  END IF;

  IF v_factura.version <> p_factura_version THEN
    RAISE EXCEPTION 'version_obsoleta' USING ERRCODE = 'PV409';
  END IF;

  SELECT COALESCE(max(revision), 0) INTO v_ultima
    FROM public.facturas_proveedores_revisiones WHERE factura_id = p_factura_id;
  IF v_ultima <> p_revision_esperada THEN
    RAISE EXCEPTION 'revision_obsoleta' USING ERRCODE = 'PR409';
  END IF;

  -- The extraction must be this invoice's completed result for the document still attached.
  IF p_extraccion_id IS NOT NULL THEN
    SELECT * INTO v_extraccion FROM public.facturas_proveedores_extracciones
     WHERE id = p_extraccion_id
       AND factura_id = p_factura_id
       AND estado = 'completado'
       AND documento_sha256 = v_factura.documento_sha256;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'extraccion_invalida' USING ERRCODE = '22023';
    END IF;
  END IF;

  -- Replacing or detaching the extraction is an explicit act that must say why.
  IF v_ultima > 0 THEN
    SELECT * INTO v_ultima_rev FROM public.facturas_proveedores_revisiones
     WHERE factura_id = p_factura_id AND revision = v_ultima;
    IF v_ultima_rev.extraccion_id IS DISTINCT FROM p_extraccion_id AND p_motivo IS NULL THEN
      RAISE EXCEPTION 'payload_invalido: cambio de extraccion requiere motivo' USING ERRCODE = '22023';
    END IF;
  END IF;

  PERFORM facturas_privado.validar_contenido_revision(p_contenido, p_extraccion_id, v_extraccion.resultado);

  -- Every source line keeps the lineaId it ever had in this extraction, across the whole
  -- invoice history (A / detach / A and A / B / A included), not only the adjacent revision.
  IF p_extraccion_id IS NOT NULL
     AND EXISTS (
       SELECT 1
         FROM public.facturas_proveedores_revisiones AS r,
              jsonb_array_elements(r.contenido -> 'lineas') AS o(elem)
        WHERE r.factura_id = p_factura_id
          AND r.extraccion_id = p_extraccion_id
          AND jsonb_typeof(o.elem -> 'origen') = 'object'
          AND NOT EXISTS (
            SELECT 1 FROM jsonb_array_elements(p_contenido -> 'lineas') AS n(elem)
             WHERE n.elem -> 'origen' = o.elem -> 'origen' AND n.elem -> 'lineaId' = o.elem -> 'lineaId'
          )
     ) THEN
    RAISE EXCEPTION 'payload_invalido: lineaId de renglon de origen no estable' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.facturas_proveedores_revisiones (
    factura_id, revision, clave, factura_version, extraccion_id, documento_sha256,
    contenido, fingerprint, motivo, creado_por
  ) VALUES (
    p_factura_id, v_ultima + 1, p_clave, p_factura_version, p_extraccion_id, v_factura.documento_sha256,
    p_contenido, v_fp, p_motivo, v_uid
  );

  RETURN jsonb_build_object(
    'factura_id', p_factura_id, 'revision', v_ultima + 1, 'fingerprint', v_fp, 'replay', false
  );
END;
$$;

REVOKE ALL ON FUNCTION facturas_privado.guardar_revision_factura(uuid, integer, uuid, integer, uuid, jsonb, text)
  FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION facturas_privado.guardar_revision_factura(uuid, integer, uuid, integer, uuid, jsonb, text)
  TO authenticated;

CREATE FUNCTION public.guardar_revision_factura(
  p_factura_id        uuid,
  p_revision_esperada integer,
  p_clave             uuid,
  p_factura_version   integer,
  p_extraccion_id     uuid,
  p_contenido         jsonb,
  p_motivo            text
)
RETURNS jsonb
LANGUAGE sql
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT facturas_privado.guardar_revision_factura(
    p_factura_id, p_revision_esperada, p_clave, p_factura_version, p_extraccion_id, p_contenido, p_motivo)
$$;

REVOKE ALL ON FUNCTION public.guardar_revision_factura(uuid, integer, uuid, integer, uuid, jsonb, text)
  FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.guardar_revision_factura(uuid, integer, uuid, integer, uuid, jsonb, text)
  TO authenticated;

-- ── 6. Human-review attestation ──────────────────────────────────────────────
-- Valid only for the latest, unchanged revision while the invoice version and
-- attached document still match what the revision was saved against.
CREATE FUNCTION facturas_privado.aprobar_revision_factura(
  p_factura_id      uuid,
  p_revision        integer,
  p_fingerprint     text,
  p_factura_version integer
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid     uuid := auth.uid();
  v_factura public.facturas_proveedores%ROWTYPE;
  v_rev     public.facturas_proveedores_revisiones%ROWTYPE;
  v_ultima  integer;
BEGIN
  IF v_uid IS NULL OR NOT public.is_privileged() OR NOT public.validate_session() THEN
    RAISE EXCEPTION 'no_autorizado' USING ERRCODE = '42501';
  END IF;

  IF p_factura_id IS NULL OR p_revision IS NULL OR p_revision < 1 OR p_fingerprint IS NULL
     OR p_factura_version IS NULL OR p_factura_version < 1 THEN
    RAISE EXCEPTION 'payload_invalido: identificadores o version' USING ERRCODE = '22023';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(p_factura_id::text, 0));

  SELECT * INTO v_factura FROM public.facturas_proveedores WHERE id = p_factura_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'factura_no_encontrada' USING ERRCODE = 'P0002';
  END IF;
  IF v_factura.creado_por <> v_uid THEN
    RAISE EXCEPTION 'no_autorizado' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_rev FROM public.facturas_proveedores_revisiones
   WHERE factura_id = p_factura_id AND revision = p_revision;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'revision_no_encontrada' USING ERRCODE = 'P0002';
  END IF;

  IF v_rev.fingerprint <> p_fingerprint THEN
    RAISE EXCEPTION 'fingerprint_no_coincide' USING ERRCODE = 'PI409';
  END IF;

  SELECT max(revision) INTO v_ultima
    FROM public.facturas_proveedores_revisiones WHERE factura_id = p_factura_id;
  IF v_ultima <> p_revision THEN
    RAISE EXCEPTION 'revision_obsoleta' USING ERRCODE = 'PR409';
  END IF;

  IF v_factura.version <> p_factura_version
     OR v_factura.version <> v_rev.factura_version
     OR v_factura.documento_sha256 IS DISTINCT FROM v_rev.documento_sha256 THEN
    RAISE EXCEPTION 'version_obsoleta' USING ERRCODE = 'PV409';
  END IF;

  IF v_rev.aprobado_por IS NOT NULL THEN
    RETURN jsonb_build_object(
      'factura_id', p_factura_id, 'revision', p_revision, 'fingerprint', v_rev.fingerprint, 'replay', true
    );
  END IF;

  PERFORM facturas_privado.exigir_revision_completa(v_rev.contenido);

  UPDATE public.facturas_proveedores_revisiones
     SET aprobado_por = v_uid, aprobado_en = now()
   WHERE factura_id = p_factura_id AND revision = p_revision;

  RETURN jsonb_build_object(
    'factura_id', p_factura_id, 'revision', p_revision, 'fingerprint', v_rev.fingerprint, 'replay', false
  );
END;
$$;

REVOKE ALL ON FUNCTION facturas_privado.aprobar_revision_factura(uuid, integer, text, integer)
  FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION facturas_privado.aprobar_revision_factura(uuid, integer, text, integer)
  TO authenticated;

CREATE FUNCTION public.aprobar_revision_factura(
  p_factura_id      uuid,
  p_revision        integer,
  p_fingerprint     text,
  p_factura_version integer
)
RETURNS jsonb
LANGUAGE sql
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT facturas_privado.aprobar_revision_factura(p_factura_id, p_revision, p_fingerprint, p_factura_version)
$$;

REVOKE ALL ON FUNCTION public.aprobar_revision_factura(uuid, integer, text, integer)
  FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.aprobar_revision_factura(uuid, integer, text, integer)
  TO authenticated;
