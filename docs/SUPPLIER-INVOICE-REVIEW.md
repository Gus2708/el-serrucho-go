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
- Hybrid financial representation of compensated quantities.

Attaching and removing a document before saving can leave an unreferenced
Storage object. Object deletion and garbage collection remain outside this slice.
OCR, product matching, new-product barcode assignment and purchase/POS transfer
are also outside this persistence slice. Manual purchase entry remains available.

## Delivery boundaries

Changes will be grouped by behavior with their tests. Existing notification,
request-resolution and machine configuration edits are excluded. Private test
artifacts, local orchestration state and the historical Playwright executor
are excluded from the publication candidate.

The database migration was applied earlier during the authorized schema rollout.
A draft review or merge does not authorize applying it again, changing inventory,
creating purchases, publishing an app build or deploying this feature.
