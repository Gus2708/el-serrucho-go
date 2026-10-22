-- Fix: orphan cleanup vs. invoice save race on the source document.
--
-- Migration 20261019050130 is already applied and stays untouched. Its save
-- checks that the Storage object exists, and its DELETE policy checks that no
-- committed invoice references it; neither takes a lock, so under READ COMMITTED
-- both can succeed and leave a saved invoice pointing at a deleted document:
--   bind-first:   save sees the object, delete's snapshot sees no reference,
--                 delete commits, save commits its reference.
--   delete-first: delete's policy passes, save binds and commits, delete commits.
--
-- Protocol: binding a document to an invoice and deleting its Storage object
-- both take the same transaction-scoped advisory lock (keyed on the object
-- path) and then re-check under it. The re-check runs after the lock is
-- acquired, so it sees whatever the other side committed:
--   bind-first:   delete waits for the save to commit, then sees the reference
--                 and is skipped (like the policy would have done).
--   delete-first: save waits for the delete to commit, then finds no object and
--                 fails with payload_invalido: documento.
-- The save function is unchanged; the trigger enforces the invariant for any
-- writer of facturas_proveedores.documento_path.

CREATE FUNCTION facturas_privado.bloquear_documento(p_path text)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT pg_advisory_xact_lock(hashtextextended('facturas_proveedores:documento:' || p_path, 0))
$$;

-- BEFORE INSERT/UPDATE on the invoice: lock the path, then require the object.
CREATE FUNCTION facturas_privado.exigir_documento_existente()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  PERFORM facturas_privado.bloquear_documento(NEW.documento_path);
  IF NOT EXISTS (
    SELECT 1 FROM storage.objects o
     WHERE o.bucket_id = 'facturas_proveedores' AND o.name = NEW.documento_path
  ) THEN
    RAISE EXCEPTION 'payload_invalido: documento' USING ERRCODE = '22023';
  END IF;
  RETURN NEW;
END;
$$;

-- BEFORE DELETE on the object: lock the path, then skip if an invoice references it.
-- Returning NULL skips the row, which is what the DELETE policy does for a referenced object.
CREATE FUNCTION facturas_privado.proteger_documento_referenciado()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  PERFORM facturas_privado.bloquear_documento(OLD.name);
  IF EXISTS (SELECT 1 FROM public.facturas_proveedores f WHERE f.documento_path = OLD.name) THEN
    RETURN NULL;
  END IF;
  RETURN OLD;
END;
$$;

REVOKE ALL ON FUNCTION facturas_privado.bloquear_documento(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION facturas_privado.exigir_documento_existente() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION facturas_privado.proteger_documento_referenciado() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER facturas_proveedores_documento_existente
  BEFORE INSERT OR UPDATE OF documento_path ON public.facturas_proveedores
  FOR EACH ROW WHEN (NEW.documento_path IS NOT NULL)
  EXECUTE FUNCTION facturas_privado.exigir_documento_existente();

CREATE TRIGGER facturas_proveedores_documento_protegido
  BEFORE DELETE ON storage.objects
  FOR EACH ROW WHEN (OLD.bucket_id = 'facturas_proveedores')
  EXECUTE FUNCTION facturas_privado.proteger_documento_referenciado();
