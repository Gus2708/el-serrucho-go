-- Supplier-invoice automation: extraction attempt lifecycle staging.
--
-- Scope: dedicated facturas_proveedores_extracciones table, advisory locks,
-- atomic reservation and service_role-only completion.
-- Never writes to invoice draft, purchase, inventory, catalog, storage or queues.

-- ── 1. Table ─────────────────────────────────────────────────────────────────
CREATE TABLE public.facturas_proveedores_extracciones (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  factura_id          uuid NOT NULL REFERENCES public.facturas_proveedores(id) ON DELETE CASCADE,
  solicitud_id        uuid NOT NULL,
  creado_por          uuid NOT NULL REFERENCES auth.users(id),
  estado              text NOT NULL CHECK (estado IN ('procesando', 'completado', 'fallido', 'cuarentena')),
  factura_version     integer NOT NULL CHECK (factura_version >= 1),
  documento_path      text NOT NULL,
  documento_sha256    text NOT NULL CHECK (documento_sha256 ~ '^[0-9a-f]{64}$'),
  documento_mime      text NOT NULL CHECK (documento_mime IN ('application/pdf', 'image/jpeg', 'image/png', 'image/webp')),
  documento_bytes     integer NOT NULL CHECK (documento_bytes BETWEEN 1 AND 10485760),
  resultado           jsonb,
  error_codigo        text,
  modelo              text CHECK (modelo IS NULL OR char_length(modelo) <= 120),
  proveedor           text CHECK (proveedor IS NULL OR char_length(proveedor) <= 120),
  tokens_prompt       integer CHECK (tokens_prompt IS NULL OR tokens_prompt >= 0),
  tokens_completion   integer CHECK (tokens_completion IS NULL OR tokens_completion >= 0),
  tokens_total        integer CHECK (tokens_total IS NULL OR tokens_total >= 0),
  costo_usd           numeric CHECK (costo_usd IS NULL OR (costo_usd >= 0 AND costo_usd <= 100.0)),
  iniciado_en         timestamptz NOT NULL DEFAULT now(),
  finalizado_en       timestamptz,

  CONSTRAINT facturas_proveedores_extracciones_solicitud_key
    UNIQUE (factura_id, solicitud_id),

  CONSTRAINT facturas_proveedores_extracciones_resultado_tamano CHECK (
    resultado IS NULL OR octet_length(resultado::text) <= 1048576
  ),

  CONSTRAINT facturas_proveedores_extracciones_estado_datos CHECK (
    (estado = 'procesando' AND resultado IS NULL AND error_codigo IS NULL AND finalizado_en IS NULL)
    OR (estado = 'completado' AND resultado IS NOT NULL AND jsonb_typeof(resultado) = 'object' AND error_codigo IS NULL AND finalizado_en IS NOT NULL)
    OR (estado = 'cuarentena' AND resultado IS NOT NULL AND jsonb_typeof(resultado) = 'object' AND error_codigo IS NULL AND finalizado_en IS NOT NULL)
    OR (estado = 'fallido' AND resultado IS NULL AND error_codigo IS NOT NULL AND finalizado_en IS NOT NULL)
  ),

  CONSTRAINT facturas_proveedores_extracciones_error_codigo_allowlist CHECK (
    error_codigo IS NULL OR error_codigo IN (
      'invalid_api_key',
      'invalid_document',
      'dependency_error',
      'unauthorized',
      'insufficient_credits',
      'rate_limited',
      'upstream_error',
      'malformed_response',
      'output_truncated',
      'refusal',
      'unexpected_finish_reason',
      'contract_violation',
      'timeout',
      'aborted',
      'error_servidor',
      'desconocido'
    )
  )
);

-- At most one active attempt per invoice.
CREATE UNIQUE INDEX facturas_extracciones_activa_idx
  ON public.facturas_proveedores_extracciones (factura_id)
  WHERE estado = 'procesando';

CREATE INDEX facturas_extracciones_historial_idx
  ON public.facturas_proveedores_extracciones (factura_id, iniciado_en DESC);

-- ── 2. Privileges and RLS ────────────────────────────────────────────────────
-- Explicitly revoke inherited and default privileges from PUBLIC, anon, authenticated and service_role.
REVOKE ALL ON public.facturas_proveedores_extracciones FROM PUBLIC, anon, authenticated, service_role;

-- Direct table writes strictly denied for authenticated and service_role.
-- Writes only occur via private functions.
GRANT SELECT ON public.facturas_proveedores_extracciones TO authenticated;
GRANT SELECT ON public.facturas_proveedores_extracciones TO service_role;

ALTER TABLE public.facturas_proveedores_extracciones ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Privileged owner - read own facturas extracciones"
  ON public.facturas_proveedores_extracciones
  FOR SELECT TO authenticated
  USING (
    creado_por = (SELECT auth.uid())
    AND (SELECT public.is_privileged())
    AND (SELECT public.validate_session())
  );

CREATE POLICY "Service role - read facturas extracciones"
  ON public.facturas_proveedores_extracciones
  FOR SELECT TO service_role
  USING (true);

-- ── 3. Private schema and RPC functions ──────────────────────────────────────
CREATE SCHEMA IF NOT EXISTS facturas_privado;
REVOKE ALL ON SCHEMA facturas_privado FROM PUBLIC, anon;
GRANT USAGE ON SCHEMA facturas_privado TO authenticated;
GRANT USAGE ON SCHEMA facturas_privado TO service_role;

-- 3.1. Reservation (authenticated privileged owner)
CREATE FUNCTION facturas_privado.reservar_extraccion_factura(
  p_factura_id       uuid,
  p_solicitud_id     uuid,
  p_version_esperada integer
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid        uuid := auth.uid();
  v_factura    public.facturas_proveedores%ROWTYPE;
  v_extraccion public.facturas_proveedores_extracciones%ROWTYPE;
  v_activa     public.facturas_proveedores_extracciones%ROWTYPE;
  v_id         uuid;
BEGIN
  IF v_uid IS NULL OR NOT public.is_privileged() OR NOT public.validate_session() THEN
    RAISE EXCEPTION 'no_autorizado' USING ERRCODE = '42501';
  END IF;

  IF p_factura_id IS NULL OR p_solicitud_id IS NULL OR p_version_esperada IS NULL OR p_version_esperada < 1 THEN
    RAISE EXCEPTION 'payload_invalido: identificadores o version' USING ERRCODE = '22023';
  END IF;

  -- Advisory lock scoped to invoice serialization
  PERFORM pg_advisory_xact_lock(hashtextextended(p_factura_id::text, 0));

  SELECT * INTO v_factura FROM public.facturas_proveedores WHERE id = p_factura_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'factura_no_encontrada' USING ERRCODE = 'P0002';
  END IF;

  IF v_factura.creado_por <> v_uid THEN
    RAISE EXCEPTION 'no_autorizado' USING ERRCODE = '42501';
  END IF;

  IF v_factura.version <> p_version_esperada THEN
    RAISE EXCEPTION 'version_obsoleta' USING ERRCODE = 'PV409';
  END IF;

  IF v_factura.documento_path IS NULL
     OR v_factura.documento_sha256 IS NULL
     OR v_factura.documento_mime IS NULL
     OR v_factura.documento_bytes IS NULL THEN
    RAISE EXCEPTION 'sin_documento_fuente' USING ERRCODE = '22023';
  END IF;

  -- Replay check for this request UUID
  SELECT * INTO v_extraccion FROM public.facturas_proveedores_extracciones
   WHERE factura_id = p_factura_id AND solicitud_id = p_solicitud_id;

  IF FOUND THEN
    RETURN jsonb_build_object(
      'extraccion_id', v_extraccion.id,
      'factura_id', v_extraccion.factura_id,
      'solicitud_id', v_extraccion.solicitud_id,
      'estado', v_extraccion.estado,
      'factura_version', v_extraccion.factura_version,
      'ejecutar', false,
      'replay', true,
      'resultado', v_extraccion.resultado,
      'error_codigo', v_extraccion.error_codigo,
      'modelo', v_extraccion.modelo,
      'proveedor', v_extraccion.proveedor,
      'tokens_prompt', v_extraccion.tokens_prompt,
      'tokens_completion', v_extraccion.tokens_completion,
      'tokens_total', v_extraccion.tokens_total,
      'costo_usd', v_extraccion.costo_usd,
      'metadatos', jsonb_build_object(
        'model', v_extraccion.modelo,
        'provider', v_extraccion.proveedor,
        'tokens_prompt', v_extraccion.tokens_prompt,
        'tokens_completion', v_extraccion.tokens_completion,
        'tokens_total', v_extraccion.tokens_total,
        'cost_usd', v_extraccion.costo_usd
      ),
      'documento', jsonb_build_object(
        'path', v_extraccion.documento_path,
        'sha256', v_extraccion.documento_sha256,
        'mime', v_extraccion.documento_mime,
        'bytes', v_extraccion.documento_bytes
      )
    );
  END IF;

  -- Check if another request is currently active on this invoice
  SELECT * INTO v_activa FROM public.facturas_proveedores_extracciones
   WHERE factura_id = p_factura_id AND estado = 'procesando';

  IF FOUND THEN
    RAISE EXCEPTION 'extraccion_en_curso' USING ERRCODE = 'PX409';
  END IF;

  v_id := gen_random_uuid();
  INSERT INTO public.facturas_proveedores_extracciones (
    id, factura_id, solicitud_id, creado_por, estado,
    factura_version, documento_path, documento_sha256, documento_mime, documento_bytes
  ) VALUES (
    v_id, p_factura_id, p_solicitud_id, v_uid, 'procesando',
    v_factura.version, v_factura.documento_path, v_factura.documento_sha256,
    v_factura.documento_mime, v_factura.documento_bytes
  );

  RETURN jsonb_build_object(
    'extraccion_id', v_id,
    'factura_id', p_factura_id,
    'solicitud_id', p_solicitud_id,
    'estado', 'procesando',
    'factura_version', v_factura.version,
    'ejecutar', true,
    'replay', false,
    'documento', jsonb_build_object(
      'path', v_factura.documento_path,
      'sha256', v_factura.documento_sha256,
      'mime', v_factura.documento_mime,
      'bytes', v_factura.documento_bytes
    )
  );
END;
$$;

REVOKE ALL ON FUNCTION facturas_privado.reservar_extraccion_factura(uuid, uuid, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION facturas_privado.reservar_extraccion_factura(uuid, uuid, integer) TO authenticated;

CREATE FUNCTION public.reservar_extraccion_factura(
  p_factura_id       uuid,
  p_solicitud_id     uuid,
  p_version_esperada integer
)
RETURNS jsonb
LANGUAGE sql
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT facturas_privado.reservar_extraccion_factura(p_factura_id, p_solicitud_id, p_version_esperada);
$$;

REVOKE ALL ON FUNCTION public.reservar_extraccion_factura(uuid, uuid, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reservar_extraccion_factura(uuid, uuid, integer) TO authenticated;


-- 3.2. Completion (service_role only)
CREATE FUNCTION facturas_privado.completar_extraccion_factura(
  p_factura_id   uuid,
  p_solicitud_id uuid,
  p_estado       text,
  p_resultado    jsonb,
  p_error_codigo text,
  p_metadatos    jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_extraccion        public.facturas_proveedores_extracciones%ROWTYPE;
  v_factura           public.facturas_proveedores%ROWTYPE;
  v_estado_final      text;
  v_modelo            text := NULL;
  v_proveedor         text := NULL;
  v_tokens_prompt     integer := NULL;
  v_tokens_completion integer := NULL;
  v_tokens_total      integer := NULL;
  v_costo_usd         numeric := NULL;
  v_stale             boolean := false;
BEGIN
  -- Strict caller verification: only service_role allowed
  IF current_setting('role', true) IS DISTINCT FROM 'service_role'
     AND current_setting('request.jwt.claim.role', true) IS DISTINCT FROM 'service_role'
     AND session_user IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'no_autorizado' USING ERRCODE = '42501';
  END IF;

  IF p_factura_id IS NULL OR p_solicitud_id IS NULL THEN
    RAISE EXCEPTION 'payload_invalido: identificadores' USING ERRCODE = '22023';
  END IF;

  IF p_estado IS NULL OR p_estado NOT IN ('completado', 'fallido') THEN
    RAISE EXCEPTION 'payload_invalido: estado' USING ERRCODE = '22023';
  END IF;

  IF p_estado = 'completado' THEN
    IF p_resultado IS NULL OR jsonb_typeof(p_resultado) IS DISTINCT FROM 'object' THEN
      RAISE EXCEPTION 'payload_invalido: resultado requerido' USING ERRCODE = '22023';
    END IF;
    IF octet_length(p_resultado::text) > 1048576 THEN
      RAISE EXCEPTION 'payload_invalido: resultado excede 1MB' USING ERRCODE = '22023';
    END IF;
    IF p_error_codigo IS NOT NULL THEN
      RAISE EXCEPTION 'payload_invalido: error_codigo debe ser null en completado' USING ERRCODE = '22023';
    END IF;
  ELSE
    IF p_resultado IS NOT NULL THEN
      RAISE EXCEPTION 'payload_invalido: resultado debe ser null en fallido' USING ERRCODE = '22023';
    END IF;
    IF p_error_codigo IS NULL OR p_error_codigo NOT IN (
      'invalid_api_key',
      'invalid_document',
      'dependency_error',
      'unauthorized',
      'insufficient_credits',
      'rate_limited',
      'upstream_error',
      'malformed_response',
      'output_truncated',
      'refusal',
      'unexpected_finish_reason',
      'contract_violation',
      'timeout',
      'aborted',
      'error_servidor',
      'desconocido'
    ) THEN
      RAISE EXCEPTION 'payload_invalido: error_codigo no permitido' USING ERRCODE = '22023';
    END IF;
  END IF;

  -- Metadata validation: strict canonical transport shape, no unknown keys or aliases
  IF p_metadatos IS NOT NULL THEN
    IF jsonb_typeof(p_metadatos) IS DISTINCT FROM 'object' THEN
      RAISE EXCEPTION 'payload_invalido: metadatos debe ser objeto o null' USING ERRCODE = '22023';
    END IF;

    IF EXISTS (
      SELECT 1 FROM jsonb_object_keys(p_metadatos) AS k
       WHERE k NOT IN ('model', 'provider', 'tokens_prompt', 'tokens_completion', 'tokens_total', 'cost_usd')
    ) THEN
      RAISE EXCEPTION 'payload_invalido: metadatos clave no permitida o alias conflictivo' USING ERRCODE = '22023';
    END IF;

    -- model
    IF p_metadatos ? 'model' THEN
      IF jsonb_typeof(p_metadatos -> 'model') NOT IN ('string', 'null') THEN
        RAISE EXCEPTION 'payload_invalido: model debe ser string o null' USING ERRCODE = '22023';
      END IF;
      IF jsonb_typeof(p_metadatos -> 'model') = 'string' THEN
        v_modelo := p_metadatos ->> 'model';
        IF char_length(v_modelo) > 120 THEN
          RAISE EXCEPTION 'payload_invalido: model excede 120 caracteres' USING ERRCODE = '22023';
        END IF;
      END IF;
    END IF;

    -- provider
    IF p_metadatos ? 'provider' THEN
      IF jsonb_typeof(p_metadatos -> 'provider') NOT IN ('string', 'null') THEN
        RAISE EXCEPTION 'payload_invalido: provider debe ser string o null' USING ERRCODE = '22023';
      END IF;
      IF jsonb_typeof(p_metadatos -> 'provider') = 'string' THEN
        v_proveedor := p_metadatos ->> 'provider';
        IF char_length(v_proveedor) > 120 THEN
          RAISE EXCEPTION 'payload_invalido: provider excede 120 caracteres' USING ERRCODE = '22023';
        END IF;
      END IF;
    END IF;

    -- tokens_prompt
    IF p_metadatos ? 'tokens_prompt' THEN
      IF jsonb_typeof(p_metadatos -> 'tokens_prompt') NOT IN ('number', 'null') THEN
        RAISE EXCEPTION 'payload_invalido: tokens_prompt debe ser numero entero o null' USING ERRCODE = '22023';
      END IF;
      IF jsonb_typeof(p_metadatos -> 'tokens_prompt') = 'number' THEN
        IF (p_metadatos ->> 'tokens_prompt') !~ '^[0-9]+$' THEN
          RAISE EXCEPTION 'payload_invalido: tokens_prompt debe ser entero no negativo' USING ERRCODE = '22023';
        END IF;
        v_tokens_prompt := (p_metadatos ->> 'tokens_prompt')::integer;
      END IF;
    END IF;

    -- tokens_completion
    IF p_metadatos ? 'tokens_completion' THEN
      IF jsonb_typeof(p_metadatos -> 'tokens_completion') NOT IN ('number', 'null') THEN
        RAISE EXCEPTION 'payload_invalido: tokens_completion debe ser numero entero o null' USING ERRCODE = '22023';
      END IF;
      IF jsonb_typeof(p_metadatos -> 'tokens_completion') = 'number' THEN
        IF (p_metadatos ->> 'tokens_completion') !~ '^[0-9]+$' THEN
          RAISE EXCEPTION 'payload_invalido: tokens_completion debe ser entero no negativo' USING ERRCODE = '22023';
        END IF;
        v_tokens_completion := (p_metadatos ->> 'tokens_completion')::integer;
      END IF;
    END IF;

    -- tokens_total
    IF p_metadatos ? 'tokens_total' THEN
      IF jsonb_typeof(p_metadatos -> 'tokens_total') NOT IN ('number', 'null') THEN
        RAISE EXCEPTION 'payload_invalido: tokens_total debe ser numero entero o null' USING ERRCODE = '22023';
      END IF;
      IF jsonb_typeof(p_metadatos -> 'tokens_total') = 'number' THEN
        IF (p_metadatos ->> 'tokens_total') !~ '^[0-9]+$' THEN
          RAISE EXCEPTION 'payload_invalido: tokens_total debe ser entero no negativo' USING ERRCODE = '22023';
        END IF;
        v_tokens_total := (p_metadatos ->> 'tokens_total')::integer;
      END IF;
    END IF;

    -- cost_usd (preserves exact arbitrary decimal precision)
    IF p_metadatos ? 'cost_usd' THEN
      IF jsonb_typeof(p_metadatos -> 'cost_usd') NOT IN ('number', 'string', 'null') THEN
        RAISE EXCEPTION 'payload_invalido: cost_usd debe ser decimal o null' USING ERRCODE = '22023';
      END IF;
      IF jsonb_typeof(p_metadatos -> 'cost_usd') IN ('number', 'string') THEN
        IF (p_metadatos ->> 'cost_usd') !~ '^[0-9]+(\.[0-9]+)?$' THEN
          RAISE EXCEPTION 'payload_invalido: cost_usd debe ser decimal no negativo finito' USING ERRCODE = '22023';
        END IF;
        v_costo_usd := (p_metadatos ->> 'cost_usd')::numeric;
        IF v_costo_usd < 0 OR v_costo_usd > 100.0 THEN
          RAISE EXCEPTION 'payload_invalido: cost_usd fuera de rango (0 a 100)' USING ERRCODE = '22023';
        END IF;
      END IF;
    END IF;
  END IF;

  -- Advisory lock scoped to invoice serialization
  PERFORM pg_advisory_xact_lock(hashtextextended(p_factura_id::text, 0));

  SELECT * INTO v_extraccion FROM public.facturas_proveedores_extracciones
   WHERE factura_id = p_factura_id AND solicitud_id = p_solicitud_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'extraccion_no_encontrada' USING ERRCODE = 'P0002';
  END IF;

  -- Check if already finalized: idempotent replay vs conflict across all canonical fields
  IF v_extraccion.estado IN ('completado', 'fallido', 'cuarentena') THEN
    IF (
      (
        (v_extraccion.estado IN ('completado', 'cuarentena') AND p_estado = 'completado' AND v_extraccion.resultado = p_resultado)
        OR (v_extraccion.estado = 'fallido' AND p_estado = 'fallido' AND v_extraccion.error_codigo = p_error_codigo)
      )
      AND v_extraccion.modelo IS NOT DISTINCT FROM v_modelo
      AND v_extraccion.proveedor IS NOT DISTINCT FROM v_proveedor
      AND v_extraccion.tokens_prompt IS NOT DISTINCT FROM v_tokens_prompt
      AND v_extraccion.tokens_completion IS NOT DISTINCT FROM v_tokens_completion
      AND v_extraccion.tokens_total IS NOT DISTINCT FROM v_tokens_total
      AND v_extraccion.costo_usd IS NOT DISTINCT FROM v_costo_usd
    ) THEN
      RETURN jsonb_build_object(
        'extraccion_id', v_extraccion.id,
        'factura_id', p_factura_id,
        'solicitud_id', p_solicitud_id,
        'estado', v_extraccion.estado,
        'replay', true
      );
    ELSE
      RAISE EXCEPTION 'intento_ya_finalizado_en_conflicto' USING ERRCODE = 'PI409';
    END IF;
  END IF;

  -- Recheck parent invoice version and source attachment
  SELECT * INTO v_factura FROM public.facturas_proveedores WHERE id = p_factura_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'factura_no_encontrada' USING ERRCODE = 'P0002';
  END IF;

  IF v_factura.version <> v_extraccion.factura_version
     OR v_factura.documento_path IS DISTINCT FROM v_extraccion.documento_path
     OR v_factura.documento_sha256 IS DISTINCT FROM v_extraccion.documento_sha256
     OR v_factura.documento_mime IS DISTINCT FROM v_extraccion.documento_mime
     OR v_factura.documento_bytes IS DISTINCT FROM v_extraccion.documento_bytes THEN
    v_stale := true;
  END IF;

  IF p_estado = 'completado' THEN
    IF v_stale THEN
      v_estado_final := 'cuarentena';
    ELSE
      v_estado_final := 'completado';
    END IF;
  ELSE
    v_estado_final := 'fallido';
  END IF;

  UPDATE public.facturas_proveedores_extracciones SET
    estado            = v_estado_final,
    resultado         = p_resultado,
    error_codigo      = p_error_codigo,
    modelo            = v_modelo,
    proveedor         = v_proveedor,
    tokens_prompt     = v_tokens_prompt,
    tokens_completion = v_tokens_completion,
    tokens_total      = v_tokens_total,
    costo_usd         = v_costo_usd,
    finalizado_en     = now()
  WHERE id = v_extraccion.id;

  RETURN jsonb_build_object(
    'extraccion_id', v_extraccion.id,
    'factura_id', p_factura_id,
    'solicitud_id', p_solicitud_id,
    'estado', v_estado_final,
    'replay', false
  );
END;
$$;

REVOKE ALL ON FUNCTION facturas_privado.completar_extraccion_factura(uuid, uuid, text, jsonb, text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION facturas_privado.completar_extraccion_factura(uuid, uuid, text, jsonb, text, jsonb) TO service_role;

CREATE FUNCTION public.completar_extraccion_factura(
  p_factura_id   uuid,
  p_solicitud_id uuid,
  p_estado       text,
  p_resultado    jsonb,
  p_error_codigo text,
  p_metadatos    jsonb
)
RETURNS jsonb
LANGUAGE sql
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT facturas_privado.completar_extraccion_factura(p_factura_id, p_solicitud_id, p_estado, p_resultado, p_error_codigo, p_metadatos);
$$;

REVOKE ALL ON FUNCTION public.completar_extraccion_factura(uuid, uuid, text, jsonb, text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.completar_extraccion_factura(uuid, uuid, text, jsonb, text, jsonb) TO service_role;
