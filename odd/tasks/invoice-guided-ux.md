# Invoice guided UX redesign
Objective: replace the incomprehensible invoice journey while preserving existing business contracts.
Branch: feat/invoice-barcode-completion; delivery: exception-ok coherent work units, no remote publication in this task. Runner: Jest unit/UI + TypeScript.

## Specs
- S1: User request verbatim: "mira ya lo veo y abri una factura pero no entiendo nada, el ui/ux de esa parte es un desastre rehazlo de nuevo haz un plan con opus 5.5 para rehacerlo, y pon varios workers a aplicarlo"
- S2: Preserve the existing supplier-invoice-automation.md S1-S23 contracts: manual/image-optional entry, explicit model calls and identity decisions, manual VAT, editable PVP, barcode as new code and printed code as reference, partial retrieval caution, session/source/camera fences and blocked imported emission.
- S3: Apply Opus's recommended four-stage Operate flow below. Technical diagnostics are disclosed on demand, not removed. Existing brand tokens and Spanish UI remain.
- S4: Test requested navigation and state behavior through public UI interfaces, preserve existing regression assertions. Device/browser visual proof must be labeled unverified until actually inspected.

### Accepted implementation direction
# Invoice UX replacement plan (read-only, HEAD 7d75a7b)

No live preview inspected and no invoice screenshot fixtures exist. All evidence is from source.

## 1. Why a first-time worker cannot finish the current path

1. **The entry promises the opposite of the goal.** The Compras card says "Adjuntar y guardar" (`src/components/ComprasView.tsx:468-470`). The list hint leads with "No registra ninguna compra ni cambia el inventario" (`FacturasProveedorModal.tsx:209-211`). The document card says "No se lee ni se crea ninguna compra: solo se guarda" (`FacturaProveedorEditor.tsx:434-436`). Nothing tells the worker that this screen reads the photo and loads products.
2. **There is no photo capture.** Only the system document picker opens (`src/lib/facturaDocumentoPicker.ts:31-38`). The camera is used only for barcodes.
3. **Reading is buried and gated.** The manual header and line form (8 fields per line, `FacturaProveedorEditor.tsx:451-480`) is always shown, even when a photo is attached. "REVISIÓN ASISTIDA" sits at the very bottom. It is disabled until a server save, then needs "Abrir revisión asistida" (`:482-501`), then "Extraer datos", then "Iniciar revisión con esta extracción" (`FacturaRevisionView.tsx:192-225`). That is 4 hidden steps, and no label says which one is next.
4. **The review is a wall of forms.** Every scalar is a `CampoCorregible` (Original / nuevo valor / Motivo / Aplicar). The header has 7 of them plus 2 list editors (`FacturaRevisionCabecera.tsx:316-380`). Each line has 7 more, plus discounts, factor, PVP, decision and barcode boxes (`FacturaRevisionLinea.tsx:12-20,116-243`). A 10-line invoice renders 100+ inputs before the first decision.
5. **Required decisions are scattered and not marked as required.** The blockers are computed in `src/lib/facturaRevision.ts:885-928`: completeness, reception, VAT inclusion, per-line VAT, per-line factor and association. In the UI, the document type is hidden under "PRECIO DE VENTA SUGERIDO" (`Cabecera:381-390`). The confirmations come last (`:391-394`). The factor has no quick default (`Linea:138-143`). Blockers appear only as a bottom text list with no link to the line (`View:320-323`).
6. **The product decision is unclear.** "Cambiar producto" only resets to pending (`Linea:224`). A real change requires typing an internal SKU plus a motive (`:201-212`). "Nuevo" requires a typed motive (`:213-222`).
7. **The barcode copy contradicts itself.** For a new line, the scan block says the scan goes to Código and the invoice code to Referencia (`FacturaCodigoBarrasNuevo.tsx:99`). The box below always says "Código de barras propuesto: el código impreso, tal cual" with a toggle (`Linea:228-242`).
8. **Technical noise sits in the main path.** The title shows `v3`/"nueva" (`Editor:376`). Raw attempt `estado (errorCodigo)` (`View:197-199`), OCR % and page (`Linea:107-113`), "POS: no verificado", the POS projection and raw `d.campo` differences (`View:305-318`) all show by default.
9. **There is no obvious next action.** The screen stacks Guardar revisión / Aprobar / Preparar borrador with no reason shown when one is disabled (`View:332-350`). It also has two "save" concepts: the footer "Guardar factura" versus "Guardar revisión". The review is nested inside the editor's ScrollView (`Editor:379,488`) with no keyboard avoidance.

## 2. Recommended structure: one guided screen, 4 steps

The modal list stays. Opening an invoice shows: a header (back, "Factura 00123 · Proveedor", status pill), a **stepper**, the step body and a **sticky footer with one primary action**. Gold marks only the primary action, the active step and the selected choice.

```
┌ ‹  Factura 00123 · Ferre X          [Cambios sin guardar] ┐
│ ①Factura ─ ②Leer ─ ③Productos 3/8 ─ ④Compra               │
├────────────────────────────────────────────────────────────┤
│ STEP BODY (ScrollView, keyboard-aware)                     │
├────────────────────────────────────────────────────────────┤
│ [secondary]              [ PRIMARY: next action        ]   │ ← safe-area bottom
└────────────────────────────────────────────────────────────┘
```

**List (modal).** Primary button "Nueva factura". Hint: "Toma una foto de la factura y el sistema busca los productos. También puedes cargarla a mano." Each row has a status chip (Borrador en este dispositivo / Guardada / Revisada / Compra preparada) and supplier · date. Empty state: one sentence plus the same primary button. Loading: skeleton rows. Error: "No se pudo cargar la lista" + Reintentar.

**① Factura**
```
[ 📷 Tomar foto ]  [ Subir foto o PDF ]
(thumbnail · Ver · Reemplazar · Quitar)
Proveedor ____  Nº de factura ____  Fecha ____
▸ Más datos (control, notas)
▸ Cargar renglones a mano (sin foto)   ← existing manual editor, unchanged logic
Footer: [Descartar]  [Guardar y continuar]  (no document: [Guardar factura])
```
Without a document, the manual path ends at save with: "Factura guardada. Registra la compra desde Compras como siempre." When a document exists, the manual lines stay collapsed.

**② Leer** (FacturaRevisionView, `etapa='leer'`)
- No extraction yet: primary "Leer factura". Small print: "Usa un servicio externo y puede tener costo. Solo se hace cuando tú lo pides."
- Extracting: progress text "Leyendo la factura…" (`accessibilityLiveRegion`), button disabled.
- Usable extraction but no content yet: primary "Revisar lo leído" (still an explicit start).
- Failed: "No se pudo leer la factura." + "Intentar de nuevo" (explicit) + "Seguir a mano" (opens step 1 manual).
- Content present: a summary card (Proveedor · Nº · Fecha · Moneda), each with "Corregir" (disclosure → existing CampoCorregible). Then two required questions as segmented choices: "¿Es factura o nota de entrega?" and "¿Los precios incluyen IVA?". Primary: "Continuar a productos".
- "▸ Detalles técnicos": attempts with timestamps, error codes, replace-extraction with motive, printed discounts/tax table.

**③ Productos.** Header "3 de 8 listos", filter chips "Por revisar (5)" / "Listos (3)". Each row shows: "#2 TUBO PVC ½" — 10 × $1.20" + a status chip (icon + text): **Elegir producto · Falta IVA · Faltan unidades · Nuevo: falta código · Listo**. Tapping a row expands it inline (accordion, one open at a time). On tablet/desktop it shows in a right pane instead.
```
¿Qué producto es?
  Sugerido: TUBO PVC 1/2 X 3M   (SKU 4411)  [Confirmar]
  [Cambiar]  → other suggestions + inventory search/SKU, reason chips
  [Es un producto nuevo] → reason chip "No está en el inventario" or text
  ⚠ Catálogo parcial: no encontrarlo no prueba que no exista.
Cantidad 10 · Costo $1.20            ▸ Corregir lectura
IVA:      [0 %] [16 %] [Otro…]        (required, per line, never auto)
Unidades: [1 por 1] [Otro factor…]    (required, explicit)
Precio de venta: [ $1.81 placeholder ] editable
(new only) Código de barras: [Escanear] / escribir · estado de colisión
  "Código = el escaneado. Referencia = 00123 (de la factura)."
▸ Más opciones: descuentos, unidad, total impreso, usar código impreso
  (existing products only), página/lectura OCR, quitar renglón manual
[Listo, siguiente renglón]
```
"Renglón que falta" (a line the reading missed) becomes a secondary button that opens the existing add-line form with its motive.

**④ Compra**
- Checklist: "¿El documento está completo?" Sí/No, "¿Recibiste toda la mercancía?" Sí/No.
- Totals: Base · IVA · Total, or "Total desconocido: hay datos sin resolver".
- Remaining blockers, each with "Ir al renglón 3".
- The primary action follows the state: "Guardar revisión" → "Aprobar revisión" → "Preparar borrador de compra". Mini progress: Guardar · Aprobar · Preparar.
- Done: "Borrador de compra listo en Compras. Puedes editarlo; la emisión sigue bloqueada." + "Ver borrador".
- "▸ Detalles técnicos": POS projection, printed-vs-calculated differences, "POS no verificado".

**Copy rules.** Neutral Spanish using tú ("Revisa", "Guarda"). Never show versions, UUIDs or raw codes in main copy. Diagnostics go only in "Detalles técnicos". Errors say what happened and give one recovery button.

## 3. States and acceptance cases

1. **Empty list.** One sentence + "Nueva factura". No invoice is created until the first save.
2. **Loading.** Skeletons for the list and the review. The editor open failure keeps "Reintentar".
3. **Unavailable service** (`carga='no_disponible'`). Step 2 shows "La lectura automática no está disponible. Puedes cargarla a mano." and manual entry keeps working.
4. **Session mismatch.** Every write is disabled. Message: "La sesión cambió. Inicia sesión con la cuenta de esta factura."
5. **Partial catalog.** A warning appears in each affected line. "Sin candidatos" never sets the line to "Nuevo".
6. **Extracted.** Every line starts as "Elegir producto" or "Confirmar sugerido". Nothing is auto-confirmed.
7. **Unsaved.** The pill shows "Cambios sin guardar". The close guard keeps its current messages. Stepping between steps never unmounts the review: keep it mounted and hidden.
8. **New line.** Requires a reason. The barcode is scanned/typed. The collision states (verificando / colisión SKU / incompleta / sin coincidencias) are shown in text. A camera result from a closed scanner or a stale context is ignored.
9. **Collision.** "Este código ya lo usa 4411. No se asignó ni se creó nada." The line stays not-ready until the barcode is resolved or removed.
10. **Approved, then edited.** The status returns to "Aprobación desactualizada". Preparing is disabled with the visible reason.
11. **Non-USD.** Amounts stay hidden with the existing notice. Step 4 shows the currency blocker.
12. **Imported emission stays blocked.** Copy appears after preparing. `ComprasView` keeps `factura-submit-block`.
13. **Layout.** Phone 360/390: one column, 44 px targets, footer above the keyboard (`KeyboardAvoidingView`/`automaticallyAdjustKeyboardInsets`) and bottom safe area. Tablet/desktop (`useDeviceSize().isDesktop`): the step 3 list and detail sit side by side, with an optional document preview pane.
14. **Accessibility.** Stepper items are buttons with `accessibilityState.selected`. Chips use icon + text, never color alone. Live regions announce reading, saving and errors. No decorative motion: any expand animation respects reduced motion. Theme tokens only.

## 4. Business/security invariants (must stay byte-equivalent in effect)

No change to hooks, repositories, RPCs, Edge functions, SQL, `aplicarEdicion`, the validators or the materializer call:
- Explicit Confirm / Change / New, with motives still sent.
- Manual per-line VAT: the chips issue the same `linea_escalar tasaIva` edit with a motive, e.g. "IVA indicado manualmente: 16 %".
- Explicit factor.
- Editable PVP placeholder.
- Barcode → new code, supplier code → reference (S23).
- Partial retrieval is never proof that a product is new.
- The context/session/generation guards in `FacturaCodigoBarrasNuevo`.
- Extraction is never automatic.
- The imported-emission block stays.
- Reuse: `useFacturaRevision` (every action and flag), `facturaEditorService`/`EditorController`, `resolverPrecioVenta`/`precioVentaValido`, `asociacionDesdeCandidato`, `BarcodeScannerModal`, `PressableScale`, `useTheme`, `scaleFont`, `useDeviceSize`, `notify`/`confirm`, `reanudarBorradorCompra`.

## 5. Implementation units (3 writers in parallel, disjoint surfaces)

**P0, parent, before launch (≈15 lines, one commit).**
- In `FacturaRevisionView.tsx`, export `type EtapaRevision = 'leer' | 'productos' | 'compra'`.
- Add optional `onEtapaChange?: (e: EtapaRevision) => void` and `onSeguirManual?: () => void` props.
- Add a documented layout contract: the root is `flex:1` and owns its own ScrollView + footer.
- No behavior change. Unit 1 builds against it; Unit 2 implements it.

**Unit 1: list + shell + step ① (Sonnet).** Allowed edit surfaces:
```
src/components/FacturasProveedorModal.tsx
src/components/FacturasProveedorModal.ui.test.tsx
src/components/FacturaProveedorEditor.tsx
src/components/FacturaProveedorEditor.ui.test.tsx
src/components/FacturaPasos.tsx
src/components/FacturaPasos.ui.test.tsx
```
- Status-chip list and the step ① form.
- The manual editor collapsed but intact.
- `FacturaPasos` = stepper + status pill.
- The review is mounted full-body after "Guardar y continuar" and kept mounted when switching steps.
- Remove `v{n}`.
- Keep the `factura-abrir-revision` testID on the step-② entry action.

**Unit 2: guided review ②–④ (Sonnet or Opus; largest).** Allowed edit surfaces:
```
src/components/FacturaRevisionView.tsx
src/components/FacturaRevisionCabecera.tsx
src/components/FacturaRevisionLinea.tsx
src/components/FacturaCodigoBarrasNuevo.tsx
src/components/FacturaRevisionPos.tsx
src/components/FacturaRevisionView.ui.test.tsx
src/components/FacturaRevisionGuards.ui.test.tsx
src/components/FacturaRevisionPos.ui.test.tsx
src/lib/facturaRevisionPasos.ts
src/lib/facturaRevisionPasos.test.ts
```
- `facturaRevisionPasos.ts` is pure: per-line status from `calculo.bloqueos` + association/barcode state, the current step, and the next primary action with its disabled reason. Write its RED unit tests first.
- View and line cannot be split: both UI test files exercise view and line behavior together.
- Keep every existing testID that still maps to the same behavior. Add a local `abrirRenglon(n)` test helper. Do not edit the shared harness.
- New testIDs: `revision-accion-principal`, `revision-linea-N-abrir`, `revision-detalles-tecnicos`, `revision-iva-N-16`, `revision-factor-N-uno`.
- Calls `onEtapaChange`. Does not render the stepper.

**Unit 3: in-app invoice photo (Haiku/Sonnet, small).** Allowed edit surfaces:
```
src/components/FacturaCamaraFoto.tsx
src/components/FacturaCamaraFoto.ui.test.tsx
src/lib/facturaDocumentoPicker.ts
```
- An `expo-camera` (installed) capture modal: `{ visible, estaVigente, onClose, onCapturada(PickResult) }`.
- Uses the generation guard pattern from `FacturaCodigoBarrasNuevo`.
- Size limit via `MAX_DOCUMENT_BYTES`; a `readPhotoBytes(uri)` helper beside `readAssetBytes`.
- On web, report unavailable and fall back to the picker.
- No new dependency or permission plugin change; `BarcodeScannerModal` already uses the camera.

**All units.** Handoff names the ODD doc, task IDs and S2–S7, S12, S18–S23. RED first, then the focused suite.

**Parent integration seam (after all three).**
1. Wire `FacturaCamaraFoto` into step ① "Tomar foto". The editor is Unit 1's file: the parent edits it after Unit 1 is accepted.
2. Change the ComprasView card copy at `:469` to "Foto o carga manual" (parent-owned, shared file) and adjust `ComprasView.facturas.ui.test.tsx` if needed.
3. Update `docs/SUPPLIER-INVOICE-REVIEW.md`.
4. `src/test-utils/facturaUiHarness.tsx` stays parent-owned and frozen.
5. Run the checks:
```
npm test -- src/lib/facturaRevisionPasos.test.ts
npm run test:ui -- src/components/Factura src/components/ComprasView.facturas
npm test
npm run test:ui
npm run typecheck
```
6. Then one independent verifier (Risk item 3: shared review UI around the S21/S23 decisions; item 6: native camera/keyboard not covered by tests).
7. Device proof at 360/390/tablet/desktop stays pending until a human runs the Preview build.

## 6. Risks

- **Test churn.** The 3,000+ lines of review UI tests use testIDs inside lines, so collapsed rows need preserved testIDs or an expand helper. Never weaken an assertion.
- **Unmount loss.** Hiding the review by unmounting drops unsaved edits and `onDirtyChange`. It must stay mounted.
- **VAT/factor quick chips** must produce edits identical in shape to the manual path. Pin this with a payload-equality test.
- **"Cambiar" search.** `ProductoPickerModal` is private in `ComprasView.tsx:991`. v1 uses the candidate list + SKU entry. Exporting the picker is a later parent-owned change.
- **Camera on device** is unverifiable in Jest. Mark it as needing native proof.
- **No product decision blocks this plan.** Bulk "same VAT for all lines" is intentionally omitted to keep T7.12's per-line authority.

## skill_resolution
`paths-injected`, loaded before work (14:04–14:05): ponytail, caveman, impeccable SKILL + operate.md (full), new-work.md sections 1–3 only (rest not needed for an established-world planning task), building-native-ui, react-native-best-practices, code-simplifier (full). `craft-floor.md` was not loaded (planning only, per the skill). I did not rerun the impeccable context script (the coordinator already ran it).

## Key Learnings
1. The invoice review UI tests exercise view-level and line-level behavior in the same files, so `FacturaRevisionView` and `FacturaRevisionLinea` cannot be given to separate parallel writers.
2. `ProductoPickerModal` is a private function inside `src/components/ComprasView.tsx`, so reusing it for invoice "Cambiar" requires a parent-owned export change.
3. Invoice photo capture currently uses only `expo-document-picker`, while the installed `expo-camera` is used solely by the barcode scanner.
4. Per-line VAT, per-line conversion factor and association are all hard blockers in `src/lib/facturaRevision.ts:926-928`, with no defaults, so the UI must surface them as required per-line choices.


- S5: User correction verbatim (2026-11-23): "arreglalo todo". Authorized scope: fix the invoice usability problems observed in the real Chrome E2E report (Temp/serrucho-e2e/report.md), while preserving S2 and all purchasing/security boundaries. Source zoom must enable comparison rather than claiming OCR accuracy; contradictory manual/extracted fields need provenance and explicit empty-field adoption; pending reasons must stay with the correct line; repeated manual VAT/factor decisions may be applied explicitly to unresolved lines only; product suggestions need readable descriptions and truthful evidence. No automatic tax, product identity, persisted overwrite or invented matching confidence.
- S6: Source-proven related fixes: stage scroll must reset, product panes must not nest a height-limited list inside a page scroll; quantity/cost must be visible in selected detail (currency guards retained); partial catalog warnings need truthful manual-recovery guidance; realtime local notifications must not request browser permission without a user gesture. These fixes do not authorize database/API/writeback or browser-settings changes.

### Post-E2E corrective direction (Opus plan, 2026-11-23)
Evidence: user-approved live Chrome audit and actual screenshots02/08/11, source baseline83d75f2. Full read-only routing report retained externally as invoice-e2e-fix-plan.md; this section is the durable actionable plan.

E1 owns editor+NEW FacturaDocumentoVisor and their UI tests. Fullscreen image preview with1x-4x zoom, fit and pan, safe signed PDF opener, new URL per open/retry, URL/path/SHA/session/open-generation fences. Thumbnail stays tappable with an enlargement hint. Review can request same viewer. Header callback values are labeled read from photo, never silently stored. Explicit Completar campos vacíos con lo leído fills only empty draft fields through existing controller.edit after confirmation warning that saving changes invoice version/review approval. No overwriting typed values, automatic save or approval. Title can use read number with leída suffix; distinguish factura vs revisión dirty state and pin saved-clean behavior.

E2 owns View/Cabecera/useFacturaRevision/helper plus own UI/helper tests. Group document blockers separately and per-line reasons with exact matching action. Reset stage scroll; phone scrolls to selected line; expanded Productos gives list/detail independent full-height scrolling outside root stage scroll. Implement atomic editarVarios by folding SAME aplicarEdicion/newId/guards as editar and issuing ONE state patch, all-or-nothing, not N stale editar calls. Bulk panel explicitly chooses VAT0/16/custom or factor1, targets ONLY corresponding current unresolved blockers, never changes explicit zero/overrides, no OCR/default tax or bulk product association. Domain rejects invalid custom values without partial change. Payloads equal manual path. onCabeceraLeida emits effective source-bound header/null; onVerDocumento allows viewer from Leer/Productos. Clear partial-catalog explanation and existing manual SKU actions, no promise of complete coverage.

E3 owns Linea/NEW Linea UI tests and matcher CHARACTERIZATION test only. Source quantities/cost visible with non-USD guard; candidate cards description-first, code secondary, explicit Confirmar. Truthful chips from existing evidence; recommended only top suggested, no confidence percentage or automatic assignment. Printed-code mismatch copy must say no code-matching candidate, not prove product absent, especially when catalog partial. Characterize audit battery/charger ranking with realistic rows/ranks before alleging a matcher defect; NO matcher production edit unless separately evidenced and routed. Required props unchanged, optional additions only.

Parent N1 owns notifications.ts/test and integration/docs. showLocalNotification never calls requestPermission; only emits browser notification when granted. Explicit requestNotificationPermission path remains unchanged, native behavior preserved. Initial source mapping proved realtime invokes the prior unsolicited permission request; cause of the observed browser chip itself remains unknown. No changing browser permissions.

P0 shared optional prop contract before workers:
export interface CabeceraLeida { proveedorNombre: string|null; numeroDocumento: string|null; fechaEmision: string|null }
onCabeceraLeida?: (cabecera: CabeceraLeida|null)=>void; onVerDocumento?: ()=>void.
E2 emits, E1 consumes. Parent owns Git and shared harness, workers have disjoint surfaces. Workers must use fresh context/current callbacks to fence document/session changes; do not trust optional header values beyond current invoice/source. Header adoption is explicit local draft editing only.

Checks: each behavior gets public-interface RED/GREEN and preserved existing operations; direct Node Jest flags on Windows. E1 viewer/editor UI; E2 helper/View/Guards/Pos UI/types; E3 matcher+Linea and existing View/Guards. N1 notifications unit RED/GREEN. Then one isolated integrated independent verifier (named Risk items3 shared edit/notification contracts and4 URL/session/batch ordering) and one actual visual rerun, no extra provider inference or inventory effects. Native/phone camera proof is not inferred from Jest. No user-facing completion until skipped/pending checks disclosed.

## Tasks
- P0 [S1-S3] inline; optional stage contract integrated into acef80d; no runtime-only-interface RED applicable; later behavior tests verify stage control.
- U1 [S1-S4] delegated parallel writer; source implemented, 54 owned UI tests/typecheck passed; editor/list/stepper included in 417e140; real visual acceptance pending.
- U2 [S1-S4] delegated parallel writer; implemented acef80d with single-action correction and C1 B1/B2 fixes; 40 helper/210 writer UI/typecheck passed; independent targeted recheck passed. Risk: items 3/4.
- U3 [S1-S4] delegated parallel writer; implemented fa6ed61, 21 camera UI/8 picker tests; source camera adapter integrated by parent, fake hardware only. Risk: items 3/4/6.
- I1 [S1-S4] inline parent camera/editor/Compras/docs seam implemented; 85 combined UI tests passed; 417e140. Preview and device acceptance pending. Risk: items 3/4.
- V1 [S1-S4] delegated independent verification complete at code/layout-tree scope; initial full 1317 unit/320 UI/418 SQL/types passed; corrected targeted 40 helper/298 UI including9 external probes/types passed. B1/B2 resolved. Actual pixels/keyboard/camera UNVERIFIED.


- E1 [S5-S6] delegated parallel writer; source implemented in 43e4449, visor/editor 97 UI/typecheck and independent seam proof; real visual acceptance pending. Risk: items 3/4.
- E2 [S5-S6] delegated parallel writer; implemented in 959586c including atomic manual batches, grouped blockers, source-bound header emitter; 47 helper/227 UI/types, independent bulk preservation and C2 provenance recheck passed. Risk: items 3/4.
- E3 [S5-S6] delegated parallel writer; implemented in daaaadf, 18 standalone UI/83 matcher/186 ViewGuards; ranking unchanged after characterization. Risk: item 3.
- N1 [S6] inline parent; implemented a269275, notification 10 unit tests +11 baseline differential cases (10 identical,1 authorized change), integration docs recorded. Risk: item 3.
- V2 [S1-S6] independent code/layout-tree verification passed after one C2 correction: initial full1344unit/421UI/418SQL/types0; B1 recheck9 public probes/224 focused UI/types0. All observed code blockers resolved; actual visual/native/keyboard acceptance remains pending.

## Log
- L1 2026-11-21 user request: "mira ya lo veo y abri una factura pero no entiendo nada, el ui/ux de esa parte es un desastre rehazlo de nuevo haz un plan con opus 5.5 para rehacerlo, y pon varios workers a aplicarlo"
- L2 Opus5.5 high task_2a9fa3fedf89/ctx_369d9d032d39 returned read-only plan; no live visual inspection. Parent spot-checked View props and picker source/package scripts. Original main checkout untouched.
- L3 Parallel trigger: three independently testable units with disjoint edit surfaces; shared editor photo wiring belongs to parent after completion. No workers own Git, installs, shared harness, backend, SQL or deployed data.
- L4 P0 optional type-only prop edit accidentally preceded this tracking file creation; recorded rather than claiming ordering compliance. No runtime implementation was changed. Subsequent source writes require this tracked plan.
- L5 Controlled contract amendment: etapa?: 'leer'|'productos'|'compra', onEtapaChange?: (etapa)=>void, onSeguirManual?:()=>void. Shell owns selected etapa, review keeps internal fallback if absent and remains mounted across step navigation. Review root owns scroll+footer; outer editor must not nest its review inside another ScrollView.
- L6 Camera contract: visible:boolean; estaVigente:()=>boolean; onClose:()=>void; onCapturada:(resultado:PickResult)=>void; onNoDisponible?:()=>void. Native camera photo only on explicit button; web falls back to existing picker; never auto upload or inference. Parent owns wiring.
- L7 Forecast 1500-2500 authored lines including necessary regression tests; heuristic is not a cap. No push/PR/merge/APK/production operation in current scope; coherent source+tests work units rather than size-only splitting. Existing app review clone-off remains unchanged.
- L8 Three Sonnet5.5 high writers READY via Orca: U1 task_a13f2ee33bc6/ctx_7d1f57d342bc; U2 task_51cbdbaca37c/ctx_a4ac1be356b0; U3 task_ba7f2bd3684a/ctx_19ca70fd54d5. Await events, no polling. Parent will not edit their surfaces until each settles.

- L9 U3 task_ba7f2bd3684a/ctx_19ca70fd54d5 returned source component+adapter and tests (4 allowed files), parent read source and diff. Focused proof: camera UI21/21, picker8/8 after reported RED; stale-guard mutant caught7 tests. Typecheck exit2 due U1 not-yet-created FacturaPasos module, so whole-unit acceptance remains pending integrated typecheck; do not call all checks passed. Camera hardware/visual proof and pre-read size unavailable; post-read10MB enforced. U1/U2 still active; parent will wire after their settled deliveries, no edits in their surfaces now.

- L10 U1 task_a13f2ee33bc6/ctx_7d1f57d342bc returned six allowed files, reported54/54 ownedUI and typecheck exit0 (clears prior missing-stepper type error at that moment). Parent inspected editor stages/mounting/attachment code. List status deliberately only Borrador/Guardada because no trustworthy review status in list data.
- L11 Parent I1 camera wiring implemented after U1/U3 settled: explicit button, owner/session/open-generation gate, close/unmount invalidation, shared existing attachment helper and file-picker fallback. Four new public editor tests meaningful RED (missing camera entry), then GREEN4/4; new Compras card-copy test RED then updated copy. Combined5 UI suites85/85 exit0, Temp/invoice-ux-shell-camera-green.log. A NativeModule test import failure in list suite required a narrow camera component mock (camera behavior covered separately); no shared harness changes. Existing asynchronous act warnings remain visible. No upload/inference/live data was used, only fake backend.
- L12 U2 still active; integrated full checks/independent verification/Git units/device visuals remain pending. No app publication or backend change. Risk: item3 shared attachment path and item4 callback order; independently verify after frozen integrated candidate, not active partial source.

- L13 U2 task_51cbdbaca37c/ctx_a4ac1be356b0 returned nine allowed source/test files and reported33unit/192UI/types0. Parent spot-check confirmed status helper/stage props and worker acknowledged duplicate body+footer Guardar/Aprobar/Preparar controls, contrary to S3 single current primary. Required acceptance is NOT complete despite own green tests.
- L14 Parent issued ONE bounded U2 correction task_a6edfd360e20/ctx_6780733a56dd READY: remove duplicate body primary actions, preserve guards/secondary controls, assert exactly one current accessible action for read/save/approve/prepare with meaningful RED, rerun same focused suites/types. No getAllByRole assertion weakening. Await delivered event then freeze and independently verify named Risks3/4/6. Missing-PVP materialization gate is reported pre-existing, not silently changed by UX redesign.

- L15 U2 correction task_a6edfd360e20/ctx_6780733a56dd passed34unit/197UI/type0 after meaningfulRED duplicate-action cases. Parent finalized source docs, gitdiffcheck0. Native assess HIGH nameditem4 with explicit intended8untrackedfiles; RDDcloneOFFunchanged, no lifecycle/receipt. Frozen23-file manifest external Temp/invoice-guided-ux-candidate-20261121.json, baseline7d75a7b.
- L16 Independent V1 task_246b17ac5e0d/ctx_cdfadcc2f973 verified23/23hashes before/after, unchangedHEAD/status. Fullchecks1317unit/320UI/418SQL/typecheck allEXIT0;13publiccross-tree payload/guard preservation probes and realEditor+Review stage-state proof. S2/S4PASS;S1/S3PARTIAL due B1 collision-labeled-Listo and B2missing tablet/desktop two-pane. Visual/device/keyboard/camera unavailable. Source report Temp/guided-ux-verify-1795268965/logs/VERIFY-REPORT.md. Existing approved-PVP materialization weakness remains baseline advisory, do not expand scope.
- L17 C1 correction [S3 cases9/13] delegates ONE batch for ALL V1 blockers in U2-owned source/tests: lift bounded contextual collision-verification presentation status into line readiness without domain/approval semantics change; implement real responsive product list/detail panels and phone single column via existing size hook. Add regressions derived from P9 and layout cases; then targeted V1 recheck only B1/B2, no new sweep. U1/U3 and all unrelated business behavior stay unchanged. Final sourcefreeze must be regenerated after C1.

- L18 Targeted same-verifier recheck task_29eeedf8cefe/ctx_e81836abd82e resolved B1/B2 on corrected23hash-frozen source;40helper/298focusedUI(includes9externalprobes)/types allEXIT0. Actual useDeviceSize with360390/768820/1280 confirmed layout/scanner uniqueness; stale source/code/session answers never revive readiness. Parent read RECHECK-REPORT.md and already reran40helper0. Advisories: samecode-clear-recapture cache reuse; a read can be sent under mismatched session but answer dropped. No new sweep/corrections for advisories. Scratch retained atTemp/guided-ux-verify-1795268965 with4junctions, no unsafe cleanup attempted.
- L19 Coherent commits locally: fa6ed61 camera+adapter+tests (681 authored lines); acef80d guided-review+responsive/collision fixes+tests (3194 authored lines, indivisible view/line regression behavior). Kept readable full tests instead of artificial size-only splits; exception-ok strategy recorded. Parent shell/camera-wiring/list/entry/docs task commit follows. Review cloneOFF peruser unchanged, disabled/unmanaged; native assessHIGH nameditem4 and independent functional proof, NO native approval. Source code allmatches frozen corrected candidate; only passive docs updated after check. No remote push/deploy/newmodel/inventory/businessPCcall. Release/version/APK pending actual UX acceptance and separate remote authorization.

- L20 Final shell integration commit417e140a3dd2f56a19cfa2b7f3bcc812ff67565d observed successful; only preexisting untracked.codex/ andAGENTS.md remain. No remote push yet. Docs-only closure records exact code commits fa6ed61/acef80d/417e140. Next requires authorization to push this updated branch toGitHub with currentCLIsession for automaticPreview; not mastermerge/release/businessPCoperation. Actual visual proof remains pending, source verification is not whole-surface visual approval.

- L21 User2026-11-23 exactauthorization: arreglalo todo. LiveE2Efindings reused11lineextraction, not newproviderproof; sourceviewerunreadable,manualheaderblankvsreadvalues,33repeateddecisions,blockergrouping/nestedscroll/candidateprovenance/partialwarning. Originalpreviewpublication83d75f2confirmed successful7971052352, no mastermerge/inventorytouch. This correction task authorizes source fixes, not new remote publication or businessPC/model operations.
- L22 Opus mapper task_7b8d9782d280/ctx_3a0c388dc627 read actualreport/images/source and returned implementablerouting. Parent spotcheck confirmed fixed220px image and currenthookcontext; mapping proves editar consecutive calls loseearlieredits and unsolicitedwebnotificationrequestsource. Paralleltrigger3independent unitsE1/E2/E3withdisjointsource+tests; parentN1notificationsdisjoint. Planningforecast~1500-2500additionalauthoredlines, coherentunitsnotartificialcap. Exception-oklocalworkunitsstrategyretained;no push untilseparateauthorization.

- L23 ThreeparallelcorrectivewritersREADY: E1Sonnet5.5high task_c0ff873499bd/ctx_ddc1b49609fb, E2Opus5.5high task_cbbd84ab7082/ctx_e13dbe4f4686, E3Sonnet5.5medium task_01f14fdac148/ctx_619c0f5f86ed. SharedP0optionalCabeceraLeida/onCabeceraLeida/onVerDocumentotypecontractaddedaftertrackingbeforelaunch; runtimeimplementationbelongsE2. Parentownsnotifications/docs/Git/harness, no conflicts.
- L24 ParentN1 removedunsolicitednotificationpermissionbranch only, preservinggrantedpayload/options/errorhandling/nativeandexplicitrequesthelper. RED1failed9passed, GREEN10/10exit0; exactlogsTemp/invoice-notification-red-20261123.log and-green. Externalrealmodulebaseline83d75f2differential11casesPASS(10identical,1authorizeddefault-permissionno-promptdifference), Temp/serrucho-notification-diff-4MAQud/results.json. Riskitem3, finalindependentproofpending. No browserpermissions/source-irrelevantfiles/remotechanges.

- L25 E3task_01f14fdac148/ctx_619c0f5f86ed delivered3allowedsurfaces. UIRED13failed5guardpassed thenGREEN18/18; matchercharacterization83/83 andrealViewGuards186/186exit0, no productionmatcherchange. Lexicalbatteryfirst0.49,chargerfollow; hybridranksretainorder/statusreview/emptyevidenceretrievalonly, notcontractdefect. Parentcard/source spotcheckconfirmsdescription-first,evidencechips,no-calibratedpercentage,top-suggestedonly,nocodeabsencenoteboundedtocandidates,nonUSDguard. TypecheckforeignE1visoruitestline224TS7022/7024whileE1active; finaltypeacceptancepending. No editoutsideownership, otherwritersstillactive, no workerpolling.

- L26 E1task_c0ff873499bd/ctx_ddc1b49609fb delivered4allowedsurfaces: fullscreenvisor1x4xfitpan/newURLperopenretry/safePDF/source-sessionopenfences; editorVerthumbnailreviewcallwire;read-vs-manualprovenanceandconfirmedempty-onlyadoption;readtitleandseparateddirtysources. WriterREDmissingvisormodule+25editorcases, GREEN97/97UIandtypesEXIT0;5guardmutationsdiscriminatedthenrestored. Parentreadviewerload/URLfencesandexistingeditorcallback/adoption/wiringselectors. InitialforeignE1TSerrorseenbyE3nowclearedinE1typecheck; integratedproofpendingE2. E1editorsuitestubsViewsoactualheaderemit/viewercallbackseamrequiresindependentrealEditor+Viewtest. Native/phoneactualpixelsnotproven. OtherwriterE2stillactive,no parentoverlap.

- L27 E2task_cbbd84ab7082/ctx_e13dbe4f4686 delivered7allowedsurfaces (View/Cabecera/hook/helpers/tests). RED7helper,4hook,12Viewfailures observed; GREEN47helper,4atomicHook,13Viewfocus;fullViewGuardsPos227/227/typecheckEXIT0,eslint0errorswithpreexistingstylewarnings. ParentspotcheckeditarVariosfoldsSAMEaplicarEdicion/newIdoncepatchandrollback-on-invalid;sourcecallback+vieweractionswiredtoE1;atomicbatchonlyunresolvedlineIDsfromcurrentblockers. No foreignfailures, allwriterssettled. Parentupdatedpassiveuserdocumentation, no sourcewiringeditneeded.
- L28 Source correctionunits selfchecked, readyforfreezeandONEindependentV2 Risk3sharededit/globalnotification andRisk4URL/session/batchstaleguards. Fullunit/UI/SQL/types plusrealEditor+Review+Visorseam andsmallbaselinepreservationprobes. ActualChromevisualrerunpendingupdatedbuild; no implicitnewpush/deploy/inferenceauthorization. Allsourcebeyondoriginal83d75f2stilllocaluncommitted, personalAGENTS/.codexpreserved.

- L29 V2task_f59997aebfe5/ctx_5c28a9d82e95 independentlyverified18/18frozenhashes before/after, unchangedHEAD/status, full1344unit/421UI/418SQL/typesEXIT0. RealEditor+View+hook+visor/bulk/group/layout/candidate/currency/notification publicprobes PASS except B1sourceprovenance. S1-S4preservationPASS,S6PASS,S5PARTIAL. ReportTemp/serrucho-verify-JRReSY/logs/VERIFY-REPORT.md. Oldextractedheadercanreappear/beadopted afterphotoSHAreplacement+save orQuitar becauseViewemitswithoutSHAmatchandEditorbindsreceiptcurrentSHA. Actualpixels/nativepan/keyboardstillpending;httpURLandsession-displayadvisories notnewscope.
- L30 ONE correctionbatchC2 for B1[S5,Risk4]: bind emitted/adoptableheader to authoritative extraction sourceSHA/currentdocumentSHA; emitnull for removed/mismatchedsource, preserveexistingmanualtypeddata/actions. RealEditor+View regression forreplace+save,Quitarandpendingadoptiondialog isrequired. Then SAMEV2verifier rechecks ONLYB1withcorrectedmanifest, no newfullsweep. Unrelatedbaselineoldsummarybehavior isadvisorynotautomaticrewrites. ParentkeepsoriginalG:checkoutpersonalworkuntouched.

- L31 C2task_1efa5b925cbe/ctx_eeccbc09d19d minimalfixViewSHAemitter+Viewtest+newrealProvenanceUITest afterRED3cases thenGREEN282UI/types0. ParentreadexactsourceguardandranrealProvenance4/4exit0,diffcheck0. Corrected19fileSHAmanifestTemp/invoice-e2e-corrections-provenance-fixed-20261123.json.
- L32 SAMEV2verifier task_25d23e7299c8/ctx_5877e2a09dd5 independentlyresolvedB1:19/19sourceoverlayhashesinvariantandHEAD/statusunchanged;9/9publicprobespasscorrectedvs3failpriorcandidate,224focusedUI/typesEXIT0. Replaced/removedsource+reload andpendingdialogreplace/remove neveradoptoldvalues, matching-sourceadoptionworks, manualfieldsunchanged, no extraer/revisionwritecalls. Fullunit/SQLNOTrepeatedperboundedrecheck. ReportTemp/serrucho-verify-JRReSY/logs/RECHECK-B1-REPORT.md;actualpixels/nativeproofpending. No nativeapproval,RDDcloneOFFunchanged.
- L33 Localcoherentworkunitcommits:959586c atomicreview/group/scroll/headerfence889authoredlines;43e4449 documentviewer/editor/seamtests1355lines;daaaadf candidateclarity/characterization401lines;a269275 notifications108lines. Keptsourceandteststogetherwithreadability, no artificialsplit/compression; exception-okstrategyretained. Parentpassiveproofdoccommitfollows. No push/mastermerge/preview/inventory/provider/businessPCactions inthiscorrectiontask; nextrequiresupdatedGitHubpreviewpublicationauthorizationandsameChromevisualrerun. Version/APKreleaseawaitactualUXacceptance, no implicitreleaseclaim.

- L34 CorrectedPreviewa060b3a publishedwithuserexplicit subelo, GitHubdeployment7999155713PreviewproductionfalseSUCCESS at https://el-serrucho-l0jt7q69i-gustavo-reyes-projects-9e8abbe3.vercel.app . RealChromeoperator task_e371b988fecc/ctx_272b9eda854f reusedsavedextractionafterusermanualneworiginlogin:zoom300350%legible,header4/4qty11/11cost11/11linearithmetictotal821.70matchpaper,codes10/11exact, line10VT-2123vspossiblyVT-2122digitblurryUNRESOLVED(no guessing), zero confirmedmismatches. Parentreadreportandactualzoom/Compracaptures. No provider/save/businesswrites;oldunsavedtabpreserved.
- L35 Boundedmissing-evidence followup task_de62e97a9029/ctx_772b9885cc72 confirmedheaderread-vs-writtennotes/adoptbuttonAFTERreviewstarted;warningdialogexplicitversion/approval,Cancelpreservedfields. GUI-onlyChromeDeviceToolbar390x844/360x800 renderedvalidmobileFactura+viewer, noJS/network/storage/reload;desktoprestored. Minorphonefindings:providerhiddenbyheadingellipsis, attachmentcontrols34pxbelow44minimum;nativeconfirmationdialogcosmeticnotbusinessbug. PhoneProductos/Compra/touch/nativecameraunverified. Parentinlinefinalsmallvisualbatch fixes visiblecompactprovidersubtitleandmin44attachmentcontrols only withRED/GREEN; no new businesslogic/authority/lookup/rankingchanges. Risk:none, localpresentationonly; finalvisualconfirmationlimitedtothesetwoitems.

- L36 Finalsmallinlinecompactfix observedRED2fail1desktop-preserved, GREEN3focused;fullrelatedEditor/Provenance/Visor/List4UI114/114/typecheckEXIT0;diffcheck0. ExistinguseDeviceSize splitscompacttitle/providersubtitle, desktopfullheadingunchanged;secondarytouchactionsmin44only. No business/lookup/authoritylogicchange,Risk:none. Source/tests/logcoherentlocalcommitfollows; no newpublicationyet. Pixelproofstillbelongsdeployedpriora060b3a;finalcosmeticpatchnotyetbrowserconfirmed. AllChromeoperatorssettled, userfields/oldtabpreserved, Code10oneblurreddigitrequirespapercheck, phoneProductos/Compra/nativecamera remainunverified.
