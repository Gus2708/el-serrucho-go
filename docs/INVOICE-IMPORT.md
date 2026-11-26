# Simple invoice import

This local redesign groups the task into **Factura → Productos → Compra**.
It changes presentation and navigation, not financial rules, product identity,
approval authority or inventory execution. Publication requires separate approval.

## Staff workflow

1. Open Compras and choose **Cargar factura con foto**, then **Nueva factura**.
   Choose the supplier, attach a photo/PDF and enter the required invoice fields.
   **Guardar y continuar** saves the invoice; it does not call the reading service.
2. In **Productos**, press **Buscar productos** after reading the external-service
   and possible-cost notice. A fresh successful initial result opens locally
   without a second apply click. An existing saved reading still offers
   **Ver productos encontrados**; opening a screen never starts a paid read.
3. Answer the invoice questions and review each product. **Sí, es este** confirms
   a suggestion; **Es otro producto** permits a different selection, and
   **No está en el inventario** starts the explicit new-product path.
   Confirm VAT and units and enter/review the selling price. The main button
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
- Selecting a suggestion, entering VAT and confirming units remain explicit.
  Batch changes only target unresolved fields after a deliberate action.
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
legacy `leer` value into Productos. Hook, repository and domain contracts stay
unchanged. UI tests and typechecking establish behavior, not rendered pixels,
real camera/keyboard operation or authenticated production correctness.
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
verification. The new interface has not been published.
