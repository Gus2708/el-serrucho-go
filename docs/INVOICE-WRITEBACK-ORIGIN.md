# Invoice Write-Back Origin Read Contract

> **Status: local migration source only.** Not applied to any live or remote database, not deployed, and not verified against production PostgREST or multi-session concurrency.

## Purpose

Backend purchase consumers need a canonical answer for whether an existing `public.compras_app` row originated from a supplier invoice, without:

- granting `SELECT` or DML on `public.facturas_proveedores_compras` to `service_role`, `anon`, or `authenticated`;
- inferring origin from editable header fields (`titulo`, `nota`, `numero_documento`);
- exposing invoice UUIDs, owners, revisions, fingerprints, line items, amounts, or keys.

## SQL Contract

Migration: `supabase/migrations/20261120210740_invoice_writeback_origin.sql` (fully additive; touches no existing tables, views, triggers, policies, OIDs, or ACLs).

### Public Wrapper

- **Signature:** `public.es_compra_de_factura(p_compra_id bigint) RETURNS boolean`
- **Attributes:** `LANGUAGE sql`, `STABLE`, `SECURITY INVOKER`, `SET search_path = ''`, `CALLED ON NULL INPUT` (not `STRICT`, so `NULL` raises `22023` instead of returning `NULL`).
- **Grants:** `EXECUTE` revoked from `PUBLIC`, `anon`, `authenticated`, `service_role`, then granted **only** to `service_role`.

### Private Helper

- **Schema:** `invoice_writeback_private` (unexposed private schema; separate from `facturas_privado` so existing `facturas_privado` ACLs remain untouched). `USAGE` granted **only** to `service_role`; no `CREATE`, no tables, no views, no triggers.
- **Signature:** `invoice_writeback_private.es_compra_de_factura(p_compra_id bigint) RETURNS boolean`
- **Attributes:** `LANGUAGE plpgsql`, `STABLE`, `SECURITY DEFINER`, `SET search_path = ''`, schema-qualified `public.compras_app` and `public.facturas_proveedores_compras`.
- **Grants:** `EXECUTE` revoked from `PUBLIC`, `anon`, `authenticated`, `service_role`, then granted **only** to `service_role`.

Owner/superuser roles remain trusted under normal PostgreSQL privilege semantics; ACLs do not claim to block the database owner or superuser.

## Return & Error Semantics

| Input / Caller | Result | Meaning |
| --- | --- | --- |
| Existing `compras_app.id` with row in `facturas_proveedores_compras` (`service_role`) | `true` (`boolean`) | Canonical invoice-linked purchase (independent of editable header fields). |
| Existing `compras_app.id` without row in `facturas_proveedores_compras` (`service_role`) | `false` (`boolean`) | Existing manual/unlinked purchase. |
| `p_compra_id IS NULL` or `p_compra_id < 1` | SQLSTATE `22023` (`compra_id_invalido`) | Invalid identifier; never treated as manual. |
| Nonexistent or deleted `p_compra_id` | SQLSTATE `P0002` (`compra_no_encontrada`) | Unknown purchase; never treated as manual (`false`). |
| `anon`, `authenticated` (any app role/session), or spoofed `request.jwt.claim.role = 'service_role'` under a non-`service_role` DB role | SQLSTATE `42501` (`permission denied`) | Rejected by PostgreSQL role `EXECUTE` ACL; never returns `false`. |

## Backend PostgREST Call Contract

- **Endpoint:** `POST <SUPABASE_URL>/rest/v1/rpc/es_compra_de_factura`
- **Headers:**
  - `Authorization: Bearer <SUPABASE_SERVICE_ROLE_KEY>`
  - `apikey: <SUPABASE_SERVICE_ROLE_KEY>`
  - `Content-Type: application/json`
- **Body:** `{"p_compra_id": <positive integer>}`
- **Timeout & fail-closed rule:** Caller must enforce a bounded HTTP timeout and require HTTP `200` with an exact JSON boolean (`true` or `false`). Any non-200 status (including `401`/`403` from an anon key, `400`/`404` from `22023`/`P0002`), timeout, network error, `null`, or non-boolean body must be treated as **unknown / unsafe**, never defaulted to `false` (manual).

## Explicit Non-Guarantees & Boundaries

- **Snapshot lookup only:** Returns binding state at query time; does not provide cross-system transactionality with a later Hybrid POS write.
- **No execution authority:** Never authorizes product creation, inventory mutation, or purchase emission; does not lift the linked-purchase emission guard (`55000 compra_factura_bloqueada`) and does not detect stale invoice revisions or document changes at execution time.
- **Local verification limits:** Verified locally in single-connection PGlite (`supabase/tests/facturasCompras.sql.test.ts`), which stubs `validate_session()` and `is_active_employee()` and does not test production PostgREST HTTP mapping, live Supabase grants, or two-session concurrency.
