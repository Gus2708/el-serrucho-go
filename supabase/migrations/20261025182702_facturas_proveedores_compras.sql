-- Supplier-invoice automation: one stable, empty purchase draft per invoice + linked-draft guard.
--
-- Scope: an authoritative binding (invoice UUID -> compras_app draft) and the server-side
-- guard that keeps a linked draft from being edited, emitted, deleted or truncated. Never
-- writes amounts, items, provider/header fields, stock, catalog, orders, prices or queues;
-- transfer of reviewed values is a later unit. The binding is NOT purchase authority and
-- `emitido` is unreachable for linked drafts until a future reviewed migration says otherwise.
-- Unlinked (manual / legacy) purchases and their policies, columns and constraints are unchanged.
--
-- Guarantees and limits of the guard:
--   * The link state of a row is fixed when the row becomes visible: preparar_compra_factura
--     inserts a NEW draft and its binding in one transaction, never links an existing draft,
--     and the binding can never be deleted, moved or re-pointed. A draft therefore cannot be
--     observed unlinked and later become linked. That fact only helps a reader whose target
--     draft is already visible: the item guard reads the binding BEFORE the row's foreign key
--     runs at end of statement, so it first requires the target purchase to be visible and
--     key-share locked (see proteger_items_compra_vinculada) and refuses an invisible one.
--     The staged interleaving is covered by a single-connection test; real two-session
--     behavior is not proved by this repository's PGlite suite.
--   * Row triggers do not fire for TRUNCATE; statement triggers refuse it on both purchase
--     tables while any link exists (coarse and fail-closed by design). Independently of links,
--     the binding's RESTRICT foreign key makes TRUNCATE of compras_app itself fail for client
--     roles (0A000 when the statement does not also list the binding, 42501 with CASCADE, which
--     reaches a table without a TRUNCATE grant); TRUNCATE of the items table alone is unaffected.
--   * Triggers apply to every role, including service_role and the table owner. A superuser
--     or DDL access (DROP/DISABLE TRIGGER, session_replication_role) can still bypass any
--     trigger or FK; that is outside what this guard can claim.
--   * Under READ COMMITTED (Supabase default) concurrent prepare calls serialize on the shared
--     per-invoice advisory lock and the PK; under REPEATABLE READ/SERIALIZABLE a loser fails
--     closed with a unique violation instead of creating a second draft.
-- Error codes the client maps (existing ones are the invoice review codes):
--   42501 not authorized · PV409 stale invoice version/document · PR409 stale revision
--   PI409 fingerprint mismatch · 22023 invalid payload or revision not approved
--   P0002 invoice or revision not found · PC409 linked draft no longer pristine
--   55000 linked purchase is locked · 23001 linked purchase/invoice/revision RESTRICTed

-- ── 1. Binding table ─────────────────────────────────────────────────────────
CREATE TABLE public.facturas_proveedores_compras (
  factura_id        uuid PRIMARY KEY REFERENCES public.facturas_proveedores(id) ON DELETE RESTRICT,
  compra_id         bigint NOT NULL UNIQUE REFERENCES public.compras_app(id) ON DELETE RESTRICT,
  revision          integer NOT NULL,
  fingerprint       text NOT NULL CHECK (fingerprint ~ '^[0-9a-f]{64}$'),
  factura_version   integer NOT NULL CHECK (factura_version >= 1),
  documento_sha256  text CHECK (documento_sha256 IS NULL OR documento_sha256 ~ '^[0-9a-f]{64}$'),
  vinculado_por     uuid NOT NULL REFERENCES auth.users(id),
  vinculado_en      timestamptz NOT NULL DEFAULT now(),
  actualizado_en    timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (factura_id, revision)
    REFERENCES public.facturas_proveedores_revisiones (factura_id, revision) ON DELETE RESTRICT
);

-- ── 2. Privileges and RLS ────────────────────────────────────────────────────
-- Supabase default privileges grant ALL to anon/authenticated/service_role on new tables.
REVOKE ALL ON public.facturas_proveedores_compras FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.facturas_proveedores_compras TO authenticated;

ALTER TABLE public.facturas_proveedores_compras ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Privileged owner - read own facturas compras"
  ON public.facturas_proveedores_compras
  FOR SELECT TO authenticated
  USING (
    vinculado_por = (SELECT auth.uid())
    AND (SELECT public.is_privileged())
    AND (SELECT public.validate_session())
  );

-- ── 3. Guards ────────────────────────────────────────────────────────────────
-- The binding keeps its identity forever; only the revision the draft follows may move.
CREATE FUNCTION facturas_privado.proteger_vinculo_compra_factura()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'UPDATE'
     AND (OLD.factura_id, OLD.compra_id, OLD.vinculado_por, OLD.vinculado_en)
         IS NOT DISTINCT FROM (NEW.factura_id, NEW.compra_id, NEW.vinculado_por, NEW.vinculado_en) THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'vinculo_inmutable' USING ERRCODE = '55000';
END;
$$;

-- Header: any UPDATE of a linked purchase (emit, backend reset, identity, header fields).
-- Header DELETE is stopped by the RESTRICT foreign key of the binding.
CREATE FUNCTION facturas_privado.proteger_compra_vinculada()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.facturas_proveedores_compras WHERE compra_id = OLD.id) THEN
    RAISE EXCEPTION 'compra_factura_bloqueada' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;

-- Items: INSERT/UPDATE/DELETE on a linked parent, checking both the old and the new parent so
-- an item cannot be moved into or out of a linked purchase.
-- An item that ENTERS a parent (INSERT, or UPDATE that changes compra_id) first requires that
-- parent to be visible and takes FOR KEY SHARE on it, old and new parent in id order, and only
-- then reads the binding. A binding commits with its draft, so a visible parent already shows
-- it, and a not-yet-visible one is refused instead of being admitted before the end-of-statement
-- FK check (a BYPASSRLS writer could otherwise slip in while preparar_compra_factura commits).
-- The refusal carries the code the writer got before: 23503 for a writer that bypasses RLS,
-- 42501 for one subject to the policy. NULL parents are left to the NOT NULL check and DELETE
-- needs no visible parent: an unlinked parent's ON DELETE CASCADE runs after it is gone.
CREATE FUNCTION facturas_privado.proteger_items_compra_vinculada()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_antes   bigint;
  v_despues bigint;
  v_visible boolean;
BEGIN
  IF TG_OP <> 'INSERT' THEN
    v_antes := OLD.compra_id;
  END IF;
  IF TG_OP <> 'DELETE' THEN
    v_despues := NEW.compra_id;
  END IF;

  IF v_despues IS NOT NULL AND v_despues IS DISTINCT FROM v_antes THEN
    SELECT coalesce(bool_or(p.id = v_despues), false) INTO v_visible
      FROM (SELECT id FROM public.compras_app
             WHERE id IN (v_despues, v_antes) ORDER BY id FOR KEY SHARE) p;
    IF NOT v_visible THEN
      -- The RLS WITH CHECK answers after this trigger: a writer subject to RLS keeps its refusal
      -- and one that bypasses RLS keeps the foreign key's. Either way the row is refused here.
      -- shortcut: the caller is read from the SET ROLE / login role, so a table owner without
      -- BYPASSRLS gets the RLS code; only the code differs, never the refusal.
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

  IF EXISTS (SELECT 1 FROM public.facturas_proveedores_compras WHERE compra_id IN (v_antes, v_despues)) THEN
    RAISE EXCEPTION 'compra_factura_bloqueada' USING ERRCODE = '55000';
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

-- TRUNCATE skips row triggers and the FK RESTRICT of rows it removes: refuse it while any link exists.
CREATE FUNCTION facturas_privado.proteger_truncate_compras_vinculadas()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.facturas_proveedores_compras) THEN
    RAISE EXCEPTION 'compra_factura_bloqueada' USING ERRCODE = '55000';
  END IF;
  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION facturas_privado.proteger_vinculo_compra_factura() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION facturas_privado.proteger_compra_vinculada() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION facturas_privado.proteger_items_compra_vinculada() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION facturas_privado.proteger_truncate_compras_vinculadas() FROM PUBLIC, anon, authenticated, service_role;

CREATE TRIGGER facturas_compras_inmutable
  BEFORE UPDATE OR DELETE ON public.facturas_proveedores_compras
  FOR EACH ROW EXECUTE FUNCTION facturas_privado.proteger_vinculo_compra_factura();

CREATE TRIGGER facturas_compras_sin_truncate
  BEFORE TRUNCATE ON public.facturas_proveedores_compras
  FOR EACH STATEMENT EXECUTE FUNCTION facturas_privado.proteger_vinculo_compra_factura();

CREATE TRIGGER compras_app_vinculada
  BEFORE UPDATE ON public.compras_app
  FOR EACH ROW EXECUTE FUNCTION facturas_privado.proteger_compra_vinculada();

CREATE TRIGGER compras_app_sin_truncate_vinculadas
  BEFORE TRUNCATE ON public.compras_app
  FOR EACH STATEMENT EXECUTE FUNCTION facturas_privado.proteger_truncate_compras_vinculadas();

CREATE TRIGGER compras_app_items_vinculada
  BEFORE INSERT OR UPDATE OR DELETE ON public.compras_app_items
  FOR EACH ROW EXECUTE FUNCTION facturas_privado.proteger_items_compra_vinculada();

CREATE TRIGGER compras_app_items_sin_truncate_vinculadas
  BEFORE TRUNCATE ON public.compras_app_items
  FOR EACH STATEMENT EXECUTE FUNCTION facturas_privado.proteger_truncate_compras_vinculadas();

-- ── 4. Prepare the purchase draft of an approved revision ────────────────────
-- Same predicates and error codes as aprobar_revision_factura, rechecked under the same
-- per-invoice lock: approval alone does not freeze the invoice, so owner, latest revision,
-- fingerprint, invoice version and document are verified again here.
CREATE FUNCTION facturas_privado.preparar_compra_factura(
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
  v_uid       uuid := auth.uid();
  v_factura   public.facturas_proveedores%ROWTYPE;
  v_rev       public.facturas_proveedores_revisiones%ROWTYPE;
  v_vinculo   public.facturas_proveedores_compras%ROWTYPE;
  v_ultima    integer;
  v_compra_id bigint;
BEGIN
  IF v_uid IS NULL OR NOT public.is_privileged() OR NOT public.validate_session() THEN
    RAISE EXCEPTION 'no_autorizado' USING ERRCODE = '42501';
  END IF;

  IF p_factura_id IS NULL OR p_revision IS NULL OR p_revision < 1
     OR p_fingerprint IS NULL OR p_fingerprint !~ '^[0-9a-f]{64}$'
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

  IF v_rev.aprobado_por IS NULL THEN
    RAISE EXCEPTION 'revision_no_aprobada' USING ERRCODE = '22023';
  END IF;
  PERFORM facturas_privado.exigir_revision_completa(v_rev.contenido);

  SELECT * INTO v_vinculo FROM public.facturas_proveedores_compras WHERE factura_id = p_factura_id;

  IF NOT FOUND THEN
    -- Draft and binding commit together; neither is visible without the other.
    INSERT INTO public.compras_app (creado_por, status) VALUES (v_uid, 'borrador')
    RETURNING id INTO v_compra_id;

    INSERT INTO public.facturas_proveedores_compras (
      factura_id, compra_id, revision, fingerprint, factura_version, documento_sha256, vinculado_por
    ) VALUES (
      p_factura_id, v_compra_id, p_revision, v_rev.fingerprint, v_rev.factura_version, v_rev.documento_sha256, v_uid
    );
    RETURN jsonb_build_object(
      'factura_id', p_factura_id, 'compra_id', v_compra_id, 'revision', p_revision,
      'fingerprint', v_rev.fingerprint, 'replay', false, 'rebind', false
    );
  END IF;

  IF v_vinculo.revision = p_revision THEN
    RETURN jsonb_build_object(
      'factura_id', p_factura_id, 'compra_id', v_vinculo.compra_id, 'revision', p_revision,
      'fingerprint', v_rev.fingerprint, 'replay', true, 'rebind', false
    );
  END IF;

  -- A newer approved revision may only retarget the same draft while it is still the empty
  -- draft this function created; anything else fails closed and never makes a second draft.
  IF EXISTS (SELECT 1 FROM public.compras_app_items WHERE compra_id = v_vinculo.compra_id)
     OR NOT EXISTS (
       SELECT 1 FROM public.compras_app
        WHERE id = v_vinculo.compra_id
          AND status = 'borrador' AND backend_status = 'pendiente'
          AND backend_intentos = 0 AND backend_resultado IS NULL AND backend_aplicado_en IS NULL
          AND proveedor_codigo IS NULL AND proveedor_nombre IS NULL AND nota IS NULL
          AND numero_documento IS NULL AND titulo IS NULL
     ) THEN
    RAISE EXCEPTION 'compra_factura_no_modificable' USING ERRCODE = 'PC409';
  END IF;

  UPDATE public.facturas_proveedores_compras
     SET revision = p_revision, fingerprint = v_rev.fingerprint,
         factura_version = v_rev.factura_version, documento_sha256 = v_rev.documento_sha256,
         actualizado_en = now()
   WHERE factura_id = p_factura_id;

  RETURN jsonb_build_object(
    'factura_id', p_factura_id, 'compra_id', v_vinculo.compra_id, 'revision', p_revision,
    'fingerprint', v_rev.fingerprint, 'replay', false, 'rebind', true
  );
END;
$$;

REVOKE ALL ON FUNCTION facturas_privado.preparar_compra_factura(uuid, integer, text, integer)
  FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION facturas_privado.preparar_compra_factura(uuid, integer, text, integer)
  TO authenticated;

CREATE FUNCTION public.preparar_compra_factura(
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
  SELECT facturas_privado.preparar_compra_factura(p_factura_id, p_revision, p_fingerprint, p_factura_version)
$$;

REVOKE ALL ON FUNCTION public.preparar_compra_factura(uuid, integer, text, integer)
  FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.preparar_compra_factura(uuid, integer, text, integer)
  TO authenticated;
