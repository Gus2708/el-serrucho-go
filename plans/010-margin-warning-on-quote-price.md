# Plan 010: Warn when quote price is set below cost in `usePresupuestoStore`

> **Executor instructions**: Follow this plan step by step. Run every
> verification command before moving on. On any STOP condition, stop and
> report. When done, update `plans/README.md`.
>
> **Drift check (run first)**:
> `git diff --stat 75ad0a7..HEAD -- src/hooks/usePresupuestoStore.ts`
> If the file changed, compare "Current state" excerpts before proceeding.

## Status

- **Priority**: P3
- **Effort**: M
- **Risk**: LOW
- **Depends on**: none
- **Category**: direction
- **Planned at**: commit `75ad0a7`, 2026-06-22

## Why this matters

`updateItemPrice()` in `usePresupuestoStore` allows changing the unit price
of any line item in a presupuesto. There is no validation: a salesperson can
quote a product at $1 when it costs $50. No warning is shown, and the quote
is emitted with a negative margin.

The domain rule from `CLAUDE.md` (IVA section): `productos.precio_venta`
includes IVA 16%. To compare against `costo` (ex-IVA), divide `precio_venta`
by 1.16. A quote price is already without IVA (the salesperson sets it
directly), so compare: `quoted_price < costo` (both ex-IVA).

The fix adds a validation in `updateItemPrice` that returns a warning string
(or `null`) instead of mutating silently. The UI component then decides
whether to show the warning.

## Current state

**`src/hooks/usePresupuestoStore.ts`, lines 86–93**:

```typescript
updateItemPrice: (codigo_producto, precio) => {
  set((state) => ({
    items: state.items.map(i => 
      i.producto.codigo_interno === codigo_producto 
        ? { ...i, precio_unitario: precio } 
        : i
    )
  }));
},
```

No validation. The `PresupuestoItem` type includes:

```typescript
export type PresupuestoItem = {
  producto:        Producto;
  cantidad:        number;
  precio_unitario: number;  // frozen at time of addition/creation
};
```

`Producto.costo` is `number` (ex-IVA). `Producto.precio_venta` is `number`
(IVA included — divide by 1.16 to compare).

**Repo currency rule** (from `CLAUDE.md`): all prices are in USD. No conversion
needed here — both `costo` and `precio_unitario` are already in USD.

## Commands you will need

| Purpose   | Command             | Expected on success |
|-----------|---------------------|---------------------|
| Typecheck | `npm run typecheck` | exit 0              |

## Scope

**In scope**:
- `src/hooks/usePresupuestoStore.ts` — update `updateItemPrice` signature

**Out of scope** (do NOT modify yet — this plan only adds the validation
function; UI integration is part of this plan but limited to the call site
that already calls `updateItemPrice`):
- Other components that don't call `updateItemPrice`

Find the call site:
```
grep -rn "updateItemPrice" app/ src/
```

## Git workflow

- Branch: `advisor/010-margin-warning-quote`
- Commit: `feat(presupuesto): warn when quote price is below cost`

## Steps

### Step 1: Update `updateItemPrice` to return a warning

Change the return type from `void` to `string | null`. A non-null return is
a warning message to display — it does NOT block the price change.

Update the `PresupuestoStore` interface type definition:

```typescript
updateItemPrice: (codigo_producto: string, precio: number) => string | null;
```

Update the implementation:

```typescript
updateItemPrice: (codigo_producto, precio) => {
  const item = get().items.find(i => i.producto.codigo_interno === codigo_producto);
  const costo = item?.producto.costo ?? 0;

  set((state) => ({
    items: state.items.map(i => 
      i.producto.codigo_interno === codigo_producto 
        ? { ...i, precio_unitario: precio } 
        : i
    )
  }));

  // Warn if quoted price is below cost (both ex-IVA, USD)
  if (item && precio < costo) {
    return `Precio por debajo del costo ($${costo.toFixed(2)})`;
  }
  return null;
},
```

**Verify**: `npm run typecheck` exits 0.

### Step 2: Handle the warning at the call site

Find where `updateItemPrice` is called in the UI:

```
grep -rn "updateItemPrice" app/ src/
```

At each call site, capture the return value and display it. The repo uses
`notify()` from `src/lib/notify.ts` for alerts. Pattern:

```typescript
const warning = updateItemPrice(codigo_producto, newPrice);
if (warning) {
  notify('Margen negativo', warning);
}
```

If the call site is inside a component, use `notify()`. If it's in another
store method, log with `console.warn()`.

**Verify**: `npm run typecheck` exits 0.

## Test plan

When Plan 011 (test suite) lands, add tests:
- `updateItemPrice(code, costo - 1)` → returns a warning string containing the cost.
- `updateItemPrice(code, costo + 1)` → returns `null`.
- `updateItemPrice(code, 0)` → returns a warning (below cost).
- `updateItemPrice(code, costo)` → returns `null` (exactly at cost is OK).
- Price update still applies even when warning is returned (no blocking).

## Done criteria

- [ ] `updateItemPrice` in `PresupuestoStore` interface returns `string | null`
- [ ] Implementation returns a warning string when `precio < costo`
- [ ] Call site handles the return value and calls `notify()` on non-null
- [ ] `npm run typecheck` exits 0
- [ ] `plans/README.md` status row updated

## STOP conditions

- `updateItemPrice` is called in more than 3 places — review each call site
  before adding the notify; some may be internal (e.g., initialization) where
  showing a warning is wrong.
- The `Producto.costo` field is sometimes 0 (placeholder products with
  `isPlaceholder(p)` returning true) — do NOT warn on placeholder products.
  Add a guard: `if (!item || costo === 0) return null;`

## Maintenance notes

- A stronger version: block the price change (don't apply it) and require
  the user to explicitly confirm. This is a UX decision for the business —
  the current plan only warns, not blocks.
- If a margin threshold other than "below cost" is needed (e.g., "below 10%
  margin"), change the comparison to:
  `const minPrice = costo * 1.10; if (precio < minPrice) ...`
