# Evaluate historical supplier invoices safely

Use old supplier invoices to measure extraction and product detection before a live pilot. This is an evaluation guide, not proof of general accuracy or a model-training job. The first controlled observation is recorded below; it does not establish pilot readiness.

## First batch

1. Provide complete invoices, with every page, readable product codes and totals. Keep different photos of the same invoice together.
2. Create a local private manifest with an opaque case ID, file SHA-256, page count, supplier/layout group and document quality. Do not commit invoices, private identifiers, signed URLs or answer sheets.
3. Have a person transcribe the expected values from the image and confirm product identities. An unreadable value stays unknown; an old invoice is not proof of a current catalog match.
4. Separate calibration cases from a reserved evaluation set before adjusting prompts or matching rules. Near-duplicates and pages of one invoice cannot cross the split.
5. Run the offline contract, matching and review checks first. Obtain explicit real-document/provider/budget approval before any paid extraction or external upload.

No fixed batch size or accuracy threshold has been approved. A small varied first batch can expose errors; it cannot establish general accuracy.

## Select varied cases

| Group | Include when available |
| --- | --- |
| Layout and capture | Different suppliers, multi-page invoices, PDFs, photos, shadows, rotation and small print |
| Product identity | Literal codes with leading zeros, alphanumeric codes, repeated SKU lines, ambiguous descriptions, old/absent products and barcode collisions |
| Quantities | Units, packs, fractional quantities and explicit conversion factors |
| Financial data | Ordered and already-included discounts, global discounts, mixed/exempt tax, USD and historical non-USD invoices |
| Uncertainty | Cropped or missing pages, unreadable fields and intentionally unsupported cases that must remain blocked |

## Human answer sheet

Keep one answer sheet per opaque case ID. The original document remains immutable. Record who checked the answer sheet and its revision; changes require a reason.

- **Document:** expected page count/completeness; literal supplier, document/control number, date and currency. Non-USD originals stay internal; app monetary display remains USD.
- **Each original line:** source page/position, literal printed code, description, quantity, unit, unit price, ordered discounts, tax rate and printed total. Preserve every repeated line separately.
- **Catalog decision:** confirmed internal product ID or explicitly unresolved/new-product intent, reason and the reference catalog snapshot/version. A missing candidate is not a new-product label. Confirm barcode collisions separately from matching.
- **Review:** necessary correction and motive, expected normalized value and exact decimal calculation; expected blockers for unknown units, rates, financial policies or incomplete pages.
- **Ground-truth status:** confirmed, unreadable or disputed. Do not silently remove difficult cases from the denominator. Report unresolved labels separately from confirmed-value accuracy.

Never use existing Hybrid quantities or amounts as an independent transcription of the original invoice: historical negative-stock compensation may have changed them. Current catalog prices and stock are not historical ground truth.

## Evaluation record

For each run retain the manifest/split revision, extraction provider/model identifier, prompt/schema/parser/matcher/calculation versions, catalog snapshot, input limits, timestamp, latency and observed usage/cost. Record unavailable or failed calls; do not retry into an unapproved budget. Redact document contents and credentials from shared logs and Sentry.

Use the existing [extraction contract](../src/lib/facturaExtractionContract.ts), [matching engine](../src/lib/facturaMatching.ts) and T4 review implementation. Do not build a parallel parser or silently repair failed extraction output for the score. Save raw output separately from the reviewed revision, under the same privacy boundary as the original document.

| Measure | Report |
| --- | --- |
| Literal extraction | Exact-field accuracy on confirmed answers, code accuracy including zeros/case, missing/extra lines, repeated-line preservation and document completeness |
| Product detection | Correct first suggestion, correct candidate within the displayed set, incorrect suggestions, unresolved cases and actual displayed set size; separate code-backed from description-only suggestions |
| Financial review | Exact decimal quantity/unit/discount/tax/total agreement, printed/calculated differences and correct unsupported-policy blocks; no floating-point tolerance invented for scoring |
| Human effort | Corrections per invoice, reasons, explicit association changes and observed review time |
| Safety and cost | False-ready/false-confirmed cases, real calls/tokens/USD cost per invoice, latency, failures and unauthorized mutation count, which must be zero |

Publish numerators and denominators, not percentages alone. Break results down by supplier/layout, quality and split so easy cases cannot hide failures. Distinguish extraction errors, catalog gaps, matching errors, incorrect human labels and policy blocks.

## Calibration is not automatic learning

### First controlled observation

One authorized six-line calibration document completed extraction through the authenticated application without purchase emission or inventory changes. Its printed codes, quantities, unit costs, line totals and document total matched the source. Catalog associations and tax, unit, completeness and receipt decisions remained unresolved; approval and purchase preparation stayed blocked.

The model also supplied a subtotal that was not separately printed. Treat this as an extraction error, not a correct calculated field. The original extraction must remain unchanged; any reviewed correction needs a reason. Prompt and schema descriptions now explicitly require a labeled, printed subtotal and prohibit deriving it from a total or line sums. Valid equal subtotal and total values remain allowed when both are printed.

The clarification has deterministic request-contract tests, not a new real-model accuracy result. No additional provider call, broader corpus score, product-match correctness or fine-tuning result is implied. Preserve private source files and answer sheets outside the repository; provider cost was not observed for this first case.

Use calibration errors to propose bounded prompt/parser/matcher changes with regression tests. Corrections do not automatically update aliases, barcodes, catalog rows, model weights or financial policies. Actual fine-tuning would be a separate decision with provider support, data rights, privacy and budget checks.

Freeze the reserved set while tuning. After a change, compare old and new behavior on the same reserved cases. If reserved answers were used to tune, label the evaluation contaminated and reserve unseen cases before claiming improvement. Do not describe test memorization as measured generalization.

## Safe execution boundary

- No historical purchase re-emission, product creation, stock changes, compensation, sync commands or write-back queues. Extraction/review must not call the purchase path.
- Offline checks use isolated fixtures. Real-document inference, private document storage, live-session testing and any provider transfer each require their applicable authorization. Historical synthetic-call consent is not reusable consent for real invoices.
- Partial/unsupported invoices must stay visibly blocked; human review and unchanged source/version/session requirements still apply. A high score never authorizes purchase emission.
- Preserve originals privately; redact unnecessary personal details in a derived evaluation copy before an authorized upload. Keep a record of which copy was evaluated. Do not promise provider retention controls without verifying the chosen route.
- Stop a run on any unexpected write or access-boundary failure. Preserve the failed case and evidence without exposing its contents; do not continue scoring unsafe execution.

## Next checkpoint

When the first invoices arrive, inventory the files and prepare human answer sheets. Before the first external extraction, confirm the exact provider route, privacy settings and maximum run budget. Model selection and pilot-readiness thresholds remain separate decisions supported by the measured results.

Progress remains tracked in [the active ODD document](../odd/tasks/supplier-invoice-automation.md), T7.1. Full document-to-reviewed-draft acceptance remains T7; this plan does not mark it complete.
