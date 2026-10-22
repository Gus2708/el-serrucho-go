-- Supplier-invoice persistence: private source document, stable invoice/line IDs,
-- atomic idempotent save with optimistic versions.
--
-- Scope: persistence only. No OCR, purchases, stock changes or POS emission.
-- The negative-stock compensation rule lives in useCompra and is untouched here.
--
-- Access model: every write goes through guardar_factura_proveedor(); authenticated
-- has SELECT only. Reads and writes require an active admin/superempleado with a
-- valid session who owns the invoice (same predicate as compras_app, migration 026).

-- ── 1. Tables ────────────────────────────────────────────────────────────────
CREATE TABLE public.facturas_proveedores (
  id                uuid PRIMARY KEY,
  creado_por        uuid NOT NULL REFERENCES auth.users(id),
  proveedor_codigo  text CHECK (char_length(proveedor_codigo) <= 80),
  proveedor_nombre  text CHECK (char_length(proveedor_nombre) <= 200),
  numero_documento  text CHECK (char_length(numero_documento) <= 60),
  numero_control    text CHECK (char_length(numero_control) <= 60),
  fecha_documento   date,
  moneda            text CHECK (moneda ~ '^[A-Z]{3}$'),
  notas             text CHECK (char_length(notas) <= 1000),
  version           integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  documento_path    text,
  documento_nombre  text CHECK (char_length(documento_nombre) <= 200),
  documento_mime    text CHECK (documento_mime IN ('application/pdf', 'image/jpeg', 'image/png', 'image/webp')),
  documento_bytes   integer CHECK (documento_bytes BETWEEN 1 AND 10485760),
  documento_sha256  text CHECK (documento_sha256 ~ '^[0-9a-f]{64}$'),
  creado_en         timestamptz NOT NULL DEFAULT now(),
  actualizado_en    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT facturas_proveedores_documento_completo CHECK (
    (documento_path IS NULL AND documento_nombre IS NULL AND documento_mime IS NULL
       AND documento_bytes IS NULL AND documento_sha256 IS NULL)
    OR (documento_path IS NOT NULL AND documento_nombre IS NOT NULL AND documento_mime IS NOT NULL
       AND documento_bytes IS NOT NULL AND documento_sha256 IS NOT NULL)
  )
);

CREATE UNIQUE INDEX facturas_proveedores_documento_path_key
  ON public.facturas_proveedores (documento_path) WHERE documento_path IS NOT NULL;
CREATE INDEX facturas_proveedores_propias_idx
  ON public.facturas_proveedores (creado_por, actualizado_en DESC);

-- Lines keep the document as printed: one row per original line, repeated SKUs
-- included. codigo_producto is a soft association (no FK): the SKU may not exist
-- in the synced catalog yet.
CREATE TABLE public.facturas_proveedores_lineas (
  linea_id                  uuid PRIMARY KEY,
  factura_id                uuid NOT NULL REFERENCES public.facturas_proveedores(id) ON DELETE CASCADE,
  orden                     integer NOT NULL CHECK (orden >= 1),
  codigo_proveedor          text CHECK (char_length(codigo_proveedor) <= 80),
  codigo_producto           text CHECK (char_length(codigo_producto) <= 80),
  descripcion               text CHECK (char_length(descripcion) <= 500),
  cantidad_documento        numeric(18, 4) CHECK (cantidad_documento >= 0),
  unidad_documento          text CHECK (char_length(unidad_documento) <= 40),
  costo_unitario_documento  numeric(18, 6) CHECK (costo_unitario_documento >= 0),
  total_documento           numeric(18, 4) CHECK (total_documento >= 0),
  nota                      text CHECK (char_length(nota) <= 500),
  CONSTRAINT facturas_proveedores_lineas_orden_key
    UNIQUE (factura_id, orden) DEFERRABLE INITIALLY DEFERRED
);

-- Idempotency ledger: one row per successful save, written in the same transaction.
CREATE TABLE public.facturas_proveedores_operaciones (
  factura_id          uuid NOT NULL REFERENCES public.facturas_proveedores(id) ON DELETE CASCADE,
  clave_idempotencia  uuid NOT NULL,
  contenido_md5       text NOT NULL,
  version_resultante  integer NOT NULL,
  creado_en           timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (factura_id, clave_idempotencia)
);

-- ── 2. Privileges and RLS ────────────────────────────────────────────────────
-- Supabase default privileges grant ALL to anon/authenticated on new tables.
REVOKE ALL ON public.facturas_proveedores            FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.facturas_proveedores_lineas     FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.facturas_proveedores_operaciones FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.facturas_proveedores        TO authenticated;
GRANT SELECT ON public.facturas_proveedores_lineas TO authenticated;

ALTER TABLE public.facturas_proveedores             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.facturas_proveedores_lineas      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.facturas_proveedores_operaciones ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Privileged owner - read own facturas" ON public.facturas_proveedores
  FOR SELECT TO authenticated
  USING (
    creado_por = (SELECT auth.uid())
    AND (SELECT public.is_privileged())
    AND (SELECT public.validate_session())
  );

CREATE POLICY "Privileged owner - read own factura lineas" ON public.facturas_proveedores_lineas
  FOR SELECT TO authenticated
  USING (
    (SELECT public.is_privileged())
    AND (SELECT public.validate_session())
    AND EXISTS (
      SELECT 1 FROM public.facturas_proveedores f
      WHERE f.id = facturas_proveedores_lineas.factura_id
        AND f.creado_por = (SELECT auth.uid())
    )
  );
-- facturas_proveedores_operaciones: RLS on, no policies, no grants → internal only.

-- ── 3. Atomic, idempotent, version-checked save ──────────────────────────────
-- The privileged implementation lives in a schema the Data API does not expose;
-- the public RPC is a SECURITY INVOKER wrapper, so no SECURITY DEFINER function
-- sits in an exposed schema. Authorization is checked inside the implementation.
-- p_version_esperada = 0 creates the invoice; N >= 1 updates it from version N.
-- The payload is the full desired state: missing lines are deleted and a null
-- "documento" detaches the file. Error codes the client maps:
--   42501 not authorized · PV409 stale version · PI409 key reused with other content
--   22023 invalid payload · P0002 invoice not found · 23514/22P02/22003 value errors
CREATE SCHEMA IF NOT EXISTS facturas_privado;
REVOKE ALL ON SCHEMA facturas_privado FROM PUBLIC, anon;
GRANT USAGE ON SCHEMA facturas_privado TO authenticated;

CREATE FUNCTION facturas_privado.guardar_factura_proveedor(
  p_factura_id       uuid,
  p_version_esperada integer,
  p_clave            uuid,
  p_cabecera         jsonb,
  p_lineas           jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid        uuid := auth.uid();
  v_hash       text;
  v_factura    public.facturas_proveedores%ROWTYPE;
  v_previa     public.facturas_proveedores_operaciones%ROWTYPE;
  v_documento  jsonb;
  v_doc_path   text;
  v_ids        uuid[];
  v_version    integer;
BEGIN
  IF v_uid IS NULL OR NOT public.is_privileged() OR NOT public.validate_session() THEN
    RAISE EXCEPTION 'no_autorizado' USING ERRCODE = '42501';
  END IF;

  IF p_factura_id IS NULL OR p_clave IS NULL OR p_version_esperada IS NULL OR p_version_esperada < 0 THEN
    RAISE EXCEPTION 'payload_invalido: identificadores o version' USING ERRCODE = '22023';
  END IF;
  IF jsonb_typeof(p_cabecera) IS DISTINCT FROM 'object' OR jsonb_typeof(p_lineas) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'payload_invalido: forma' USING ERRCODE = '22023';
  END IF;
  -- "documento" is an object or null (detach); any other JSON type must not detach silently.
  IF COALESCE(jsonb_typeof(p_cabecera -> 'documento'), 'null') NOT IN ('object', 'null') THEN
    RAISE EXCEPTION 'payload_invalido: documento' USING ERRCODE = '22023';
  END IF;
  IF jsonb_array_length(p_lineas) > 500 THEN
    RAISE EXCEPTION 'payload_invalido: maximo 500 renglones' USING ERRCODE = '22023';
  END IF;

  -- Serialize every save of this invoice id (creation included) until commit.
  PERFORM pg_advisory_xact_lock(hashtextextended(p_factura_id::text, 0));

  SELECT * INTO v_factura FROM public.facturas_proveedores WHERE id = p_factura_id;
  IF FOUND AND v_factura.creado_por <> v_uid THEN
    RAISE EXCEPTION 'no_autorizado' USING ERRCODE = '42501';
  END IF;

  v_hash := md5(jsonb_build_object('cabecera', p_cabecera, 'lineas', p_lineas)::text);

  SELECT * INTO v_previa FROM public.facturas_proveedores_operaciones
   WHERE factura_id = p_factura_id AND clave_idempotencia = p_clave;
  IF FOUND THEN
    IF v_previa.contenido_md5 <> v_hash THEN
      RAISE EXCEPTION 'clave_idempotencia_reutilizada' USING ERRCODE = 'PI409';
    END IF;
    RETURN jsonb_build_object('factura_id', p_factura_id, 'version', v_previa.version_resultante, 'replay', true);
  END IF;

  IF v_factura.id IS NULL AND p_version_esperada > 0 THEN
    RAISE EXCEPTION 'factura_no_encontrada' USING ERRCODE = 'P0002';
  END IF;
  IF (v_factura.id IS NULL AND p_version_esperada <> 0)
     OR (v_factura.id IS NOT NULL AND v_factura.version <> p_version_esperada) THEN
    RAISE EXCEPTION 'version_obsoleta' USING ERRCODE = 'PV409';
  END IF;

  SELECT array_agg((l ->> 'linea_id')::uuid) INTO v_ids FROM jsonb_array_elements(p_lineas) AS l;
  v_ids := COALESCE(v_ids, ARRAY[]::uuid[]);
  IF array_position(v_ids, NULL) IS NOT NULL THEN
    RAISE EXCEPTION 'payload_invalido: linea_id requerido' USING ERRCODE = '22023';
  END IF;
  IF cardinality(v_ids) <> (SELECT count(DISTINCT x) FROM unnest(v_ids) AS x) THEN
    RAISE EXCEPTION 'payload_invalido: linea_id repetido' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.facturas_proveedores_lineas
     WHERE linea_id = ANY (v_ids) AND factura_id <> p_factura_id
  ) THEN
    RAISE EXCEPTION 'payload_invalido: linea_id ajeno' USING ERRCODE = '22023';
  END IF;

  v_documento := p_cabecera -> 'documento';
  v_doc_path  := NULL;
  IF jsonb_typeof(v_documento) = 'object' THEN
    v_doc_path := v_documento ->> 'path';
    IF v_doc_path IS NULL
       OR v_doc_path !~ ('^' || v_uid::text || '/' || p_factura_id::text || '/[0-9a-f-]{36}\.(pdf|jpg|png|webp)$')
       OR NOT EXISTS (
         -- Storage records the real size and declared Content-Type of what it stored.
         SELECT 1 FROM storage.objects o
          WHERE o.bucket_id = 'facturas_proveedores' AND o.name = v_doc_path
            AND o.metadata ->> 'mimetype' = v_documento ->> 'mime'
            AND (o.metadata ->> 'size')::bigint = (v_documento ->> 'bytes')::bigint
       ) THEN
      RAISE EXCEPTION 'payload_invalido: documento' USING ERRCODE = '22023';
    END IF;
  END IF;

  IF v_factura.id IS NULL THEN
    v_version := 1;
    INSERT INTO public.facturas_proveedores (id, creado_por, version)
    VALUES (p_factura_id, v_uid, v_version);
  ELSE
    v_version := v_factura.version + 1;
  END IF;

  UPDATE public.facturas_proveedores SET
    proveedor_codigo = p_cabecera ->> 'proveedor_codigo',
    proveedor_nombre = p_cabecera ->> 'proveedor_nombre',
    numero_documento = p_cabecera ->> 'numero_documento',
    numero_control   = p_cabecera ->> 'numero_control',
    fecha_documento  = (p_cabecera ->> 'fecha_documento')::date,
    moneda           = p_cabecera ->> 'moneda',
    notas            = p_cabecera ->> 'notas',
    documento_path   = v_doc_path,
    documento_nombre = v_documento ->> 'nombre',
    documento_mime   = v_documento ->> 'mime',
    documento_bytes  = (v_documento ->> 'bytes')::integer,
    documento_sha256 = v_documento ->> 'sha256',
    version          = v_version,
    actualizado_en   = now()
  WHERE id = p_factura_id;

  DELETE FROM public.facturas_proveedores_lineas
   WHERE factura_id = p_factura_id AND linea_id <> ALL (v_ids);

  INSERT INTO public.facturas_proveedores_lineas (
    linea_id, factura_id, orden, codigo_proveedor, codigo_producto, descripcion,
    cantidad_documento, unidad_documento, costo_unitario_documento, total_documento, nota
  )
  SELECT
    (l.elem ->> 'linea_id')::uuid, p_factura_id, l.pos::integer,
    l.elem ->> 'codigo_proveedor', l.elem ->> 'codigo_producto', l.elem ->> 'descripcion',
    (l.elem ->> 'cantidad_documento')::numeric, l.elem ->> 'unidad_documento',
    (l.elem ->> 'costo_unitario_documento')::numeric, (l.elem ->> 'total_documento')::numeric,
    l.elem ->> 'nota'
  FROM jsonb_array_elements(p_lineas) WITH ORDINALITY AS l(elem, pos)
  ON CONFLICT (linea_id) DO UPDATE SET
    orden                    = EXCLUDED.orden,
    codigo_proveedor         = EXCLUDED.codigo_proveedor,
    codigo_producto          = EXCLUDED.codigo_producto,
    descripcion              = EXCLUDED.descripcion,
    cantidad_documento       = EXCLUDED.cantidad_documento,
    unidad_documento         = EXCLUDED.unidad_documento,
    costo_unitario_documento = EXCLUDED.costo_unitario_documento,
    total_documento          = EXCLUDED.total_documento,
    nota                     = EXCLUDED.nota
  WHERE public.facturas_proveedores_lineas.factura_id = EXCLUDED.factura_id;

  INSERT INTO public.facturas_proveedores_operaciones (factura_id, clave_idempotencia, contenido_md5, version_resultante)
  VALUES (p_factura_id, p_clave, v_hash, v_version);

  RETURN jsonb_build_object('factura_id', p_factura_id, 'version', v_version, 'replay', false);
END;
$$;

REVOKE ALL ON FUNCTION facturas_privado.guardar_factura_proveedor(uuid, integer, uuid, jsonb, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION facturas_privado.guardar_factura_proveedor(uuid, integer, uuid, jsonb, jsonb) TO authenticated;

CREATE FUNCTION public.guardar_factura_proveedor(
  p_factura_id       uuid,
  p_version_esperada integer,
  p_clave            uuid,
  p_cabecera         jsonb,
  p_lineas           jsonb
)
RETURNS jsonb
LANGUAGE sql
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT facturas_privado.guardar_factura_proveedor(p_factura_id, p_version_esperada, p_clave, p_cabecera, p_lineas)
$$;

REVOKE ALL ON FUNCTION public.guardar_factura_proveedor(uuid, integer, uuid, jsonb, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.guardar_factura_proveedor(uuid, integer, uuid, jsonb, jsonb) TO authenticated;

-- ── 4. Private bucket + Storage policies ─────────────────────────────────────
-- Object name: <owner uid>/<factura id>/<document uuid>.<pdf|jpg|png|webp>.
-- INSERT + SELECT + DELETE only: without UPDATE an existing object cannot be
-- overwritten (upsert), so every attachment gets a fresh path.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'facturas_proveedores', 'facturas_proveedores', false, 10485760,
  ARRAY['application/pdf', 'image/jpeg', 'image/png', 'image/webp']
)
ON CONFLICT (id) DO UPDATE SET
  public = false,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

CREATE POLICY "facturas_proveedores - privileged owner upload" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'facturas_proveedores'
    AND (storage.foldername(name))[1] = (SELECT auth.uid())::text
    AND name ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}/[0-9a-f-]{36}\.(pdf|jpg|png|webp)$'
    AND (SELECT public.is_privileged())
    AND (SELECT public.validate_session())
  );

CREATE POLICY "facturas_proveedores - privileged owner read" ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'facturas_proveedores'
    AND (storage.foldername(name))[1] = (SELECT auth.uid())::text
    AND (SELECT public.is_privileged())
    AND (SELECT public.validate_session())
  );

-- Only unreferenced objects can be deleted (orphans from a failed save or a
-- detached document); a document an invoice points to stays.
CREATE POLICY "facturas_proveedores - privileged owner delete unreferenced" ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'facturas_proveedores'
    AND (storage.foldername(name))[1] = (SELECT auth.uid())::text
    AND (SELECT public.is_privileged())
    AND (SELECT public.validate_session())
    AND NOT EXISTS (
      SELECT 1 FROM public.facturas_proveedores f WHERE f.documento_path = storage.objects.name
    )
  );
