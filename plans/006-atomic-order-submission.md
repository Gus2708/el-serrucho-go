# Plan 006: Make order and presupuesto submission atomic (no orphaned headers)

> **Executor instructions**: Follow this plan step by step. Run every
> verification command before moving on. On any STOP condition, stop and
> report. When done, update `plans/README.md`.
>
> **Drift check (run first)**:
> `git diff --stat 75ad0a7..HEAD -- src/hooks/useOrdenCambio.ts src/hooks/usePresupuestoStore.ts`
> If either file changed, compare "Current state" excerpts before proceeding.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: MED
- **Depends on**: none (independent of Plans 002, 005)
- **Category**: bug
- **Planned at**: commit `75ad0a7`, 2026-06-22

## Why this matters

Both `useOrdenCambio.submit()` and `usePresupuestoStore.submit()` follow a
multi-step write pattern:

1. Insert header row → get `id`
2. Insert detail rows (items)

If step 2 fails (network drop, RLS error, validation), step 1 has already
committed a header row to the database with no items. These orphaned rows:
- Appear in history lists with 0 items and broken state
- Never get cleaned up automatically
- Can accumulate silently over time

The fix is to delete the orphaned header when step 2 fails. A proper
transactional RPC is the ideal long-term solution, but that requires a
Supabase migration. The simpler, safe interim fix is a compensating delete in
the `catch` block.

## Current state

**`src/hooks/useOrdenCambio.ts`, lines 46–131** (relevant excerpt):

```typescript
submit: async (userId: string) => {
  // ...
  try {
    // Step 1: Insert header
    const { data: orden, error: ordenError } = await supabase
      .from('ordenes_cambio')
      .insert({ creado_por: userId, nota: nota || null, status: 'borrador' })
      .select('id')
      .single();

    if (ordenError || !orden) throw ordenError ?? new Error('No orden id');

    // Step 2: Insert items
    const { error: itemsError } = await supabase
      .from('ordenes_cambio_items')
      .insert(items.map(item => ({ orden_id: orden.id, ... })));

    if (itemsError) throw itemsError;   // ← header already written; now orphaned

    // Step 3: Profile fetch, PDF gen, upload ...
  } catch (err) {
    set({ isLoading: false });
    throw err;   // ← no cleanup of the header row
  }
}
```

**`src/hooks/usePresupuestoStore.ts`, lines 104–193** (relevant excerpt):

```typescript
submit: async () => {
  // ...
  try {
    // Insert cabecera (status: 'emitido' immediately)
    const { data: presupuesto, error: cabeceraError } = await supabase
      .from('presupuestos')
      .insert({ ... status: 'emitido' ... })
      .select()
      .single();

    if (cabeceraError) throw cabeceraError;

    // Insert detalle
    const { error: detalleError } = await supabase
      .from('presupuestos_detalle')
      .insert(detalles);

    if (detalleError) throw detalleError;   // ← header already 'emitido'; now orphaned
  } catch (error: any) {
    console.error('Error enviando presupuesto:', error);
    throw error;   // ← no cleanup
  }
}
```

**Repo convention**: errors are re-thrown after logging; `notify()` is called
by the UI caller. Match this pattern — don't `notify()` inside the store.

## Commands you will need

| Purpose   | Command             | Expected on success |
|-----------|---------------------|---------------------|
| Typecheck | `npm run typecheck` | exit 0              |

## Scope

**In scope**:
- `src/hooks/useOrdenCambio.ts` — add compensating delete in catch
- `src/hooks/usePresupuestoStore.ts` — add compensating delete in catch

**Out of scope**:
- Supabase schema / migrations — no RPC changes in this plan
- UI components
- `src/lib/pdfStorage.ts`

## Git workflow

- Branch: `advisor/006-atomic-order-submission`
- Commit: `fix(orders): delete orphaned header on item insert failure`

## Steps

### Step 1: Track `ordenId` for rollback in `useOrdenCambio`

Refactor the `submit` function to track the created ID so the catch block can
delete it. The structure should be:

```typescript
submit: async (userId: string) => {
  const { items, nota } = get();
  set({ isLoading: true });

  let createdOrdenId: number | null = null;   // ← track for rollback

  try {
    // Step 1: Insert header
    const { data: orden, error: ordenError } = await supabase
      .from('ordenes_cambio')
      .insert({ creado_por: userId, nota: nota || null, status: 'borrador' })
      .select('id')
      .single();

    if (ordenError || !orden) throw ordenError ?? new Error('No orden id');
    createdOrdenId = orden.id;   // ← record it

    // Step 2: Insert items
    const { error: itemsError } = await supabase
      .from('ordenes_cambio_items')
      .insert(items.map(item => ({
        orden_id: orden.id,
        codigo_producto:   item.codigo_producto,
        descripcion:       item.descripcion,
        existencia_actual: item.existencia_actual,
        nueva_existencia:  item.nueva_existencia,
        nota:              item.nota || null,
      })));

    if (itemsError) throw itemsError;

    // ... rest of the function unchanged (profile, html, upload)

  } catch (err) {
    // Compensating delete: remove orphaned header if items failed
    if (createdOrdenId !== null) {
      await supabase
        .from('ordenes_cambio')
        .delete()
        .eq('id', createdOrdenId)
        .then(({ error }) => {
          if (error) console.warn('[useOrdenCambio] cleanup failed:', error.message);
        });
    }
    set({ isLoading: false });
    throw err;
  }
},
```

Key points:
- The compensating delete is fire-and-forget (`.then()` only for logging) —
  the original error is still re-thrown.
- `createdOrdenId` starts as `null`; if header insert failed, it's still
  `null` and the delete is skipped.

**Verify**: `npm run typecheck` exits 0.

### Step 2: Apply the same pattern to `usePresupuestoStore`

Add a `createdPresupuestoId` tracker and compensating delete:

```typescript
submit: async () => {
  // ...
  let createdPresupuestoId: number | null = null;

  try {
    const { data: presupuesto, error: cabeceraError } = await supabase
      .from('presupuestos')
      .insert({ ... })
      .select()
      .single();

    if (cabeceraError) throw cabeceraError;
    createdPresupuestoId = presupuesto.id;   // ← record it

    const { error: detalleError } = await supabase
      .from('presupuestos_detalle')
      .insert(detalles);

    if (detalleError) throw detalleError;

    // ... rest unchanged

  } catch (error: any) {
    // Compensating delete
    if (createdPresupuestoId !== null) {
      await supabase
        .from('presupuestos')
        .delete()
        .eq('id', createdPresupuestoId)
        .then(({ error: delErr }) => {
          if (delErr) console.warn('[usePresupuestoStore] cleanup failed:', delErr.message);
        });
    }
    console.error('Error enviando presupuesto:', error);
    throw error;
  }
}
```

**Verify**: `npm run typecheck` exits 0.

### Step 3: Verify RLS allows delete

The compensating delete runs as the authenticated user. Confirm that RLS
policy for `ordenes_cambio` and `presupuestos` allows `DELETE` where
`creado_por = auth.uid()`. Check `supabase/migrations/004_rls.sql`.

If the policy does NOT allow delete by owner, add a note to `plans/README.md`
that a migration is needed to grant owner-delete on these tables.

## Test plan

When Plan 011 (test suite) lands, add tests:
- Mock items insert to fail → verify `supabase.from('ordenes_cambio').delete()` was called with the correct ID.
- Mock header insert to fail → verify delete is NOT called (no ID was recorded).
- Mock delete itself to fail → verify the original error is still thrown (not swallowed).

## Done criteria

- [ ] `useOrdenCambio.submit` declares `createdOrdenId` and deletes on catch
- [ ] `usePresupuestoStore.submit` declares `createdPresupuestoId` and deletes on catch
- [ ] `npm run typecheck` exits 0
- [ ] Only `useOrdenCambio.ts` and `usePresupuestoStore.ts` modified
- [ ] `plans/README.md` status row updated

## STOP conditions

- RLS policy review (step 3) reveals delete is not permitted — stop, add a
  migration note to the plan, and report back before proceeding.
- The code structure in either hook does not match the excerpts (drift) — stop.
- Typecheck errors appear in out-of-scope files.

## Maintenance notes

- Long-term: replace this compensating-delete pattern with a Supabase RPC
  that wraps both inserts in a single DB transaction. That eliminates the
  window between the two writes entirely. The compensating delete is a safe
  interim measure.
- If `ordenes_cambio_items` ever gets a FK constraint with `ON DELETE CASCADE`
  pointing to `ordenes_cambio`, the item cleanup becomes automatic. Remove the
  explicit items delete from the catch if that happens.
