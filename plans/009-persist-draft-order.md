# Plan 009: Persist draft change order across PWA reloads

> **Executor instructions**: Follow this plan step by step. Run every
> verification command before moving on. On any STOP condition, stop and
> report. When done, update `plans/README.md`.
>
> **Drift check (run first)**:
> `git diff --stat 75ad0a7..HEAD -- src/hooks/useOrdenCambio.ts`
> If the file changed, compare "Current state" against live code first.

## Status

- **Priority**: P3
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: direction
- **Planned at**: commit `75ad0a7`, 2026-06-22

## Why this matters

`useOrdenCambio` is a Zustand store with no persistence. If a user builds a
change order with 15 items in the PWA and then the browser tab refreshes
(accidentally, from another device taking over the single-session enforcer, or
from the PWA update toast), the entire draft is lost with no recovery.

Zustand ships a `persist` middleware that writes to `localStorage`
automatically. Adding it is a ~10-line change and costs nothing at runtime.
On the next load, the draft is restored and the user sees a resume prompt
instead of a blank screen.

## Current state

**`src/hooks/useOrdenCambio.ts`**, store definition (lines 20–132):

```typescript
export const useOrdenCambio = create<OrdenStore>((set, get) => ({
  items:     [],
  nota:      '',
  isLoading: false,
  // ... actions
}));
```

Uses `create` from `zustand` with no middleware. No persistence.

The `isLoading` flag must NOT be persisted (it's transient UI state).

**Repo convention**: Zustand is used throughout (also in
`src/hooks/usePresupuestoStore.ts`). No other store currently uses `persist`.
Example exemplar for the `persist` middleware syntax: Zustand v5 docs use
`import { persist } from 'zustand/middleware'`.

## Commands you will need

| Purpose   | Command             | Expected on success |
|-----------|---------------------|---------------------|
| Typecheck | `npm run typecheck` | exit 0              |

## Scope

**In scope**:
- `src/hooks/useOrdenCambio.ts`

**Out of scope**:
- `src/hooks/usePresupuestoStore.ts` — that store's draft is less likely to
  be long-lived; add persistence there separately if needed
- UI components — the resume prompt is optional (see maintenance notes)

## Git workflow

- Branch: `advisor/009-persist-draft-order`
- Commit: `feat(orders): persist draft change order to localStorage`

## Steps

### Step 1: Add `persist` middleware

Update `src/hooks/useOrdenCambio.ts`:

Add to the imports:

```typescript
import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
```

Wrap the store with `persist`:

```typescript
export const useOrdenCambio = create<OrdenStore>()(
  persist(
    (set, get) => ({
      items:     [],
      nota:      '',
      isLoading: false,
      // ... all actions unchanged ...
    }),
    {
      name:    'serrucho:orden-cambio-draft',
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        items: state.items,
        nota:  state.nota,
        // isLoading is intentionally excluded — do not persist transient state
      }),
    }
  )
);
```

The `partialize` option ensures only `items` and `nota` are saved, not
`isLoading` or any function references.

**Verify**: `npm run typecheck` exits 0.

### Step 2: Clear persisted draft after successful submit

After a successful `submit()`, the store calls `set({ isLoading: false })`
but does NOT call `clear()`. The caller component must call `clear()` after
submit succeeds. Verify this is already done:

```
grep -n "clear\(\)" app/\(tabs\)/ordenes.tsx
```

If `clear()` is not called on success, add it to the success handler in
`app/(tabs)/ordenes.tsx`. The persisted storage is cleared automatically when
`clear()` sets `items: []` and `nota: ''` (Zustand persist syncs on every
set).

**Verify**: After calling `clear()`, `localStorage.getItem('serrucho:orden-cambio-draft')` should contain `{"state":{"items":[],"nota":""},...}`.

### Step 3: Handle web-only (localStorage unavailable on native)

The `createJSONStorage(() => localStorage)` call will throw on native (React
Native) because `localStorage` is not defined. Add a platform guard:

```typescript
import { Platform } from 'react-native';

// In the persist config:
storage: createJSONStorage(() =>
  Platform.OS === 'web' ? localStorage : {
    getItem: () => null,
    setItem: () => {},
    removeItem: () => {},
  }
),
```

**Verify**: `npm run typecheck` exits 0.

## Test plan

When Plan 011 (test suite) lands, add tests:
- Add items to the store → `localStorage.getItem('serrucho:orden-cambio-draft')` contains the items.
- Create a new store instance (simulating reload) → items are restored from storage.
- Call `clear()` → storage is emptied.

## Done criteria

- [ ] `useOrdenCambio` uses `persist` middleware
- [ ] Only `items` and `nota` are persisted (not `isLoading`)
- [ ] Storage key is `'serrucho:orden-cambio-draft'`
- [ ] Native `localStorage` fallback (`Platform.OS !== 'web'`) is handled
- [ ] `clear()` is called on submit success in the UI component
- [ ] `npm run typecheck` exits 0
- [ ] Only `src/hooks/useOrdenCambio.ts` (and optionally `app/(tabs)/ordenes.tsx`) modified
- [ ] `plans/README.md` status row updated

## STOP conditions

- `zustand/middleware` does not export `persist` — check the Zustand version
  (`npm ls zustand`); v5 has `persist` at this path. If not, report back.
- Typecheck errors appear in unrelated files.

## Maintenance notes

- A nice-to-have follow-up: on app boot, if the persisted draft has items,
  show a dismissible banner "Tenés un borrador de orden con N ítems" with a
  "Continuar" button that navigates to the orders tab. This is not in scope
  for this plan.
- If `usePresupuestoStore` also needs persistence, apply the same `persist`
  middleware pattern with key `'serrucho:presupuesto-draft'`.
