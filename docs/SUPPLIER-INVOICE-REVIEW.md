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

## Delivery boundaries

Changes will be grouped by behavior with their tests. Existing notification,
request-resolution and machine configuration edits are excluded. Private test
artifacts, local orchestration state and the historical Playwright executor
are excluded from the publication candidate.

The database migration was applied earlier during the authorized schema rollout.
A draft review or merge does not authorize applying it again, changing inventory,
creating purchases, publishing an app build or deploying this feature.
