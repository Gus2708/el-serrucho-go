# Plan 005: PDF upload failure should throw, not silently leave `pdf_url` as null

> **Executor instructions**: Follow this plan step by step. Run every
> verification command before moving on. On any STOP condition, stop and
> report. When done, update `plans/README.md`.
>
> **Drift check (run first)**:
> `git diff --stat 75ad0a7..HEAD -- src/lib/pdfStorage.ts src/hooks/useOrdenCambio.ts src/hooks/usePresupuestoStore.ts`
> If any file changed since this plan was written, compare "Current state"
> excerpts against live code. `src/lib/pdfStorage.ts` may not exist yet —
> if Plan 002 has not landed, treat that as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: MED
- **Depends on**: `plans/002-extract-pdf-upload-helper.md`
- **Category**: bug
- **Planned at**: commit `75ad0a7`, 2026-06-22

## Why this matters

When a PDF upload to Supabase Storage fails (network error, bucket
permissions, bucket full), the current code silently skips setting `pdf_url`
and continues — marking the order/presupuesto as `emitido` (issued) with
`pdf_url: null`. The user sees a success confirmation but no PDF is available
to download or share.

The fix is two parts:
1. `uploadPdfAndGetUrl` (from Plan 002) should throw on upload failure instead
   of returning `null`.
2. Callers (`useOrdenCambio`, `usePresupuestoStore`) already wrap everything
   in `try/catch` that re-throws — so if the helper throws, the error
   propagates to the UI naturally.

The web branch is not affected: on web, PDF generation returns HTML to the UI
directly and there is no upload step.

## Current state

After Plan 002 lands, `src/lib/pdfStorage.ts` will contain:

```typescript
export async function uploadPdfAndGetUrl(
  localUri: string,
  fileName: string,
): Promise<string | null> {
  const fileData = await fetch(localUri).then(r => r.blob());

  const { error: uploadError } = await supabase.storage
    .from(BUCKET)
    .upload(fileName, fileData, { contentType: 'application/pdf' });

  if (uploadError) return null;   // ← THIS IS THE BUG

  const { data: signedData } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(fileName, SIGNED_URL_SECONDS);

  return signedData?.signedUrl ?? null;
}
```

**`src/hooks/useOrdenCambio.ts`** — the native branch already wraps
everything in `try { ... } catch (err) { set({ isLoading: false }); throw err; }`.
If `uploadPdfAndGetUrl` throws, the error propagates to the UI caller.

**`src/hooks/usePresupuestoStore.ts`** — same pattern:
`catch (error: any) { console.error(...); throw error; }`.

Both stores are called from UI components that should handle the error with
`notify()` — verify this is already in place (see STOP conditions).

## Commands you will need

| Purpose   | Command             | Expected on success |
|-----------|---------------------|---------------------|
| Typecheck | `npm run typecheck` | exit 0              |

## Scope

**In scope**:
- `src/lib/pdfStorage.ts` — change `return null` to `throw`

**Out of scope**:
- `src/hooks/useOrdenCambio.ts` — do not modify; its try/catch already handles thrown errors
- `src/hooks/usePresupuestoStore.ts` — same
- UI components — do not modify error handling at the call site unless a STOP condition triggers

## Git workflow

- Branch: `advisor/005-pdf-upload-throw-on-failure`
- Commit: `fix(pdf): throw on upload failure instead of silently returning null`

## Steps

### Step 1: Change `uploadPdfAndGetUrl` to throw on failure

In `src/lib/pdfStorage.ts`, replace:

```typescript
if (uploadError) return null;
```

with:

```typescript
if (uploadError) throw new Error(`PDF upload failed: ${uploadError.message}`);
```

Also update the return type from `Promise<string | null>` to
`Promise<string>` since the function now either returns a URL or throws:

```typescript
export async function uploadPdfAndGetUrl(
  localUri: string,
  fileName: string,
): Promise<string> {
```

**Verify**: `npm run typecheck` exits 0.

### Step 2: Verify callers handle the thrown error

Check that the UI call sites catch and display the error. Search for the two
call sites:

```
grep -n "useOrdenCambio\|submit\b" app/\(tabs\)/ordenes.tsx | head -20
grep -n "usePresupuestoStore\|submit\b" app/\(tabs\)/ordenes.tsx | head -20
```

For each call site, verify there is either:
- a `.catch(e => notify(...))` or
- a `try { ... } catch (e) { notify(...) }` wrapping the `submit()` call.

If a call site swallows the error without notifying the user, add a `catch`
that calls `notify('Error al emitir', e.message || 'No se pudo subir el PDF')`.

**Verify**: `npm run typecheck` exits 0 after any call-site changes.

### Step 3: Handle null signed URL

After the upload succeeds, `createSignedUrl` can still return a null
`signedUrl` (if Supabase returns an unexpected shape). Currently:

```typescript
return signedData?.signedUrl ?? null;
```

With the new return type `Promise<string>`, this should be:

```typescript
const url = signedData?.signedUrl;
if (!url) throw new Error('PDF uploaded but signed URL was not returned');
return url;
```

**Verify**: `npm run typecheck` exits 0.

## Test plan

When Plan 011 (test suite) lands, add tests to `src/lib/pdfStorage.test.ts`:
- Mock `supabase.storage.upload` to return `{ error: { message: 'Bucket full' } }` → `uploadPdfAndGetUrl` should throw with message containing "Bucket full".
- Mock successful upload + `createSignedUrl` returning null → should throw.
- Mock full success → should return the signed URL string.

## Done criteria

- [ ] `src/lib/pdfStorage.ts` return type is `Promise<string>` (not `Promise<string | null>`)
- [ ] `if (uploadError) return null` replaced with `throw new Error(...)`
- [ ] `null` signed URL case also throws
- [ ] Call sites in UI components catch and display the error
- [ ] `npm run typecheck` exits 0
- [ ] Only in-scope files modified
- [ ] `plans/README.md` status row updated

## STOP conditions

- Plan 002 has not landed — `src/lib/pdfStorage.ts` does not exist. Stop and execute Plan 002 first.
- A call site catches the error silently (`catch {}` or `catch (e) { }`) — investigate why before changing it; there may be an intentional reason to swallow it.
- Typecheck reports errors in files outside the in-scope list.

## Maintenance notes

- If a dedicated `presupuestos` bucket is created later, `pdfStorage.ts` is
  the only file to update — the throw behavior stays the same.
- The 1-year signed URL expiry is stored in `SIGNED_URL_SECONDS`. If Supabase
  changes signed URL policies (e.g., max 7 days), update that constant here.
