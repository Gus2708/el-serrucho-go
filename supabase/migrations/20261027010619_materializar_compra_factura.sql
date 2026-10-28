-- Materialize one server-calculated approved revision into the existing linked purchase draft.
-- The service-only staging RPC is called by the Edge Function after it reads the approved source
-- with the user's JWT and runs the production invoice calculator. The authenticated final RPC
-- rechecks that source under the existing per-invoice lock before writing anything.

ALTER TABLE public.facturas_proveedores_compras
  ADD COLUMN materializado_en timestamptz,
  ADD COLUMN materializacion_sha256 text
    CHECK (materializacion_sha256 IS NULL OR materializacion_sha256 ~ '^[0-9a-f]{64}$');

CREATE TABLE facturas_privado.compra_factura_stages (
  token uuid PRIMARY KEY,
  factura_id uuid NOT NULL REFERENCES public.facturas_proveedores(id) ON DELETE CASCADE,
  revision integer NOT NULL,
  fingerprint text NOT NULL CHECK (fingerprint ~ '^[0-9a-f]{64}$'),
  factura_version integer NOT NULL CHECK (factura_version >= 1),
  documento_sha256 text CHECK (documento_sha256 IS NULL OR documento_sha256 ~ '^[0-9a-f]{64}$'),
  owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  payload jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object')
);

CREATE UNIQUE INDEX compra_factura_stages_source_key
  ON facturas_privado.compra_factura_stages
    (factura_id, revision, fingerprint, factura_version, coalesce(documento_sha256, ''));

REVOKE ALL ON facturas_privado.compra_factura_stages FROM PUBLIC, anon, authenticated, service_role;

CREATE TABLE facturas_privado.compra_factura_materializando (
  txid bigint NOT NULL,
  backend_pid integer NOT NULL,
  compra_id bigint NOT NULL REFERENCES public.compras_app(id) ON DELETE CASCADE,
  PRIMARY KEY (txid, backend_pid, compra_id)
);

REVOKE ALL ON facturas_privado.compra_factura_materializando FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION facturas_privado.registrar_stage_compra_factura(
  p_token uuid,
  p_factura_id uuid,
  p_revision integer,
  p_fingerprint text,
  p_factura_version integer,
  p_documento_sha256 text,
  p_owner_id uuid,
  p_payload jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_token uuid;
BEGIN
  IF coalesce(nullif(current_setting('role'), 'none'), nullif(current_setting('request.jwt.claim.role', true), '')) <> 'service_role' THEN
    RAISE EXCEPTION 'no_autorizado' USING ERRCODE = '42501';
  END IF;
  IF p_token IS NULL OR p_factura_id IS NULL OR p_owner_id IS NULL
     OR p_revision IS NULL OR p_revision < 1
     OR p_factura_version IS NULL OR p_factura_version < 1
     OR p_fingerprint IS NULL OR p_fingerprint !~ '^[0-9a-f]{64}$'
     OR (p_documento_sha256 IS NOT NULL AND p_documento_sha256 !~ '^[0-9a-f]{64}$')
     OR p_payload IS NULL OR jsonb_typeof(p_payload) <> 'object'
     OR NOT (p_payload ?& ARRAY['header', 'items'])
     OR jsonb_typeof(p_payload->'header') <> 'object'
     OR jsonb_typeof(p_payload->'items') <> 'array'
     OR jsonb_array_length(p_payload->'items') < 1 THEN
    RAISE EXCEPTION 'payload_invalido' USING ERRCODE = '22023';
  END IF;

  INSERT INTO facturas_privado.compra_factura_stages (
    token, factura_id, revision, fingerprint, factura_version, documento_sha256, owner_id, payload
  ) VALUES (
    p_token, p_factura_id, p_revision, p_fingerprint, p_factura_version, p_documento_sha256, p_owner_id, p_payload
  )
  ON CONFLICT DO NOTHING;

  SELECT token INTO v_token
    FROM facturas_privado.compra_factura_stages
   WHERE factura_id = p_factura_id AND revision = p_revision
     AND fingerprint = p_fingerprint AND factura_version = p_factura_version
     AND documento_sha256 IS NOT DISTINCT FROM p_documento_sha256
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'stage_no_disponible' USING ERRCODE = 'P0002';
  END IF;

  IF EXISTS (
    SELECT 1 FROM facturas_privado.compra_factura_stages
     WHERE token = v_token AND (owner_id <> p_owner_id OR payload IS DISTINCT FROM p_payload)
  ) THEN
    RAISE EXCEPTION 'stage_conflictivo' USING ERRCODE = '22023';
  END IF;
  RETURN v_token;
END;
$$;

REVOKE ALL ON FUNCTION facturas_privado.registrar_stage_compra_factura(uuid, uuid, integer, text, integer, text, uuid, jsonb)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION facturas_privado.registrar_stage_compra_factura(uuid, uuid, integer, text, integer, text, uuid, jsonb)
  TO service_role;

CREATE FUNCTION public.registrar_stage_compra_factura(
  p_token uuid,
  p_factura_id uuid,
  p_revision integer,
  p_fingerprint text,
  p_factura_version integer,
  p_documento_sha256 text,
  p_owner_id uuid,
  p_payload jsonb
)
RETURNS uuid
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT facturas_privado.registrar_stage_compra_factura(
    p_token, p_factura_id, p_revision, p_fingerprint, p_factura_version,
    p_documento_sha256, p_owner_id, p_payload
  )
$$;

REVOKE ALL ON FUNCTION public.registrar_stage_compra_factura(uuid, uuid, integer, text, integer, text, uuid, jsonb)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.registrar_stage_compra_factura(uuid, uuid, integer, text, integer, text, uuid, jsonb)
  TO service_role;

CREATE OR REPLACE FUNCTION facturas_privado.proteger_compra_vinculada()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_linked boolean;
  v_internal boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM public.facturas_proveedores_compras WHERE compra_id = OLD.id
  ) INTO v_linked;
  IF NOT v_linked THEN RETURN NEW; END IF;

  SELECT EXISTS (
    SELECT 1 FROM facturas_privado.compra_factura_materializando
     WHERE txid = txid_current() AND backend_pid = pg_backend_pid() AND compra_id = OLD.id
  ) INTO v_internal;
  IF v_internal THEN RETURN NEW; END IF;

  IF coalesce(nullif(current_setting('role'), 'none'), nullif(current_setting('request.jwt.claim.role', true), '')) = 'authenticated'
     AND auth.uid() = OLD.creado_por
     AND public.is_privileged()
     AND public.validate_session()
     AND OLD.status = 'borrador'
     AND NEW.status = 'borrador'
     AND NEW.creado_por IS NOT DISTINCT FROM OLD.creado_por
     AND NEW.backend_status IS NOT DISTINCT FROM OLD.backend_status
     AND NEW.backend_resultado IS NOT DISTINCT FROM OLD.backend_resultado
     AND NEW.backend_intentos IS NOT DISTINCT FROM OLD.backend_intentos
     AND NEW.backend_aplicado_en IS NOT DISTINCT FROM OLD.backend_aplicado_en THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'compra_factura_bloqueada' USING ERRCODE = '55000';
END;
$$;

CREATE OR REPLACE FUNCTION facturas_privado.proteger_items_compra_vinculada()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_antes bigint;
  v_despues bigint;
  v_visible boolean;
  v_internal boolean;
  v_linked bigint;
BEGIN
  IF TG_OP <> 'INSERT' THEN v_antes := OLD.compra_id; END IF;
  IF TG_OP <> 'DELETE' THEN v_despues := NEW.compra_id; END IF;

  IF v_despues IS NOT NULL AND v_despues IS DISTINCT FROM v_antes THEN
    SELECT coalesce(bool_or(p.id = v_despues), false) INTO v_visible
      FROM (SELECT id FROM public.compras_app
             WHERE id IN (v_despues, v_antes) ORDER BY id FOR KEY SHARE) p;
    IF NOT v_visible THEN
      IF EXISTS (
        SELECT 1 FROM pg_catalog.pg_roles
         WHERE rolname = coalesce(nullif(current_setting('role'), 'none'), session_user)
           AND NOT (rolsuper OR rolbypassrls)
      ) THEN
        RAISE EXCEPTION 'new row violates row-level security policy for table "compras_app_items"'
          USING ERRCODE = '42501', SCHEMA = 'public', TABLE = 'compras_app_items';
      END IF;
      RAISE EXCEPTION 'insert or update on table "compras_app_items" violates foreign key constraint "compras_app_items_compra_id_fkey"'
        USING ERRCODE = '23503',
              DETAIL = format('Key (compra_id)=(%s) is not present in table "compras_app".', v_despues),
              SCHEMA = 'public', TABLE = 'compras_app_items', CONSTRAINT = 'compras_app_items_compra_id_fkey';
    END IF;
  END IF;

  SELECT compra_id INTO v_linked
    FROM public.facturas_proveedores_compras
   WHERE compra_id IN (v_antes, v_despues)
   ORDER BY compra_id LIMIT 1;
  IF NOT FOUND THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM facturas_privado.compra_factura_materializando
     WHERE txid = txid_current() AND backend_pid = pg_backend_pid() AND compra_id = v_linked
  ) INTO v_internal;
  IF v_internal THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' AND v_antes IS DISTINCT FROM v_despues THEN
    RAISE EXCEPTION 'compra_factura_bloqueada' USING ERRCODE = '55000';
  END IF;
  IF coalesce(nullif(current_setting('role'), 'none'), nullif(current_setting('request.jwt.claim.role', true), '')) <> 'authenticated' OR auth.uid() IS NULL
     OR NOT public.is_privileged() OR NOT public.validate_session()
     OR NOT EXISTS (
       SELECT 1 FROM public.compras_app c
        WHERE c.id = v_linked AND c.creado_por = auth.uid() AND c.status = 'borrador'
     ) THEN
    RAISE EXCEPTION 'compra_factura_bloqueada' USING ERRCODE = '55000';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;

CREATE FUNCTION facturas_privado.materializar_compra_factura(
  p_factura_id uuid,
  p_revision integer,
  p_fingerprint text,
  p_factura_version integer,
  p_token uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_factura public.facturas_proveedores%ROWTYPE;
  v_rev public.facturas_proveedores_revisiones%ROWTYPE;
  v_stage facturas_privado.compra_factura_stages%ROWTYPE;
  v_link public.facturas_proveedores_compras%ROWTYPE;
  v_preparado jsonb;
  v_compra_id bigint;
  v_item jsonb;
BEGIN
  IF v_uid IS NULL OR NOT public.is_privileged() OR NOT public.validate_session() THEN
    RAISE EXCEPTION 'no_autorizado' USING ERRCODE = '42501';
  END IF;
  IF p_factura_id IS NULL OR p_revision IS NULL OR p_revision < 1
     OR p_fingerprint IS NULL OR p_fingerprint !~ '^[0-9a-f]{64}$'
     OR p_factura_version IS NULL OR p_factura_version < 1 OR p_token IS NULL THEN
    RAISE EXCEPTION 'payload_invalido' USING ERRCODE = '22023';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(p_factura_id::text, 0));
  SELECT * INTO v_factura FROM public.facturas_proveedores WHERE id = p_factura_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'factura_no_encontrada' USING ERRCODE = 'P0002'; END IF;
  IF v_factura.creado_por <> v_uid THEN RAISE EXCEPTION 'no_autorizado' USING ERRCODE = '42501'; END IF;
  SELECT * INTO v_rev FROM public.facturas_proveedores_revisiones
   WHERE factura_id = p_factura_id AND revision = p_revision FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'revision_no_encontrada' USING ERRCODE = 'P0002'; END IF;
  IF v_rev.fingerprint <> p_fingerprint THEN RAISE EXCEPTION 'fingerprint_no_coincide' USING ERRCODE = 'PI409'; END IF;
  IF v_rev.aprobado_por IS NULL OR v_rev.aprobado_por <> v_uid THEN RAISE EXCEPTION 'revision_no_aprobada' USING ERRCODE = '22023'; END IF;
  IF (SELECT max(revision) FROM public.facturas_proveedores_revisiones WHERE factura_id = p_factura_id) <> p_revision THEN
    RAISE EXCEPTION 'revision_obsoleta' USING ERRCODE = 'PR409';
  END IF;
  IF v_factura.version <> p_factura_version OR v_rev.factura_version <> v_factura.version
     OR v_factura.documento_sha256 IS DISTINCT FROM v_rev.documento_sha256 THEN
    RAISE EXCEPTION 'version_obsoleta' USING ERRCODE = 'PV409';
  END IF;
  PERFORM facturas_privado.exigir_revision_completa(v_rev.contenido);

  SELECT * INTO v_stage FROM facturas_privado.compra_factura_stages WHERE token = p_token FOR UPDATE;
  IF NOT FOUND OR v_stage.factura_id <> p_factura_id OR v_stage.revision <> p_revision
     OR v_stage.fingerprint <> p_fingerprint OR v_stage.factura_version <> p_factura_version
     OR v_stage.documento_sha256 IS DISTINCT FROM v_factura.documento_sha256
     OR v_stage.owner_id <> v_uid THEN
    RAISE EXCEPTION 'stage_no_coincide' USING ERRCODE = 'PV409';
  END IF;

  SELECT * INTO v_link FROM public.facturas_proveedores_compras WHERE factura_id = p_factura_id FOR UPDATE;
  IF FOUND AND v_link.materializado_en IS NOT NULL THEN
    IF v_link.revision = p_revision AND v_link.fingerprint = p_fingerprint
       AND v_link.factura_version = p_factura_version
       AND v_link.materializacion_sha256 = encode(sha256(convert_to(v_stage.payload::text, 'UTF8')), 'hex') THEN
      RETURN jsonb_build_object('factura_id', p_factura_id, 'compra_id', v_link.compra_id, 'revision', p_revision, 'replay', true);
    END IF;
    RAISE EXCEPTION 'compra_factura_no_modificable' USING ERRCODE = 'PC409';
  END IF;

  v_preparado := facturas_privado.preparar_compra_factura(p_factura_id, p_revision, p_fingerprint, p_factura_version);
  v_compra_id := (v_preparado->>'compra_id')::bigint;
  IF EXISTS (SELECT 1 FROM public.compras_app_items WHERE compra_id = v_compra_id)
     OR NOT EXISTS (
       SELECT 1 FROM public.compras_app WHERE id = v_compra_id AND status = 'borrador'
         AND backend_status = 'pendiente' AND backend_intentos = 0
         AND backend_resultado IS NULL AND backend_aplicado_en IS NULL
     ) THEN
    RAISE EXCEPTION 'compra_factura_no_modificable' USING ERRCODE = 'PC409';
  END IF;

  INSERT INTO facturas_privado.compra_factura_materializando(txid, backend_pid, compra_id)
  VALUES (txid_current(), pg_backend_pid(), v_compra_id);
  UPDATE public.compras_app SET
    proveedor_codigo = nullif(v_stage.payload->'header'->>'proveedor_codigo', ''),
    proveedor_nombre = nullif(v_stage.payload->'header'->>'proveedor_nombre', ''),
    numero_documento = nullif(v_stage.payload->'header'->>'numero_documento', ''),
    nota = nullif(v_stage.payload->'header'->>'nota', ''),
    titulo = nullif(v_stage.payload->'header'->>'titulo', '')
  WHERE id = v_compra_id;

  FOR v_item IN SELECT value FROM jsonb_array_elements(v_stage.payload->'items') LOOP
    IF jsonb_typeof(v_item) <> 'object'
       OR NOT (v_item ?& ARRAY['codigo_producto','descripcion','cantidad','costo','precio','referencia','es_nuevo'])
       OR coalesce(v_item->>'codigo_producto', '') = ''
       OR coalesce(v_item->>'descripcion', '') = ''
       OR (v_item->>'cantidad') !~ '^[0-9]+(\.[0-9]+)?$'
       OR (v_item->>'costo') !~ '^[0-9]+(\.[0-9]+)?$'
       OR (v_item->>'precio') !~ '^[0-9]+(\.[0-9]+)?$'
       OR coalesce(v_item->>'es_nuevo', '') NOT IN ('true', 'false') THEN
      RAISE EXCEPTION 'payload_invalido' USING ERRCODE = '22023';
    END IF;
    INSERT INTO public.compras_app_items (
      compra_id, codigo_producto, descripcion, cantidad, costo, precio, referencia, es_nuevo
    ) VALUES (
      v_compra_id, v_item->>'codigo_producto', v_item->>'descripcion',
      (v_item->>'cantidad')::numeric, (v_item->>'costo')::numeric, (v_item->>'precio')::numeric,
      nullif(v_item->>'referencia', ''), (v_item->>'es_nuevo')::boolean
    );
  END LOOP;

  UPDATE public.facturas_proveedores_compras
     SET materializado_en = now(),
         materializacion_sha256 = encode(sha256(convert_to(v_stage.payload::text, 'UTF8')), 'hex')
   WHERE factura_id = p_factura_id;
  DELETE FROM facturas_privado.compra_factura_materializando
   WHERE txid = txid_current() AND backend_pid = pg_backend_pid() AND compra_id = v_compra_id;

  RETURN jsonb_build_object('factura_id', p_factura_id, 'compra_id', v_compra_id, 'revision', p_revision, 'replay', false);
END;
$$;

REVOKE ALL ON FUNCTION facturas_privado.materializar_compra_factura(uuid, integer, text, integer, uuid)
  FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION facturas_privado.materializar_compra_factura(uuid, integer, text, integer, uuid)
  TO authenticated;

CREATE FUNCTION public.materializar_compra_factura(
  p_factura_id uuid,
  p_revision integer,
  p_fingerprint text,
  p_factura_version integer,
  p_token uuid
)
RETURNS jsonb
LANGUAGE sql
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT facturas_privado.materializar_compra_factura(p_factura_id, p_revision, p_fingerprint, p_factura_version, p_token)
$$;

REVOKE ALL ON FUNCTION public.materializar_compra_factura(uuid, integer, text, integer, uuid)
  FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.materializar_compra_factura(uuid, integer, text, integer, uuid)
  TO authenticated;
