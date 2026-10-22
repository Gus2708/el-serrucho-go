# Diagnose purchase compensation in Hybrid using historical evidence

Copy this task to the agent on the PC running Hybrid. This is a read-only investigation, not authorization to issue a purchase or adjust inventory.

## Goal

Determine the financial result of an existing completed purchase that compensated negative stock. The confirmed stock rule is: prior stock -3, invoice/received quantity 10, quantity sent to Hybrid 13, expected final stock 10. Invoice quantity remains 10.

The local automation types the sent quantity and unit cost, then verifies stock/cost/PVP. It does not verify the resulting financial header. Do not assume that a correct final stock proves a correct invoice amount.

## Allowed work and limits

- Inspect existing source, logs, table schemas, and completed documents in query mode only. Read only the records needed for the selected case, using a consistent read supported by the local database tools.
- Do not create, edit, totalize, cancel, or delete documents. Do not change stock, costs, prices, configuration, or running services.
- Do not run listeners, enqueuers, `sync_ajustes.py`, `registrar_compra`, or E2E/preview purchase diagnostics. A script described as a preview is not evidence that it has no side effects.
- Do not expose credentials, environment values, names, RIFs, customer details, or complete private documents. Use anonymized identifiers in the report.
- If the evidence cannot be obtained safely, report the missing data and stop. Do not substitute a production experiment.

## Investigation

1. Identify one completed purchase from GO with evidence of negative prior stock. Read its existing logs and purchase metadata. Compare the original commercial invoice quantity with the quantity sent, if the original is available. Mark the original quantity unknown when it is not available; do not infer it from final stock.
2. Inspect the actual schemas and relevant records of `TTransaccioncom.dat` and `TDetalleCom.Dat`. The known link is `TBT_OPERACION_AUTOINCREMENT` in the detail to `THT_AUTOINCREMENT` in the header. Known detail fields include `TBT_CODIGO`, `TBT_CANTIDAD`, `TBT_EXISTANTERIOR`, and `TBT_EXISTACTUAL`. Discover cost, line amounts, taxes, totals, currency/rate, discounts/charges, and document/control fields from the real schema rather than inventing names.
3. Read an already existing inventory adjustment, if available. Establish its separate document type, quantities, cost/valuation fields, and tax fields. Its existence does not authorize chaining an adjustment to a purchase or prove that doing so preserves valuation.

## Required report

Return one short table per selected purchase with:

| Evidence | Required value |
|---|---|
| Identity | Anonymized document and line identifiers; source of each observation. |
| Quantities | Commercial invoice quantity or unknown; quantity sent by GO; quantity registered by Hybrid; stock before/after. |
| Line amounts | Original invoice unit cost/amount if available; registered unit cost, retained decimal precision, subtotal, and taxes. |
| Header amounts | Net, tax, total, currency/rate, discounts/charges, and whether document and control remain distinct. |
| Inventory adjustment | Observed quantity, valuation, document type, and cost-master behavior, or unavailable. |

Explain which observed amounts correspond to the sent quantity versus the commercial quantity. Distinguish proven results from assumptions. For an illustrative invoice of 10 units at USD 2 with a compensation of 3, determine from actual records whether the registered purchase reflects USD 20, USD 26, or another demonstrated calculation; do not create that example in production.

Conclude whether compensation changes the registered purchase amount, what happens to the product's master cost, and which representation could preserve the real supplier amount. If a proposed representation is not demonstrated, label it unverified. Report only what the available records establish.

## Return here

Paste the anonymized report into the coordinating conversation. That evidence will determine the purchase-import mapping; it does not change the confirmed negative-stock rule.
