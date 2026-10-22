# Supplier-invoice persistence

Status: this branch (schema block) carries the invoice schema migration and its SQL tests only.
The migration was applied earlier under the authorized rollout (see
[SUPPLIER-INVOICE-REVIEW.md](SUPPLIER-INVOICE-REVIEW.md)). This block does not re-apply it and
makes no fresh read of any remote database. Scope: attach a source document, save an invoice
with its original lines, reopen it. Nothing here does OCR, creates a purchase, writes
`compras_app`, changes stock or emits to the POS. The negative-stock compensation already
lives in the purchase hook (`src/hooks/useCompra.ts`) and is not touched by this block.

**Staging.** The domain, repository, local-recovery, controller and UI code described below
ships in later blocks of the same feature; those files do not exist on this branch. Sections
that describe them are the target design of the full feature, not code present here.

Entry point (later UI block): **ComprasView → "Facturas de proveedor"** (admin/superempleado only, hidden in demo mode).

## Data model

Migration `supabase/migrations/20261019050130_facturas_proveedores_persistencia.sql`
(the timestamp name sorts after `048`).

| Object | Purpose |
|---|---|
| `facturas_proveedores` | Header: `id uuid` (client-generated, stable), owner, supplier/number/control/date/currency as printed, `version`, one private source document (`documento_*`). Unreadable fields are `null`, never zero. |
| `facturas_proveedores_lineas` | One row per original line, `linea_id uuid` stable across saves, `orden` from payload position. Repeated SKUs are separate rows. `codigo_producto` is a soft association (no FK; the SKU may not be synced yet). |
| `facturas_proveedores_operaciones` | Idempotency ledger `(factura_id, clave_idempotencia) → content md5, resulting version`. Internal; no grants. |
| `facturas_privado.guardar_factura_proveedor` | `SECURITY DEFINER`, `search_path = ''`, in a schema the Data API does not expose. Does the work. |
| `public.guardar_factura_proveedor` | `SECURITY INVOKER` wrapper, the only RPC the app calls. |
| Bucket `facturas_proveedores` | Private, 10 MB, `pdf/jpeg/png/webp`. Object name `<owner uid>/<factura id>/<document uuid>.<ext>`. |

Amounts are `numeric` and travel as decimal strings. The UI captures USD; the currency code
printed on the document is stored read-only. VES-original storage exists, conversion does not.

## Save contract

`guardar_factura_proveedor(p_factura_id, p_version_esperada, p_clave, p_cabecera, p_lineas)`

- `p_version_esperada = 0` creates; `N >= 1` updates from version `N`. The payload is the full desired state: lines not sent are deleted, `documento: null` detaches the file.
- One transaction: header, lines and ledger row commit together or not at all. A per-invoice advisory lock serializes concurrent saves, creation included.
- Same key + same content → returns the original result with `replay: true`, even after the invoice advanced. Same key + different content → `PI409`.
- Errors a client maps (repository, later block): `42501` not authorized · `PV409` stale version · `PI409` key reused · `22023/23514/22P02/22003/23505` invalid data · `P0002` not found.
- A document is accepted only if its path is `<caller uid>/<this factura id>/…`, the Storage object exists, and its Storage-recorded `mimetype` and `size` equal the declared ones.

The app (later blocks) keeps the idempotency key of a failed attempt and reuses it while the content is
unchanged, so a lost response cannot apply a save twice.

## Authorization

- Every read and write requires `is_privileged()` (active admin/superempleado) **and** `validate_session()`, and ownership. Other privileged users cannot read or modify someone else's invoice.
- `authenticated` has `SELECT` only on the two data tables; all writes go through the RPC. `anon` has no access.
- Storage policies on the bucket: `INSERT` (own folder, strict name pattern), `SELECT` (own folder), `DELETE` (own folder, only objects no invoice references). No `UPDATE`, so an existing object cannot be overwritten; each attachment gets a fresh path.

## Interruption and recovery (target behavior; client parts ship in later blocks)

| Interruption | Result | Recovery |
|---|---|---|
| Upload fails | Nothing referenced | Retry the attach. |
| Upload ok, save never happens (app closed, or leaving the editor) | Private unreferenced object | Editor deletes it on close/replace (best effort). If that fails it stays as an orphan; the owner may delete it. **No garbage-collection job exists yet.** |
| Save committed, response lost | Server has the new version | Retry reuses the same key and the frozen payload → `replay: true`. The unresolved retry is kept in the local draft (see "Local recovery and account isolation"). |
| Another device saved first | `PV409` | Banner offers "Recargar versión del servidor" (discards local edits after confirmation). |
| Document replaced | Old object is unreferenced only after the new save commits | Deleted after that save succeeds. |

## Money, manual entry and optional document (editor ships in a later block)

- Every amount the editor captures and shows is **USD**. Typed amounts are explicitly USD values: nothing is converted, and the UI does not claim they reproduce another currency. The currency printed on the source document is stored read-only.
- Attaching an image or PDF is **optional**. An invoice can be entered and saved manually with no attachment, and the existing manual purchase path in `ComprasView` is unchanged.

## Local recovery and account isolation (later block, not on this branch)

- The editor binds to a durable controller (`useSyncExternalStore`). Each edit is written to a local record keyed `serrucho-factura-v1:{uid}:{facturaId}` **before** any save RPC. If that write fails, no RPC is sent and the UI shows a "not durable" banner.
- A draft or unresolved retry survives unmounting, a page reload or an app restart and is restored for the **same account** only: header fields, lines with stable IDs and order, and acknowledged attachment references. Raw file bytes and signed URLs are never stored locally.
- The auth root publishes the real session uid. A different or missing uid yields `cuenta_cambiada`: zero RPC and zero local writes for the other account. Switching account and coming back shows each account's own drafts.
- The modal lists "BORRADORES EN ESTE DISPOSITIVO" first and `ComprasView` shows a badge with the pending count. Nothing opens automatically. Unreadable or newer-schema records are reported and writes to them are blocked.
- Closing with unsaved changes asks for confirmation and keeps the draft locally. Discarding is a separate action with its own confirmation.

## Frozen retry limits (later block, not on this branch)

- A pending retry holds the exact payload and idempotency key of the failed attempt. Pressing save again, or "Reintentar", sends that frozen payload, not the latest edits.
- Edits typed while a save is pending stay in the draft and go out in a later save; the acknowledgement does not overwrite them.
- Changing content under a reused key is rejected with `PI409`. A stale version (`PV409`) offers a reload of the server version after confirmation, which discards local edits.
- Close is blocked while a save or upload is in flight.

## Single-runtime guarantee, and what it does not give (later block)

Serialization of local writes is guaranteed **inside one JavaScript runtime** (one tab or one app process): a per-key queue outlives controllers and sequence numbers never decrease. There is **no cross-tab, cross-window or cross-process coordination**. Two tabs editing the same invoice can overwrite each other's local record; the server's version check (`PV409`) is the only cross-device guard.

## What was verified, and what was not

Current isolated block (this branch, base `refactor/supplier-invoice-quantities`): **56 SQL
tests** (`npm run test:sql`) on a throwaway PGlite PostgreSQL engine (WASM Postgres, single
connection) applying the real migration: save/reopen, stable IDs, repeated lines, atomic
rollback, replay, key reuse with other content, stale version, foreign line IDs, document
binding, owner isolation, employee/inactive/invalid-session/anon denial, direct DML denial,
Storage policy matrix, no `SECURITY DEFINER` function in `public`. The tests call the public
RPC; no real database is used.

Historical full working tree (before slicing, not isolated-branch proof): 521 unit, 33 UI and
56 SQL tests. Each later block records its own totals.

Purchase quantities: the baseline hook already compensates negative stock (stock -3 with
invoice quantity 10 sends 13; stock +5 sends 10); that is covered by the purchase-quantity
tests on the base branch. This block changes no stock.

Not verified, do not assume:

- **No fresh remote read.** Nothing in this block queried staging or production, and the migration is not re-applied.
- **The harness is a model of Supabase, not Supabase.** `auth.uid()`, `storage.*`, roles and default privileges are minimal fixtures; `validate_session()` is a stub (its production body is not in this repository); `is_privileged()` is copied from migration 026. Storage objects are inserted by direct SQL in tests only; production objects must come from the Storage API.
- **No concurrency proof.** PGlite has one connection: stale-version and replay are tested sequentially. The advisory lock is reasoned, not exercised under contention.
- **No real browser, native, Storage upload or PostgREST run** for the full feature; live acceptance is deferred.
- **Server-side content inspection does not exist.** Storage enforces declared MIME and real size; a modified client could upload mislabeled bytes into its own private folder. Impact is limited to that user's own invoice (private bucket, short-lived signed URLs, fixed content type).
- PostgREST returns `numeric` as JSON numbers, so a client should limit input to 15 significant digits to avoid binary rounding on reopen.

## Checks for any future environment

1. On a staging project, upload through the app and confirm `storage.objects.metadata` carries `mimetype` and `size` (the save RPC depends on them).
2. Confirm `validate_session()` in production behaves as `compras_app` policies assume.
3. Confirm the `facturas_privado` schema is not in the exposed-schemas setting.
4. Run the attach → save → reopen path on a device and on web, with an employee account to confirm denial.
5. Decide retention for orphaned and detached objects (cleanup job).

## Not in this feature slice

OCR/extraction, alias and candidate matching, quantity/factor reconciliation, transfer to `compras_app`, multi-page documents (one document per invoice today), duplicate-invoice policy (the SHA-256 is stored, not enforced), invoice deletion.

**Deferred Hybrid work.** Diagnosing how Hybrid registers a compensated purchase (financial header, cost master) is a read-only investigation on the Hybrid PC, described in [HYBRID-COMPENSACION-DIAGNOSTICO.md](HYBRID-COMPENSACION-DIAGNOSTICO.md). It has not been run. Purchase monetary emission and any Hybrid financial change stay out of this change.

## Future roadmap: barcode for new products (not implemented)

Most new products need a barcode before they are ready in Hybrid. Confirmed future policy: when a **new** product has no manufacturer or physical barcode, use the product code printed on the supplier invoice as its barcode, kept as literal text (leading zeros and alphanumerics preserved). Collisions are checked and sent to manual review, an existing product's barcode is never replaced automatically, and an invoice with no code leaves the barcode unresolved and manual. No exception-approval workflow and no automatic generation are assumed. The actual Hybrid field mapping is **unverified**. Nothing in this change implements it, and `productos` stays read-only.

## Commands

```
npm test                 # unit tests (SQL tests excluded)
npm run test:sql         # SQL + Storage policies on PGlite
npm run typecheck
```

`test:sql` runs Jest with `--experimental-vm-modules` (PGlite loads its WASM through dynamic
import) and is excluded from the default `npm test` so a missing flag cannot crash that run.
CI (`.github/workflows/ci.yml`) runs typecheck, `npm test` and `npm run test:sql`. These are
source-level checks; none replaces live-runtime proof.
