# Supplier invoice persistence: draft review

This feature is being prepared as a draft feature-branch chain.
Do not merge or deploy it as production-validated work.

## Included behavior

- Manual supplier invoices with USD amounts and an optional document.
- Versioned saves, idempotent retries and account-isolated local recovery.
- Protection against overwriting a newer invoice revision.
- Preservation of the existing negative-stock compensation rule.

## Observed local evidence

The working tree passed 521 unit tests, 33 UI tests and 56 SQL tests.
TypeScript passed. ESLint reported zero errors and 2530 unclassified warnings.
These are working-tree totals; isolated child-branch checks must be recorded separately.

Ego Browser exercised an isolated local Supabase fixture: manual entry without
an attachment, save and reload, optional PDF upload, duplicate clicks,
response loss after a committed save, edits after response loss, and rejection
of a stale save from a second editor without losing its draft.

The local fixture used a stub session validator. Its owner-isolation checks do
not establish production session enforcement. The service worker was bypassed.
Ego's request interception did not provide the required production boundary.
No production invoice examples or inventory changes were made by those tests.

## Deferred acceptance

- Real session enforcement and hosted grants.
- Production browser checks with an adequate request boundary.
- Native restart, native document picker and real cross-device checks.
- Hybrid financial representation of compensated quantities (see "Impacto en Hybrid" for the read-only quantification; the representation itself is still unverified).

Attaching and removing a document before saving can leave an unreferenced
Storage object. Object deletion and garbage collection remain outside this slice.
Purchase/POS transfer is also outside this slice. Manual purchase entry remains available.

## Assisted review (draft, not production-validated)

A saved invoice (version 1 or later) shows "Abrir revisión asistida" in the editor.
The panel never replaces manual entry: if the review relations or the extraction
function are not deployed it shows an "unavailable" notice and everything else keeps working.

- **Extraer datos** is an explicit click by the invoice owner. It needs a saved
  document, a saved invoice version and no unsaved manual edits. It sends the
  existing `procesar-factura-multimodal` request once. A busy (409), uncertain or
  failed answer only rereads the attempts; nothing is repeated automatically and
  the client never calls the model provider.
- **Review content** is a separate, append-only revision of the immutable extraction.
  Original, corrected and normalized values stay distinct; every correction (scalar
  fields, ordered discount rows, header tax rows, conversion factor, association,
  barcode intent) carries a motive. A new extraction replaces reviewed work only
  with an explicit motive. Source line IDs are reused from the extraction's history.
- **Saving** calls `guardar_revision_factura` with the expected latest revision and
  invoice version. An uncertain save is retried with the same key and payload;
  an edit gets a new key. A no-op creates no revision. Unsaved panel edits are
  protected by the editor's close guard and reopening resumes the latest saved revision.
- **Calculation** uses the exact decimal domain (`facturaDecimal`, `facturaRevision`).
  Amounts are shown in USD only; non-USD documents, unknown VAT inclusion or rate,
  inexact divisions, global discounts and printed-vs-calculated differences appear as
  explicit blockers. No FX rate, rounding rule, tolerance or global-discount policy is
  approved, so none is applied. The POS representation is always "no verificado".
- **Catalog** reads are bounded and exact: filter values are restricted to a safe
  alphabet, caps mark the result as partial, and barcode uniqueness needs independent
  `codigo_barras` and `codigo_interno` reads that are both complete. Nothing is
  created, no alias is learned and no barcode is replaced.
- **Aprobar revisión** records a human review of the latest saved revision through
  `aprobar_revision_factura`, only with zero freshly recomputed blockers and a saved
  base that still matches the current invoice version and document SHA. It is not
  purchase authority and changes no stock, catalog or POS data.

- **Omitted lines**: "Agregar renglón omitido" adds a documentary line to the same
  revision with a required motive. Extracted source lines, their IDs and order are never
  overwritten or removable; only the added manual rows can be removed.
- **Currency**: while the effective currency is not confirmed USD (VES, any other code or
  unknown), no monetary amount is rendered as digits anywhere in the review: printed
  originals, corrections, typed values, calculated totals and printed-vs-calculated
  differences are replaced by one "Importe oculto" notice, and monetary inputs (unit cost,
  printed totals, tax base/amount, discount amounts, manual-line price) are not offered.
  Codes, descriptions, quantities, units, percentages and the currency field stay
  reviewable, and "Agregar renglón omitido" works without a price. Stored amounts are kept
  byte-for-byte in the extraction and the revision and come back when the currency is
  corrected to USD with a motive. Approval stays blocked until then.
- **Stale results**: loads, saves, catalog matches and barcode checks are admitted only
  for the current lifecycle/session generation (A/B/A and same-account re-login included).
  Barcode proof is bound to the current printed code, associated SKU and extraction, and
  editing either invalidates it immediately. Approval and extraction are disabled as soon
  as the session is gone. These are local fake-boundary guarantees, not production session proof.

- **Impacto en Hybrid (T5, read-only)**: for an unblocked USD review, a section quantifies what
  the confirmed products would mean for Hybrid stock. It has no buttons and changes nothing.
  - Quantities per confirmed SKU, grouped once across its repeated lines (line IDs kept):
    invoiced inventory units, stock read, compensation of a negative balance (applied once per
    SKU, never per line), quantity that would be sent and the expected stock afterwards
    (negative `-3` + receipt `10` -> compensation `3`, send `13`, final `10`; positive `5` -> send
    `10`, final `15`). The arithmetic is `calcularCantidadesCompraDecimal`; the number helper used
    by the manual purchase flow is unchanged.
  - Two ex-VAT *bases* (quantity x net cost), always labelled as such. "Base documental sin IVA" is
    the review's own base; "Base hipotética POS sin IVA" is a hypothetical quantity-times-cost
    calculation with the sent quantity. Neither is an observed or full supplier debt. The review's
    documentary total including taxes is shown separately and never compared with them. Repeated
    lines of one SKU with different net costs are never averaged: the hypothetical figures stay unknown.
  - Stock comes from one read per account, invoice, session generation and SKU set (query key), only
    while the review has no blockers. A sign-out signal or session transition starts a new generation:
    a read still pending from the previous one is never shown, and a completed snapshot from it is
    not reused (same-account re-login included). A remounted review starts its own generation
    counter, so only the app's session-wide cache clear fences across a remount. Pending or failed reads, missing/`null`/`NaN`/non-finite values and new
    products stay *unknown*, never zero; there is no automatic retry and no refresh button. The
    snapshot time is the observed query time, or empty when nothing was read. The default reader
    is the dedicated `fetchExistenciasEstrictas` (`src/lib/facturaExistencias.ts`): only a finite
    number or an explicit decimal string is stock, and demo mode reads nothing. The manual purchase
    reader (`useExistencias`) is unchanged and still maps unreadable stock to zero.
  - Imported emission is always blocked (`emisionImportada.permitida` is the literal `false`, no
    input can change it). The POS precision/rounding and execution-time stock stay "no verificado"
    even for positive stock and zero compensation, and a printed control number or issue date
    blocks too because the current purchase schema cannot transmit them. A revision with blockers
    (including any non-USD or unknown currency) shows no quantity or amount at all.
  - A test-only `salidaPos` (for example 2 decimals, half-up: `0.1234 x 1000` -> bases `123.40` vs
    `120.00`, difference `3.40`) exists only in the domain function's tests. The screen never
    passes it, so no precision is offered or approved.

Outstanding before full T5 can be claimed (not done here; no live access was used):
the deployed purchase listener/robot source and revision, how Hybrid books a compensated
purchase (monetary representation), real monetary precision, rounding and tolerance, how or
whether the control number and date can be transmitted, and a one-time execution-time stock
recheck with an idempotent result lookup (including partial new-product creation). Until then
imported emission stays blocked and a later transfer must recompute independently and refuse.

Not covered by this slice: supplier alias scope, purchase transfer, native/device and
browser proof (the RNTL suite is not native proof), and any deployed-function or
real-extraction check.

## Sale price (PVP) suggestion in the review (local, no purchase effect)

The review shows an editable sale price per line. It is a review aid: nothing here
changes the invoice taxes or costs, creates a purchase, changes stock or enables emission.

- **Document type** is a human choice in the header (`Factura`, `Nota de entrega`, or
  `Sin definir`). It is never inferred from tax arrays, file names or extraction data.
- **Suggestion**: a markup of 30 % on the calculated net unit cost per stock unit
  (`costoNetoUnitarioStock`), not a margin. A delivery note (no VAT) suggests
  `cost x 1.30`; an invoice suggests `cost x 1.30 x 1.16`, applied in sequence. Cost `10.00`
  gives `13.00` and `15.08`; cost `0.1234` gives `0.16042` and `0.1860872`. The
  multiplication is exact (decimal strings, no binary floating point) and no rounding rule is
  approved, so none is applied; an unknown type, unknown or inexact cost, or a zero result
  gives no suggestion. An invoice always carries the 1.16 factor, including for an exempt line.
- **Placeholder**: the suggestion is the placeholder of an empty price field, drawn with the
  muted theme token (not an opacity on the input), so typed text keeps the normal color.
  A short Spanish hint says that an empty field uses the suggestion.
- **Typed price wins**. Valid text is stored at once (no blur needed), so pressing
  Guardar right after typing keeps it. Clearing the field removes the stored price and the
  suggestion applies again. Invalid text (comma, zero, negative, letters, too many digits)
  stays visible, blocks Guardar and Aprobar with a message, and is never replaced by the
  suggestion. It counts as unsaved work for the close guard. It is dropped on reload, another
  invoice, a lost session or a currency whose amounts are hidden.
- **Hidden amounts**: with a non-USD or unknown currency the field, the placeholder, the
  suggestion and any stored price are hidden, like every other amount.
- **Persisted shape** (`review_schema` 1, unchanged version): two optional keys, omitted
  when unset. `cabecera.tipoDocumento` is `factura` or `nota_entrega`; `lineas[].precioVenta`
  is a positive decimal string (up to 12 integer and 8 fraction digits). Only a typed price is
  stored, never a computed suggestion. Content without the keys is byte-identical to before, so
  existing revisions, fingerprints and attestations are unchanged; any other key, a `null`,
  a blank, zero or negative value is refused. A price alone does not satisfy the manual-line
  motive rule.
- **Server**: migration `20261026000305_facturas_revisiones_pvp.sql` replaces
  `facturas_privado.validar_contenido_revision` in place (same identity and no execute grant for
  client roles) so save and approval calls that are already warmed in an open session see the new rules.
  It validates only those two optional fields; no rows are rewritten and no amount is trusted.
- **Rollout limit**: a client that sends the new keys needs that migration applied first
  (an older server refuses them with `22023`). Old clients cannot open revisions containing
  the new keys: their strict validator fails closed. Coordinate the client update and migration.
  This migration has not been applied to any hosted project from this repository.
- **Later purchase step**: the stored price is a person's input. A future materialization must
  recompute the suggestion on the server from the approved content (`cost x 1.30 [x 1.16]`)
  and treat a client value as a proposal, never as authority.
  With an unresolved global discount, the displayed per-line cost and suggestion can still be
  pre-discount. Approval remains blocked; a future purchase must not use that suggestion until
  the financial calculation is complete.

## Purchase binding and linked-draft guard (local, no caller yet)

An approved revision can be tied to exactly one empty purchase draft. This is source identity
only: it carries no amounts, items, provider or header mapping and is **not** purchase authority.

- `public.facturas_proveedores_compras` (migration `*_facturas_proveedores_compras.sql`) is
  the authoritative binding, keyed by the canonical invoice UUID (one purchase per invoice, not per
  revision; physical-document duplicates are deliberately not deduplicated here). `compra_id` is
  unique; invoice, revision and purchase are `ON DELETE RESTRICT`. It stores the revision,
  server fingerprint, invoice version, document SHA-256, actor and timestamps. Authenticated users
  can only read their own row (privileged owner with a valid session); nobody, `service_role`
  included, has DML or TRUNCATE grants on it.
- `preparar_compra_factura(p_factura_id, p_revision, p_fingerprint, p_factura_version)` (private
  `SECURITY DEFINER` function behind an invoker wrapper, `authenticated` only) rechecks under the
  shared per-invoice lock: caller is the privileged, session-valid invoice owner, revision exists,
  fingerprint matches, it is the latest, invoice version and document still match, it is approved
  and complete. Approval alone does not freeze the invoice, so a later edit or revision refuses.
  The first valid call inserts one empty `borrador` (`creado_por` = caller, header fields NULL, no
  items) and the binding in one transaction. The same request replays the same `compra_id`
  (`replay: true`) without touching any row. A newer approved revision retargets only that same
  still-pristine draft (`rebind: true`); a non-pristine draft refuses with `PC409`, an older
  revision with `PR409`, an unapproved one with `22023 revision_no_aprobada`. Other errors reuse the
  review codes (`42501`, `PI409`, `PV409`, `P0002`).
- A linked purchase is locked for every role, `service_role` and the table owner included: any
  header UPDATE, any item INSERT/UPDATE/DELETE (old and new parent are both checked, so items cannot
  be moved in or out), header DELETE (RESTRICT) and TRUNCATE of either purchase table while any
  link exists. `emitido` is therefore unreachable and the purchase listener never sees a linked
  draft. Unlinked manual and legacy purchases are unchanged.
- First-link guard: a draft and its binding commit together and the binding never changes
  identity, so a draft cannot be seen unlinked and later become linked. That alone does not stop a
  `BYPASSRLS` writer (`service_role`) whose item row reaches the BEFORE trigger while the target
  draft is still uncommitted: the foreign key only runs at end of statement. An item that enters a
  purchase (INSERT, or UPDATE that changes `compra_id`) therefore first requires the target to be
  visible and takes `FOR KEY SHARE` on it (old and new target in id order), and only then reads the
  binding. A target that is not visible is refused with the error the writer already got: `23503`
  for a writer that bypasses RLS (`service_role`, the table owner) and `42501` (same message as the
  RLS `WITH CHECK`) for an authenticated owner, so manual error behavior is unchanged. The writer is
  read from the `SET ROLE`/login role: a table owner without `BYPASSRLS` would get `42501` instead of
  `23503`, a different code for the same refusal. A NULL target still gets the NOT NULL error, and
  item DELETE only checks its old binding, so an unlinked purchase's `ON DELETE CASCADE` is
  unchanged.
- Limits, stated plainly: the staged interleaving (an early row's BEFORE trigger, then the draft
  and binding appearing, then the foreign key check) is reproduced on a single-connection PGlite
  engine in one statement. That is a deterministic emulation, not a two-connection proof: real
  lock queues, MVCC visibility between sessions and the early `FOR KEY SHARE` lock (the foreign
  key takes the same lock at statement end) are **not** observed there, nor are the production
  `validate_session()` body and hosted apply. A superuser or DDL access can still disable any
  trigger or constraint. `TRUNCATE` of `compras_app` itself fails for client roles even with no
  link (the binding's RESTRICT foreign key: `0A000` unless the statement also lists the binding,
  `42501` with `CASCADE`); `TRUNCATE` of the items table alone is unchanged without links. No UI
  or repository calls the function yet, so no live linked draft exists; a linked draft would
  appear in the manual Borradores list and every edit there would fail by design (a product
  decision for the UI unit).

## Delivery boundaries

Changes will be grouped by behavior with their tests. Existing notification,
request-resolution and machine configuration edits are excluded. Private test
artifacts, local orchestration state and the historical Playwright executor
are excluded from the publication candidate.

The database migration was applied earlier during the authorized schema rollout.
A draft review or merge does not authorize applying it again, changing inventory,
creating purchases, publishing an app build or deploying this feature.
