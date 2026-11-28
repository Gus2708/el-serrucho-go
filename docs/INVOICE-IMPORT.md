# Simple invoice import

The task is grouped into **Factura → Productos → Compra**. The compact review
update also supports explicit invoice-wide percentage discounts before IVA.
Product identity, approval authority and inventory execution remain guarded.
Publication requires separate approval.

## Staff workflow

1. Open Compras and choose **Cargar factura con foto**, then **Nueva factura**.
   Choose the supplier, attach a photo/PDF and enter the required invoice fields.
   **Guardar y continuar** saves the invoice; it does not call the reading service.
2. In **Productos**, press **Buscar productos** after reading the external-service
   and possible-cost notice. A fresh successful initial result opens locally
   without a second apply click. An existing saved reading still offers
   **Ver productos encontrados**; opening a screen never starts a paid read.
3. Answer the invoice questions and review each product. **Sí, es este** confirms
   a suggestion; **Es otro producto** opens **Buscar en inventario**, the same
   product search as Compras (name, code or barcode, with stock), and the chosen
   row is applied only with a motive through **Usar este producto**;
   **No está en el inventario** starts the explicit new-product path.
   Set document type, price inclusion, IVA, **1 unidad** for products whose units
   are still missing, and percentage discounts once in the invoice settings; once
   answered they collapse to one summary with **Cambiar**. Existing exempt or mixed
   rates and package factors survive unless explicitly changed.
   Choosing an existing product writes its current inventory selling price
   (IVA included) in the price field and saves it with the choice; a price typed
   for the same product is kept, and another product brings its own price.
   After choosing a product, only that choice remains; **Cambiar producto**
   restores the alternatives. Confirm units and review the selling price beside
   the detected invoice cost. A different net stock-unit cost is labelled
   separately. The main button
   opens the next unfinished product. It does not confirm a product for the user.
4. In **Compra**, resolve the displayed questions or product issues. Use
   **Guardar cambios**, **Confirmar revisión**, then **Crear borrador de compra**.
   The resulting draft remains editable. Imported purchase emission stays blocked.

Optional invoice fields and manual entry live under **Más datos**. Support
diagnostics remain available separately rather than occupying the main path.
The photo viewer and camera retain their existing guarded behavior.

## Important boundaries

- Search suggestions are not proof that two products are identical. A partial
  inventory search never proves a product is new.
- Selecting a suggestion, entering IVA and confirming units remain explicit.
  Filling missing IVA preserves existing choices; replacing all rates is a
  separate explicit action. Exceptional per-product corrections stay under
  **Más opciones**, not in the primary form.
- An existing product's selling price is its current inventory price as is: no
  markup and no extra IVA. Only a new product uses the cost-based suggestion. A
  saved existing product without a price shows the current price as not applied;
  **Usar precio actual** (or typing a price) is required before confirming or
  creating the draft. A price that cannot be read is never invented.
- Percentage discounts such as `20+5` are sequential, not additive: $100 becomes
  $76 before IVA. Already-included discounts are not deducted again. Fixed-USD
  global discounts still require an allocation policy and remain blocked.
- A corroborated code/alias match can suppress dominated search noise. Conflicts
  are checked before filtering, and strong competitors remain available.
  Without an identifier, semantic leads remain suggestions; relevance is not
  proof of identity or an accuracy guarantee.
- A new product still needs its captured code and a clean current collision
  check. Capturing a code alone does not create a catalog product.
- Changing the invoice, photo, session or review invalidates pending work as
  before. Initial loading never replaces existing content or bypasses the
  explicit replacement-motive workflow.
- No data migration, inventory update, provider request, app publication or APK
  build is part of implementing this interface.

## Direction and verification

This is an Operate surface for busy store staff. Keep the existing gold/black
theme tokens and typography; primary color identifies the next useful action.
Use readable guidance, touch targets of at least 44px, phone accordions and
desktop list/detail layout. Do not introduce an app-wide visual identity.

The implementation keeps the existing `EtapaRevision` union and normalizes its
legacy `leer` value into Productos. Hook, repository and saved-revision JSON
contracts stay unchanged. Shared calculation now admits unambiguous global
percentage discounts; explicit-policy and fixed-amount cases keep their prior
rules. UI tests and typechecking establish behavior, not rendered pixels,
real camera/keyboard operation or authenticated production correctness.

## Compact review rollout boundary (1.2.11 preparation)

The compact update is local and awaiting integrated verification. Both
`recalcular-revision-factura` and `materializar-compra-factura` import the shared
calculation module and must be deployed from the same accepted source before
hosted discounted-invoice use. Publishing only the web client is insufficient.
No deployment, migration, provider call, purchase emission or APK build has been
performed for this update. Printed header subtotals still use the existing
documentary comparison; a pre-discount subtotal may need an explicit motivated
correction. Do not bypass a documentary discrepancy to create a draft.
## Local verification for 1.2.10

The original frozen implementation passed 1485 unit, 455 UI and 443 SQL tests,
with zero lint errors. After the single visual correction, independent checks
passed TypeScript, all nine affected invoice UI suites (380 tests), and the same
32 public-interface scenarios on both the baseline and corrected implementation.
All 32 write-log comparisons and eight saved payloads agreed. The exact-origin
async code was independently confirmed unchanged by the visual correction.

The visual verifier rendered actual components with closed synthetic data and
captured 16 web views at 360x800, 390x844 and 1280x900. Its four listed issues were
resolved: the first pending product is visible before the phone fold, disabled
controls/placeholders are readable, desktop Compra is bounded, and secondary
controls no longer compete with the primary action. No horizontal overflow or
interactive targets below 44px were observed in those views.

These are scoped local results, not proof of perfect matching, empirical staff
usability, native camera/keyboard behavior or a successful production deployment.
Earlier partial reports remain historical, not relabelled as successful runs.
No external invoice-reading call or real business write was made during this
verification. At that local checkpoint, the new interface had not been published.
