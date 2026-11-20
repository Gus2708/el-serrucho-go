-- Service-only read contract for canonical supplier-invoice purchase origin.
--
-- Scope: answers whether an existing public.compras_app row is canonically linked in
-- public.facturas_proveedores_compras, without granting table SELECT/DML to service_role,
-- anon, or authenticated and without returning any invoice/revision/document metadata.
--
-- Contract: public.es_compra_de_factura(p_compra_id bigint) RETURNS boolean
--   * true  -> existing compras_app row has a canonical link in facturas_proveedores_compras
--   * false -> existing compras_app row has no canonical link (manual / unlinked purchase)
--   * 22023 compra_id_invalido   -> p_compra_id IS NULL or p_compra_id < 1
--   * P0002 compra_no_encontrada -> no public.compras_app row with id = p_compra_id (unknown is NOT manual)
--   * 42501 permission denied    -> any caller lacking EXECUTE (anon, authenticated, spoofed JWT claims)
--
-- Security model:
--   * Public wrapper is STABLE SECURITY INVOKER with empty search_path; EXECUTE granted ONLY to service_role.
--   * Narrow private helper lives in dedicated unexposed schema invoice_writeback_private (separate from
--     facturas_privado so existing schema/function ACLs stay untouched), STABLE SECURITY DEFINER, empty
--     search_path, schema-qualified identifiers, USAGE/EXECUTE granted ONLY to service_role.
--   * Database-role EXECUTE grants own the access boundary; never trusts caller-supplied JWT claims or
--     parameters. Owner/superuser remains trusted under standard PostgreSQL lifecycle.
--
-- Limits:
--   * Snapshot read only: never authorizes product creation or purchase emission, does not detect stale
--     revisions at execution, does not lift the linked-purchase emission guard, and does not provide
--     cross-system transactionality with a later Hybrid write.

CREATE SCHEMA invoice_writeback_private;

REVOKE ALL ON SCHEMA invoice_writeback_private FROM PUBLIC, anon, authenticated, service_role;
GRANT USAGE ON SCHEMA invoice_writeback_private TO service_role;

CREATE FUNCTION invoice_writeback_private.es_compra_de_factura(
  p_compra_id bigint
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF p_compra_id IS NULL OR p_compra_id < 1 THEN
    RAISE EXCEPTION 'compra_id_invalido' USING ERRCODE = '22023';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.compras_app WHERE id = p_compra_id) THEN
    RAISE EXCEPTION 'compra_no_encontrada' USING ERRCODE = 'P0002';
  END IF;

  RETURN EXISTS (
    SELECT 1 FROM public.facturas_proveedores_compras WHERE compra_id = p_compra_id
  );
END;
$$;

REVOKE ALL ON FUNCTION invoice_writeback_private.es_compra_de_factura(bigint)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION invoice_writeback_private.es_compra_de_factura(bigint)
  TO service_role;

CREATE FUNCTION public.es_compra_de_factura(
  p_compra_id bigint
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT invoice_writeback_private.es_compra_de_factura(p_compra_id)
$$;

REVOKE ALL ON FUNCTION public.es_compra_de_factura(bigint)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.es_compra_de_factura(bigint)
  TO service_role;
