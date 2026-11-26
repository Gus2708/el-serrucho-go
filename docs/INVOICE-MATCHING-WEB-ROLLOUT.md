# Invoice matching web rollout

Version **1.2.9** is locally verified for web publication with the integrated
purchase updates from master. This is a readiness record, not a claim that
production deployment or product identification is perfect.

## Observed publication (2026-11-26)

The integrated source was pushed to master at
`aad332add7c2f9cccce2a1e0a06e54204150435d` without force.
[CI run 45845185326](https://github.com/Gus2708/el-serrucho-go/actions/runs/45845185326)
passed typecheck, unit, UI and SQL checks for that exact SHA. Vercel's commit
status and GitHub deployment `8088910659` also succeeded for the same SHA.

Deployment metadata labels its environment Production but sets
`production_environment=false`; this is not proof of canonical production routing.
The returned deployment URL redirects unauthenticated requests to Vercel
Authentication. No protected page was opened and no login or order request was
made after that wall. Authenticated runtime remains unverified.

This section records the delivered source snapshot. Any later documentation-only
closeout does not change the source verification boundary above.

## Delivery boundary

- Publish web source to `master`; preserve the existing master ancestry.
- Do not build Android/APK, invoke EAS, or publish a binary release.
- Do not apply SQL migrations or change catalog, inventory, purchases or grants.
- Invoice-linked drafts remain editable but cannot be emitted through this rollout.
- Keep explicit Confirm / Change / New, manual VAT and selling-price decisions.

## What is included

| Area | Work-unit commit |
| --- | --- |
| Identifier and variant safeguards | `d137d5a` |
| Bounded description retrieval | `e9fd713` |
| Local supplier-alias SQL contract | `83cc26f` |
| Local search-RPC security migration | `d29f35d` |
| Source-bound alias client integration | `e6181ed` |
| Honest candidate-evidence presentation | `af6a91a` |
| Provenance-aware matching evaluator | `ddb1365` |
| Malformed catalog replies stay incomplete | `8840153` |
| Consistent version and lockfile bumping | `370260a` |
| Master purchase/history/tooling integration | `22cc177` |
| Behavior-preserving scanner/test lint cleanup | `a7cb473` |

The merge preserves master `7454908` and feature `370260a`.
It retains purchase discounts, stock-adjustment items and order-history changes.

## Observed local evidence

| Source boundary | Checks | Observed result |
| --- | --- | --- |
| `22cc177` | Full unit / UI / SQL / types | 1481 / 439 / 443 tests; all exit 0 |
| Nine earlier work-unit snapshots | Focused checks | 807 tests; all exit 0 |
| `22cc177` | Real draft resume and imported-emission guard | Quantity/cost/PVP preserved; zero transport writes |
| `a7cb473` | Canonical lint / types / targeted UI / barcode | 0 lint errors, 3090 warnings; 102 UI and 9 barcode tests pass |
| `a7cb473` | Baseline/corrected public barcode differential | 263203 cleaning and 1059 variant cases; zero differences |
| `a7cb473` | Static web export and public-asset copy | Both exit 0; 27 HTML routes, six JS bundles and one CSS bundle |

The earlier C: scratch export could not resolve a G: dependency junction. One
same-drive scratch export resolved this without changing app/Metro configuration,
installing dependencies or bypassing static rendering. The original failed
verification remains historical evidence; it was not relabelled successful.

The static artifact used nonproduction public placeholders. Its build proof does
not establish authenticated behavior. The cooperative Node network guard passed
13 deny checks; it was not an OS sandbox. Expo emitted notifications/no-effect and
forceful-exit-after-export warnings despite a completed artifact and exit 0.

## Hosted compatibility and deferred SQL

A separately authorized metadata-only check on 2026-11-26 confirmed:

| Column | Observed type / nullability / default |
| --- | --- |
| `compras_app_items.es_ajuste` | boolean, NOT NULL, false |
| `compras_app_items.costo_lista` | numeric, nullable, no default |
| `compras_app_items.descuentos` | jsonb, NOT NULL, [] |
| `compras_app_items.excluir_descuento_general` | boolean, NOT NULL, false |
| `compras_app.descuentos_generales` | jsonb, NOT NULL, [] |

This confirms column compatibility, not migration-history, constraint or live
purchase correctness.

These **local** migrations have not been applied by this rollout:

- `20261126033350_buscar_productos_search_path.sql`
- `20261126033420_factura_matching_supplier_aliases.sql`

The client accepts the legacy feedback response without the optional aliases key.
Consequently the web can run without the new supplier-alias feature. Do not claim
that cross-description alias learning or search-RPC hardening is live merely
because the client is deployed. Applying either migration needs separate explicit
authorization; search hardening also needs live RLS/extension and caller checks.

## Publication checklist

1. Confirm current master is still an ancestor of the verified integration.
2. Push the integration to master without force or branch-protection bypass.
3. Observe typecheck, unit, UI and SQL CI for the exact pushed SHA.
4. Observe the web deployment for that SHA and inspect its returned app URL.
5. Keep deployment success separate from authenticated invoice/device proof.

The checked repository CI runs only typecheck and tests. Vercel's build command is
`npm run build:web`. No APK/EAS/release command is part of this path.

## Remaining limits and recovery

The 110-line corpus uses transcriptions and tiered audit labels, not staff-verified
real-OCR production ground truth. Probable, ambiguous and not-found labels are
not identity proof. Known variant ambiguities, physical camera/keyboard behavior,
production latency and authenticated end-to-end behavior remain unproven.

A failed web rollout does not authorize changing the database or reverting
unrelated master work. Prepare a forward fix or scoped revert of the affected
feature commits, preserve master purchase changes, and obtain the normal
publication authorization for that recovery. No rollback was executed here.
