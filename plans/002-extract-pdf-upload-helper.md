# Plan 002: Extract duplicated PDF upload block into a shared helper

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md`.
>
> **Drift check (run first)**:
> `git diff --stat 75ad0a7..HEAD -- src/hooks/useOrdenCambio.ts src/hooks/usePresupuestoStore.ts`
> If either file changed since this plan was written, compare the "Current
> state" excerpts against the live code before proceeding; on a mismatch,
> treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: tech-debt
- **Planned at**: commit `75ad0a7`, 2026-06-22

## Why this matters

The following 13-line block appears identically in two hooks:

```
upload to 'change-orders' bucket →
  if no error: createSignedUrl (1-year expiry) →
    update DB record with pdf_url
```

Because this logic is duplicated, a bug fix or policy change (different
bucket, different expiry, check for uploadError) must be applied in two
places. They have already drifted: `useOrdenCambio` updates `status` alongside
`pdf_url` while `usePresupuestoStore` only updates `pdf_url`. Extracting a
single helper eliminates the drift risk and makes Plan 005 (throw on upload
failure) a one-line change.

## Current state

**`src/hooks/useOrdenCambio.ts`, lines 103–119** (native branch):

```typescript
// 4. Upload to Supabase Storage
const fileName = `orden-${orden.id}-${Date.now()}.pdf`;
const fileData = await fetch(uri).then(r => r.blob());
const { error: uploadError } = await supabase.storage
  .from('change-orders')
  .upload(fileName, fileData, { contentType: 'application/pdf' });

if (!uploadError) {
  const { data: signedData } = await supabase.storage
    .from('change-orders')
    .createSignedUrl(fileName, 60 * 60 * 24 * 365);

  await supabase
    .from('ordenes_cambio')
    .update({ status: 'emitido', pdf_url: signedData?.signedUrl ?? null })
    .eq('id', orden.id);
}
```

**`src/hooks/usePresupuestoStore.ts`, lines 165–182** (native branch):

```typescript
// 4. Upload to Supabase Storage
// Using 'change-orders' bucket as a fallback since we know it exists.
const fileName = `presupuesto-${presupuesto.id}-${Date.now()}.pdf`;
const fileData = await fetch(uri).then(r => r.blob());
const { error: uploadError } = await supabase.storage
  .from('change-orders')
  .upload(fileName, fileData, { contentType: 'application/pdf' });

if (!uploadError) {
  const { data: signedData } = await supabase.storage
    .from('change-orders')
    .createSignedUrl(fileName, 60 * 60 * 24 * 365);

  await supabase
    .from('presupuestos')
    .update({ pdf_url: signedData?.signedUrl ?? null })
    .eq('id', presupuesto.id);
}
```

**Repo convention**: utilities that don't depend on React live in `src/lib/`.
Example: `src/lib/supabase.ts` exports the client and all type helpers.
Match that pattern — no hooks in the new file, pure async functions only.

## Commands you will need

| Purpose   | Command              | Expected on success  |
|-----------|----------------------|----------------------|
| Typecheck | `npm run typecheck`  | exit 0, no new errors |

## Scope

**In scope**:
- `src/lib/pdfStorage.ts` — create (new file)
- `src/hooks/useOrdenCambio.ts` — replace upload block with helper call
- `src/hooks/usePresupuestoStore.ts` — replace upload block with helper call

**Out of scope**:
- Any other file
- Changing the bucket name, expiry, or DB column names
- Handling the `uploadError` differently (that is Plan 005)

## Git workflow

- Branch: `advisor/002-extract-pdf-upload-helper`
- Commit: `refactor(pdf): extract PDF storage upload into shared helper`

## Steps

### Step 1: Create `src/lib/pdfStorage.ts`

Create the file with the following content:

```typescript
import { supabase } from './supabase';

const BUCKET = 'change-orders';
const SIGNED_URL_SECONDS = 60 * 60 * 24 * 365; // 1 year

/**
 * Uploads a PDF blob to Supabase Storage and returns the signed URL.
 * Returns null if the upload fails — callers decide how to handle failure.
 */
export async function uploadPdfAndGetUrl(
  localUri: string,
  fileName: string,
): Promise<string | null> {
  const fileData = await fetch(localUri).then(r => r.blob());

  const { error: uploadError } = await supabase.storage
    .from(BUCKET)
    .upload(fileName, fileData, { contentType: 'application/pdf' });

  if (uploadError) return null;

  const { data: signedData } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(fileName, SIGNED_URL_SECONDS);

  return signedData?.signedUrl ?? null;
}
```

**Verify**: file exists at `src/lib/pdfStorage.ts`; `npm run typecheck` exits 0.

### Step 2: Update `src/hooks/useOrdenCambio.ts`

At the top of the file, add the import after the existing imports:

```typescript
import { uploadPdfAndGetUrl } from '../lib/pdfStorage';
```

Replace lines 103–119 (the native upload block) with:

```typescript
// 4. Upload PDF to Storage
const fileName = `orden-${orden.id}-${Date.now()}.pdf`;
const pdfUrl = await uploadPdfAndGetUrl(uri, fileName);

await supabase
  .from('ordenes_cambio')
  .update({ status: 'emitido', pdf_url: pdfUrl })
  .eq('id', orden.id);
```

**Verify**: `npm run typecheck` exits 0.

### Step 3: Update `src/hooks/usePresupuestoStore.ts`

Add the import at the top:

```typescript
import { uploadPdfAndGetUrl } from '../lib/pdfStorage';
```

Replace lines 165–182 (the native upload block) with:

```typescript
// 4. Upload PDF to Storage
const fileName = `presupuesto-${presupuesto.id}-${Date.now()}.pdf`;
const pdfUrl = await uploadPdfAndGetUrl(uri, fileName);

await supabase
  .from('presupuestos')
  .update({ pdf_url: pdfUrl })
  .eq('id', presupuesto.id);
```

**Verify**: `npm run typecheck` exits 0.

### Step 4: Final check

Confirm that the string `'change-orders'` no longer appears in either hook:

```
grep -n "change-orders" src/hooks/useOrdenCambio.ts src/hooks/usePresupuestoStore.ts
```

Expected: no matches.

## Test plan

No tests exist in this project yet. When Plan 011 (test suite) lands, add a
unit test for `uploadPdfAndGetUrl` that mocks `supabase.storage` and verifies:
- Happy path: returns a signed URL string.
- Upload failure: returns `null` (does not throw).

## Done criteria

- [ ] `src/lib/pdfStorage.ts` exists with `uploadPdfAndGetUrl` exported
- [ ] `grep -n "change-orders" src/hooks/useOrdenCambio.ts` → no matches
- [ ] `grep -n "change-orders" src/hooks/usePresupuestoStore.ts` → no matches
- [ ] `npm run typecheck` exits 0
- [ ] Only `src/lib/pdfStorage.ts`, `src/hooks/useOrdenCambio.ts`, `src/hooks/usePresupuestoStore.ts` are modified
- [ ] `plans/README.md` status row updated

## STOP conditions

- The code in either hook does not match the excerpts in "Current state" — the
  codebase has drifted; stop and report.
- Typecheck reports errors in files outside the in-scope list — don't fix
  them; report back.

## Maintenance notes

- Plan 005 (throw on upload failure) modifies `uploadPdfAndGetUrl` to throw
  instead of returning `null` — it depends on this plan landing first.
- If a second bucket is ever introduced (e.g., a dedicated `presupuestos`
  bucket), change only `pdfStorage.ts` — the hooks won't need updates.
