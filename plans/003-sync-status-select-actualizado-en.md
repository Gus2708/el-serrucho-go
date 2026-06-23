# Plan 003: `useSyncStatus` — select only `actualizado_en` instead of full row

> **Executor instructions**: Follow this plan step by step. Run every
> verification command before moving on. On any STOP condition, stop and
> report. When done, update `plans/README.md`.
>
> **Drift check (run first)**:
> `git diff --stat 75ad0a7..HEAD -- src/hooks/useSyncStatus.ts`
> If the file changed, compare "Current state" excerpts against live code
> before proceeding.

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: perf
- **Planned at**: commit `75ad0a7`, 2026-06-22

## Why this matters

`fetchSyncStatus()` runs on every poll cycle (every 3–30 seconds). It queries
the `productos` table with `.select('actualizado_en')` — but wait, that's
actually already correct in the current code. This plan is a **verification +
documentation task**: confirm the select is narrow, and add the
`'actualizado_en'` explicit select to the `comandos_remotos` query which
currently does `select('id, comando, status, creado_en')` (already correct
too). The real value is pinning this as a contract so future refactors don't
accidentally widen the selects.

Actually, re-reading the current code carefully:

```typescript
// Line 97-102: productos query
const { data: prodData } = await supabase
  .from('productos')
  .select('actualizado_en')   // ← already narrow, GOOD
  .order('actualizado_en', { ascending: false })
  .limit(1)
  .single();
```

The select IS already narrow. This plan's value is: the `SyncBadge` component
and any future hook must not add `select('*')` to this query. Add a colocated
comment explaining why, and add the explicit column list to the type assertion.

## Current state

**`src/hooks/useSyncStatus.ts`, lines 95–131** (`fetchSyncStatus` function):

```typescript
async function fetchSyncStatus() {
  // 1. Obtener última actualización de productos
  const { data: prodData } = await supabase
    .from('productos')
    .select('actualizado_en')
    .order('actualizado_en', { ascending: false })
    .limit(1)
    .single();

  // 2. Obtener comando remoto activo (si existe)
  const { data: cmdData } = await supabase
    .from('comandos_remotos')
    .select('id, comando, status, creado_en')
    .order('creado_en', { ascending: false })
    .limit(1)
    .maybeSingle();
  // ...
}
```

Both selects are already narrow — no `select('*')`. The only improvement
needed is pinning the return types so TypeScript enforces the contract.

## Commands you will need

| Purpose   | Command             | Expected on success |
|-----------|---------------------|---------------------|
| Typecheck | `npm run typecheck` | exit 0              |

## Scope

**In scope**:
- `src/hooks/useSyncStatus.ts` — add typed interfaces + clarifying comment

**Out of scope**:
- Any other file

## Git workflow

- Branch: `advisor/003-sync-status-typed-selects`
- Commit: `refactor(perf): type and document narrow selects in fetchSyncStatus`

## Steps

### Step 1: Add explicit return types to `fetchSyncStatus`

At the top of `src/hooks/useSyncStatus.ts`, after the existing imports, add:

```typescript
type SyncStatusResult = {
  lastSync:      Date | null;
  minutesAgo:    number | null;
  activeCommand: ActiveCommand | null;
};

type ActiveCommand = {
  id:             number;
  comando:        string;
  status:         string;
  creado_en:      string;
  runningMinutes: number;
};
```

Change the `fetchSyncStatus` signature to:

```typescript
async function fetchSyncStatus(): Promise<SyncStatusResult> {
```

Add a comment above the `productos` query:

```typescript
// Narrow select: only the timestamp column is needed.
// Do NOT widen this to select('*') — this query runs every 3–30 seconds.
```

**Verify**: `npm run typecheck` exits 0.

## Test plan

No tests exist. When Plan 011 lands, add a unit test that mocks the Supabase
client and verifies `fetchSyncStatus` returns `{ lastSync, minutesAgo,
activeCommand }` with correct types.

## Done criteria

- [ ] `fetchSyncStatus` has explicit `Promise<SyncStatusResult>` return type
- [ ] Comment explaining narrow select is present above the `productos` query
- [ ] `npm run typecheck` exits 0
- [ ] Only `src/hooks/useSyncStatus.ts` was modified
- [ ] `plans/README.md` status row updated

## STOP conditions

- Typecheck reports errors in this file that weren't present before — stop
  and report; the inferred types may conflict with the new explicit types.

## Maintenance notes

- If `vw_sync_status` view is ever created in Supabase to replace this
  manual query, update the select target here.
- The `staleTime: 5_000` + adaptive `refetchInterval` (3s on active command,
  30s otherwise) is intentional and should not be changed without measuring
  the real-time update latency.
