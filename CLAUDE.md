# El Serrucho to GO — Claude Code Context

Mobile inventory app for **Ferretería El Serrucho** (Venezuelan hardware store).
React Native / Expo. Backend is Supabase. Data flows from a Python widget that
watches Hybrid POS `.dat` files and syncs to Supabase in real time.

> **Status:** All 5 phases shipped. App is in active use. Backend migrated to
> USD-native totals (post-fix), IVA 16% included in `precio_venta`. The 6-tab
> shell (Home / Ventas / Inventario / Alertas / Reportes / Órdenes) is live.

---

## Stack

| Layer | Choice |
|-------|--------|
| Framework | React Native 0.76.9 + Expo SDK 52 + TypeScript |
| Navigation | Expo Router v4 (file-based) |
| Backend | Supabase (Postgres + Auth + Realtime + Storage + Edge Functions) |
| Data fetching | TanStack Query v5 (`useQuery`, `useInfiniteQuery`, `useMutation`) |
| State | Zustand (UI / draft change orders) |
| Lists | `@shopify/flash-list` (virtualized — required for the 7,200-product inventory) |
| Images | `expo-image` (NOT `react-native` Image) |
| Charts | `react-native-gifted-charts` + custom `SparklineChart` (svg) |
| PDF | `expo-print` + `expo-sharing` |
| Fonts | `@expo-google-fonts/jetbrains-mono` (400 / 500 / 700) |
| AI anomalies | Gemini Flash 1.5 via Supabase Edge Function (never called from the client) |
| Icons | `@expo/vector-icons` — Feather set |
| Press feedback | `Pressable` everywhere — **never** `TouchableOpacity` |

---

## Brand Tokens — El Serrucho

```ts
// src/theme/brands/el-serrucho.ts
export const elSerrucho = {
  id:      'el-serrucho',
  appName: 'El Serrucho to GO',
  colors: {
    bg:           '#0C0C0C',
    surface:      '#161616',
    surfaceAlt:   '#1E1E1E',
    border:       '#2C2C2C',
    primary:      '#F5B200',   // gold — saw blade from logo
    primaryDim:   '#C48E00',
    primaryFaded: 'rgba(245,178,0,0.12)',
    text:         '#FFFFFF',
    textMuted:    '#888888',
    textDim:      '#444444',
    danger:       '#FF5252',
    warning:      '#FF9800',
    success:      '#4CAF50',
    onPrimary:    '#0C0C0C',   // black text ON gold backgrounds
  },
  currency: { symbol: '$', decimals: 2 }, // USD ONLY — no Bs anywhere
};
```

**CRITICAL CURRENCY RULE**: Every monetary value shows **USD ($)**. No Bolívares,
no dual display. The `tazas` table exists for internal calculations only —
never render it. The backend already converts VES → USD using
`THT_FACTORREFERENCIAL` (per-sale rate from the POS).

**IVA 16% RULE**: `productos.precio_venta` includes IVA. When comparing against
`costo` (which is ex-IVA), always divide by 1.16 first. See `getMarginPct()` in
`ProductRow.tsx` and the `MarginBar` component.

---

## Navigation — 6 Tabs in a Floating Pill

`app/(tabs)/_layout.tsx` mounts a custom `FloatingTabBar` (gold circle on
active tab, no labels, sits ~18px above the bottom).

| # | Tab | Route | Notes |
|---|-----|-------|-------|
| 1 | Home | `app/(tabs)/index.tsx` | KPIs + sparkline + recent ventas |
| 2 | Ventas | `app/(tabs)/ventas.tsx` | Filtered list (Hoy/Ayer/Semana/Mes) + bottom-sheet detail modal |
| 3 | Inventario | `app/(tabs)/inventario.tsx` | FlashList of 7,200+ productos + search + filters |
| 4 | Alertas | `app/(tabs)/alertas.tsx` | Stock alerts + Gemini anomaly cards |
| 5 | Reportes | `app/(tabs)/reportes.tsx` | Bar chart + donut + top productos · **admin only** |
| 6 | Órdenes | `app/(tabs)/ordenes.tsx` | Draft change orders + history + PDF export |

The **Reportes** tab is hidden for non-admin users (filtered in
`FloatingTabBar.tsx` via `useUserRole()`).

---

## Supabase Schema (production state)

### Base tables

```sql
-- READ-ONLY for the app — Python widget owns these
productos        (codigo_interno PK, descripcion, unidad, codigo_barras,
                  costo, precio_venta, existencia, actualizado_en)
clientes         (codigo_cliente PK, nombre, rif, telefono, direccion, created_at)
ventas           (id PK, documento, fecha_emision, rif_cliente, status,
                  total_neto, total_bruto, total_impuesto,    -- ALL USD post-fix
                  numero_control, created_at)
ventas_detalle   (id PK, documento, codigo_producto, cantidad,
                  precio_venta,    -- USD at time of sale (uses THT_FACTORREFERENCIAL)
                  costo_str,       -- raw text, use safe_numeric()
                  venta_id FK, created_at)
tazas            (id PK, bcv_usd, bcv_eur, binance_p2p, tasa_promedio, nombre,
                  created_at)      -- internal only

-- APP-WRITABLE
anomalias              (id PK, codigo_producto, tipo, severidad, explicacion,
                        detectado_en, resuelto)
ordenes_cambio         (id PK, creado_por, nota, status, pdf_url, creado_en,
                        aprobacion_estado,   -- no_aplica|pendiente|aprobado|rechazado (migr. 026)
                        aprobado_por, aprobado_en, rechazo_motivo)
ordenes_cambio_items   (id PK, orden_id FK, codigo_producto, descripcion,
                        existencia_actual, nueva_existencia, delta GENERATED,
                        nota,
                        backend_status,      -- espera_aprobacion|pendiente|aplicando|completado|error|rechazado
                        backend_resultado, backend_intentos, backend_aplicado_en)
                       -- write-back de stock a HybridLite: migraciones 018/019/020,
                       -- gate de aprobación por rol 026/027/028,
                       -- contrato en docs/WRITEBACK-PIPELINE.md
profiles               (id PK = auth.users.id, role: 'admin' | 'superempleado' | 'empleado',
                        email, display_name, is_active, allowed_sid, updated_at)
                       -- roles write-back: admin/superempleado = write-back directo + compras;
                       -- empleado = solo ajustes, requieren aprobación (RPCs aprobar_orden/rechazar_orden)
comandos_remotos       (id PK, comando, executed, created_at)
                       -- queue for cloud → local sync triggering
```

Row counts (snapshot): productos 7,212 · ventas 25,480 · ventas_detalle 53,046 ·
clientes 2,678 · profiles 2.

### Views (all read-only, all live in `public`)

```
productos_view              -- productos + es_placeholder flag for ".", "..", short names
vw_ventas_items_usd         -- ventas_detalle joined with vd.precio_venta as USD source
vw_ventas_detalle_usd       -- per-line item view consumed by useVentaDetalle
vw_ventas_usd               -- vw_ventas_items_usd → per-venta totals (used by ventas tab)
vw_profit_daily             -- 90-day profit grain
vw_profit_hourly            -- 24h grain for SparklineChart
vw_profit_monthly           -- 12-month grain for Reportes
vw_profit_summary           -- KPI cards
vw_dashboard_stats          -- main KPI card source (hoy/ayer/semana/mes + ticket_promedio)
vw_top_productos            -- top 20 by revenue (30 days)
vw_velocidad_productos      -- rapido/lento/sin_movimiento (DonutChart)
vw_alertas_stock            -- sin_stock | stock_negativo | margen_negativo | stock_muerto
vw_ticket_promedio          -- AVG total_neto current month
```

> **`vw_alertas_stock` margen_negativo rule** uses `costo > precio_venta / 1.16`
> (IVA-aware). Migrations 001–008 are in `supabase/migrations/`.

### RLS

All tables have RLS enabled.
- `productos`, `ventas`, `ventas_detalle`, `clientes`, `tazas`, `anomalias`,
  `vw_*` → `auth_read` for `authenticated`.
- `ordenes_cambio` / `ordenes_cambio_items` → active employees read all, write own;
  admins delete all. Aprobación de ajustes de empleados vía RPCs `aprobar_orden` /
  `rechazar_orden` (SECURITY DEFINER, exigen `is_privileged()`).
- `compras_app` / `compras_app_items` → escritura solo `is_privileged()`
  (admin/superempleado); lectura para empleados activos.
- `comandos_remotos` → `auth_insert` + `auth_read` for authenticated.
- `profiles` → owner RW + admins update any (asignar roles). Trigger
  `fn_protect_profile_privileges` impide que un no-admin cambie su `role`/`is_active`.
- Helpers: `is_admin()`, `is_privileged()` (admin|superempleado activo),
  `is_active_employee()`, `validate_session()`.

---

## Folder Structure (current)

```
el-serrucho-go/
├── app/
│   ├── (auth)/
│   │   └── login.tsx
│   ├── (tabs)/
│   │   ├── _layout.tsx          ← Tabs + FloatingTabBar
│   │   ├── index.tsx            ← Dashboard (KPIs, sparkline, recent ventas)
│   │   ├── ventas.tsx           ← Ventas list + detail modal
│   │   ├── inventario.tsx       ← FlashList + search + filters
│   │   ├── alertas.tsx
│   │   ├── reportes.tsx         ← admin only
│   │   └── ordenes.tsx
│   ├── producto/[id].tsx        ← Detail view + add-to-draft sheet
│   ├── perfil.tsx
│   ├── +not-found.tsx
│   ├── index.tsx
│   └── _layout.tsx              ← Auth guard + QueryClient + Theme + Fonts
├── src/
│   ├── theme/
│   │   ├── tokens.ts
│   │   ├── ThemeContext.tsx     ← provides colors, tokens, formatUSD
│   │   └── brands/el-serrucho.ts
│   ├── lib/
│   │   └── supabase.ts          ← client + ALL types + date helpers
│   ├── hooks/
│   │   ├── useProductos.ts      ← infinite list + realtime + isPlaceholder()
│   │   ├── useProfitSummary.ts  ← summary + daily + monthly + hourly
│   │   ├── useVentasHoy.ts      ← useVentasPeriod('hoy'|'ayer'|'semana'|'mes')
│   │   ├── useVentaDetalle.ts   ← per-venta line items in USD
│   │   ├── useTopProductos.ts
│   │   ├── useVelocidad.ts
│   │   ├── useAlertas.ts
│   │   ├── useOrdenCambio.ts    ← Zustand store for draft order builder
│   │   ├── useOrdenesHistory.ts
│   │   ├── useSyncStatus.ts     ← MAX(actualizado_en) + dual-path triggerSync
│   │   └── useUserRole.ts
│   ├── components/
│   │   ├── FloatingTabBar.tsx
│   │   ├── SyncBadge.tsx        ← pill + animated dot, sync button (3 modes)
│   │   ├── StatCard.tsx
│   │   ├── ProductRow.tsx       ← memoized, dispatcher pattern, IVA-aware margin
│   │   ├── AlertCard.tsx        ← StockAlertCard + AnomaliaCard
│   │   ├── CurrencyText.tsx
│   │   ├── GananciaChart.tsx
│   │   ├── DonutChart.tsx
│   │   └── SparklineChart.tsx   ← 24h hourly trend on dashboard
│   ├── constants/
│   └── assets/
│       └── img/
│           └── EL SERRUCHO go.png
├── supabase/
│   ├── migrations/
│   │   ├── 001_helper_fn.sql        ← safe_numeric()
│   │   ├── 002_views.sql
│   │   ├── 003_new_tables.sql
│   │   ├── 004_rls.sql
│   │   ├── 005_edge_fn_rpc.sql
│   │   ├── 006_anomalias_unique.sql
│   │   ├── 007_fixup_constraints.sql
│   │   └── 008_delta_trigger.sql
│   └── functions/
│       └── detect-anomalies/
│           └── index.ts             ← Gemini Flash 1.5 anomaly detector
├── contexts mds/                    ← reference docs from backend team
│   ├── API-SYNC-GUIDE.md
│   ├── ARCHITECTURE.md
│   ├── README widget.md
│   ├── REMOTE-CONTROL-SETUP.md
│   ├── SOLUTION-PRICE.md            ← IVA 16% in precio_venta context
│   └── SOLUTION-SALES.md            ← USD totals migration
├── DIAGNOSTICO_SINCRONIZACION.md
├── CONTEXT_SESION.md
└── ...standard config (app.json, babel.config.js, tsconfig.json, etc.)
```

---

## Sync Architecture (dual-path)

`useSyncStatus.triggerSync(mode)` tries the local widget API first, falls back
to the cloud queue on failure:

1. **Path 1 — local API** (same WiFi, instant)
   `POST http://192.168.1.143:5000/api/v1/sync/{inventory|sales|run}` with a
   3-second `AbortController` timeout.
2. **Path 2 — cloud queue** (any network)
   `INSERT INTO comandos_remotos { comando: <mode> }`. The widget polls this
   table and executes when it next sees the network.

Modes: `'sync_inventory' | 'sync_sales' | 'sync_all'`. Default is
`'sync_inventory'` (used by the SyncBadge button).

The badge state is computed from `MAX(productos.actualizado_en)`:
`< 30 min` green · `30 min – 2 h` yellow · `> 2 h` red.

---

## Data Conventions

- **`ventas.status = 1`** is the only valid status — every view filters on this.
- **`vd.precio_venta`** is already USD post-fix (uses `THT_FACTORREFERENCIAL`
  from the POS at sale time). Do not multiply by `tazas` rates.
- **`productos.precio_venta`** is current-day price *with IVA 16%*. For
  margin/comparison-with-`costo`, divide by 1.16.
- **`ventas_detalle.costo_str`** is raw POS text (commas, "Bs." prefixes, …).
  Always use `safe_numeric(costo_str)` in SQL — **never** cast in JS.
- **`isPlaceholder(p)`** — products with names like `"."`, `".."`, `"..."`
  (POS placeholders) get pushed to the bottom of the inventory list and
  rendered with low opacity / non-interactive.
- **`Producto.es_placeholder`** flag comes from `productos_view`, used for
  server-side ordering (placeholders last).

---

## Performance Patterns (already enforced)

- **FlashList** for the 7,200-row inventory with `estimatedItemSize={84}`.
- **`React.memo` + custom comparator** on `ProductRow` (only re-renders if
  `codigo_interno`, `existencia`, `precio_venta`, `costo`, `descripcion`, or
  `onPress` changes).
- **Dispatcher pattern** for list item callbacks: `onPress: (codigo: string) =>
  void` — the parent's `handlePress` is `useCallback`-stable, so memoized rows
  don't re-render when the parent re-renders.
- **`useInfiniteQuery`** for paginated inventory (50/page) + Supabase Realtime
  invalidates the whole `['productos']` key on any change.
- **`useQuery` `staleTime` and `refetchInterval`** sized per resource:
  - dashboard summary: 5 min stale / 10 min refetch
  - ventas lists: 30 s stale / 60 s refetch
  - profit hourly: 5 min stale (24-bucket fill on the client)

---

## Key Rules for Claude Code

1. **Never write to `productos`, `ventas`, `ventas_detalle`, `clientes`,
   or `tazas`** — read-only.
2. **All money in the UI is USD (`$`)**. Use `formatUSD` from `useTheme()`.
3. **`costo_str` is TEXT** — always `safe_numeric()` in SQL.
4. **`ventas.status = 1`** filter is mandatory in any new view/query.
5. **SyncBadge** reads `MAX(productos.actualizado_en)` — green/yellow/red.
6. **FloatingTabBar** is custom; admin-gated tabs (Reportes) filter via
   `useUserRole()`.
7. **Language** — Spanish UI, English code/comments OK.
8. **Theme tokens only** — every color via `useTheme()`. No hardcoded hex in
   components.
9. **`Pressable`, never `TouchableOpacity`.** Use the `({ pressed }) => [...]`
   style-function form for press feedback.
10. **`expo-image`, never `react-native` `Image`** for any asset.
11. **IVA 16% on `precio_venta`** — divide by 1.16 before comparing with `costo`.
12. **Edge Functions** — only the backend / cron calls them. Never invoke from
    the client unless specifically authorized (current example: `detect-anomalies`
    is invoked from the Alertas screen via `supabase.functions.invoke`, gated
    behind a button).
13. **Code Simplification**: Proactively and always apply the `code-simplifier` skill to any written or modified code. Refine for clarity, ES module syntax, explicit Props and return types, no nested ternaries, and standard function declarations, preserving exact original functionality.

---

## Environment Variables

`.env.local`:
```
EXPO_PUBLIC_SUPABASE_URL=https://<ref>.supabase.co
EXPO_PUBLIC_SUPABASE_ANON_KEY=<anon>
EXPO_PUBLIC_WIDGET_API_URL=http://192.168.1.143:5000   # local widget (optional)
```

Project ref and credentials live in
`C:\Users\gusta\.claude\projects\G--Projects-el-serrucho-go\memory\project_supabase.md`.

---

## Running the Dev Server

> **Don't run Metro inside Warp or Claude Code's terminal** — they intercept
> stdin so `r`, `Ctrl+C`, `a` won't work. Use **Windows Terminal** (cmd /
> PowerShell):
>
> ```cmd
> cd G:\Projects\el-serrucho-go
> npx expo start
> ```

The 16KB ELF-alignment warning on x86_64 Android emulators is from Expo Go's
own native libs — not fixable in app code. "Don't Show Again" or use a
physical device / development build.

---

## Gemini Edge Function

```typescript
// supabase/functions/detect-anomalies/index.ts
const SYSTEM_PROMPT = `
You are analyzing inventory data for a Venezuelan hardware store running the
Hybrid POS system. Stock is synchronized from local .dat files via a Python
file-watcher widget. All prices are in USD.

For each product, determine if the current stock level is plausible given its
30-day sales velocity. Flag: sync failures, data entry errors, theft, or dead
stock. Respond ONLY with JSON: { "suspicious": boolean, "reason": string|null }
`;
```

Returns `{ checked, flagged }`. Inserted anomalies show up in
`anomalias` and render via `AnomaliaCard`.
