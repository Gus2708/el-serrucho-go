# El Serrucho to GO — Claude Code Context

Mobile inventory app for Ferretería El Serrucho (Venezuelan hardware store).
Built in React Native / Expo. Backend is Supabase. Data comes from a Python
widget that watches Hybrid POS `.dat` files and syncs to Supabase in real time.

---

## Stack

| Layer | Choice |
|-------|--------|
| Framework | React Native + Expo SDK 52 + TypeScript |
| Navigation | Expo Router v3 (file-based) |
| Backend | Supabase (Postgres + Auth + Realtime + Storage) |
| Data fetching | TanStack Query v5 |
| State | Zustand (UI / draft change orders) |
| Charts | react-native-gifted-charts |
| PDF | expo-print + expo-sharing |
| AI anomalies | Gemini Flash 1.5 via Supabase Edge Function (never called from app) |
| Icons | @expo/vector-icons — Feather set |

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

**CRITICAL CURRENCY RULE**: Every monetary value in the app shows USD ($).
No Bolívares, no dual display. The `tazas` table exists in Supabase for
internal calculations only — never render it to the user.

---

## Navigation — Floating Pill Navbar

The tab bar is a floating dark pill with a filled gold circle on the active tab.
No labels, icons only. Sits 18px above the bottom of the screen.
See `src/components/FloatingTabBar.tsx` for the implementation.

Tabs (in order):
1. Home (ti-home) → `app/(tabs)/index.tsx`
2. Inventario (package) → `app/(tabs)/inventario.tsx`
3. Alertas (bell-ringing) → `app/(tabs)/alertas.tsx`
4. Reportes (chart-bar) → `app/(tabs)/reportes.tsx`
5. Órdenes (file-text) → `app/(tabs)/ordenes.tsx`

---

## SyncBadge — Preferred Style

Small pill, surface background, animated green dot, single inline line:

```tsx
// States based on MAX(productos.actualizado_en)
// < 30 min  → green dot  "Sincronizado hace X min · Hybrid widget activo"
// 30m–2h   → yellow dot "Sincronización demorada · hace X min"
// > 2h     → red dot    "Widget sin actividad · hace Xh"
```

---

## Supabase DB Schema — Confirmed Column Names

### Read-only tables (Python widget writes these — app NEVER writes here)

```sql
productos (
  codigo_interno   text PRIMARY KEY,
  descripcion      text,
  unidad           text,
  codigo_barras    text,
  costo            numeric,       -- in USD
  precio_venta     numeric,       -- in USD
  existencia       numeric,
  actualizado_en   timestamptz    -- widget last sync time
)

clientes (
  codigo_cliente   text PRIMARY KEY,
  nombre           text,
  rif              text,
  telefono         text,
  direccion        text,
  created_at       timestamptz
)

ventas (
  id               int8 PRIMARY KEY,
  documento        text,
  fecha_emision    date,
  rif_cliente      text,          -- joins to clientes.rif
  total_neto       numeric,
  total_impuesto   numeric,
  status           int4,          -- 1 = valid/paid, others = cancelled
  numero_control   text,
  created_at       timestamptz
)

ventas_detalle (
  id               int8 PRIMARY KEY,
  documento        text,
  codigo_producto  text,          -- joins to productos.codigo_interno
  cantidad         numeric,
  precio_venta     numeric,       -- USD at time of sale
  costo_str        text,          -- RAW from Hybrid .dat — use safe_numeric()
  created_at       timestamptz,
  venta_id         int8           -- FK to ventas.id
)

tazas (
  id               int8 PRIMARY KEY,
  bcv_usd          numeric,
  bcv_eur          numeric,
  binance_p2p      numeric,
  tasa_promedio    numeric,
  nombre           text UNIQUE,
  created_at       timestamptz
)
-- tazas is for internal calculations only — never shown in UI
```

### App-writable tables

```sql
anomalias (
  id               bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  codigo_producto  text REFERENCES productos(codigo_interno),
  tipo             text NOT NULL,
  severidad        text NOT NULL CHECK (severidad IN ('alta','media','baja')),
  explicacion      text,
  detectado_en     timestamptz DEFAULT now(),
  resuelto         boolean DEFAULT false
)

ordenes_cambio (
  id               bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  creado_por       uuid REFERENCES auth.users(id),
  nota             text,
  status           text DEFAULT 'borrador' CHECK (status IN ('borrador','emitido')),
  pdf_url          text,
  creado_en        timestamptz DEFAULT now()
)

ordenes_cambio_items (
  id                  bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  orden_id            bigint REFERENCES ordenes_cambio(id) ON DELETE CASCADE,
  codigo_producto     text NOT NULL,
  descripcion         text,
  existencia_actual   numeric,
  nueva_existencia    numeric NOT NULL,
  delta               numeric GENERATED ALWAYS AS (nueva_existencia - existencia_actual) STORED,
  nota                text
)
```

---

## SQL Views & Helper Function (apply to Supabase before coding)

```sql
-- Cleans Hybrid's text costs: "1,50" → 1.50, "Bs.2.00" → 2.00
CREATE OR REPLACE FUNCTION safe_numeric(v text)
RETURNS numeric LANGUAGE plpgsql IMMUTABLE AS $$
BEGIN
  RETURN CAST(REPLACE(REPLACE(REPLACE(v, ',', '.'), ' ', ''), 'Bs.', '') AS numeric);
EXCEPTION WHEN OTHERS THEN RETURN 0;
END;
$$;

-- Profit by day (last 90 days)
CREATE OR REPLACE VIEW vw_profit_daily AS
SELECT
  v.fecha_emision                                            AS dia,
  COUNT(DISTINCT v.id)                                       AS num_ventas,
  SUM(vd.cantidad * vd.precio_venta)                         AS ingreso_bruto,
  SUM(vd.cantidad * safe_numeric(vd.costo_str))              AS costo_total,
  SUM(vd.cantidad * vd.precio_venta)
    - SUM(vd.cantidad * safe_numeric(vd.costo_str))          AS ganancia
FROM ventas v
JOIN ventas_detalle vd ON vd.venta_id = v.id
WHERE v.status = 1
  AND v.fecha_emision >= current_date - interval '90 days'
GROUP BY v.fecha_emision ORDER BY dia DESC;

-- Summary KPI cards
CREATE OR REPLACE VIEW vw_profit_summary AS
WITH base AS (
  SELECT v.fecha_emision,
    vd.cantidad * vd.precio_venta                             AS ingreso,
    vd.cantidad * safe_numeric(vd.costo_str)                  AS costo
  FROM ventas v JOIN ventas_detalle vd ON vd.venta_id = v.id
  WHERE v.status = 1
)
SELECT
  COALESCE(SUM(ingreso-costo) FILTER (WHERE fecha_emision = current_date), 0)           AS ganancia_hoy,
  COALESCE(SUM(ingreso)       FILTER (WHERE fecha_emision = current_date), 0)           AS ingreso_hoy,
  COALESCE(SUM(ingreso-costo) FILTER (WHERE fecha_emision >= date_trunc('week',  current_date)), 0) AS ganancia_semana,
  COALESCE(SUM(ingreso-costo) FILTER (WHERE fecha_emision >= date_trunc('month', current_date)), 0) AS ganancia_mes,
  COALESCE(SUM(ingreso)       FILTER (WHERE fecha_emision >= date_trunc('month', current_date)), 0) AS ingreso_mes;

-- Top 20 products by revenue (30 days)
CREATE OR REPLACE VIEW vw_top_productos AS
SELECT
  vd.codigo_producto,
  COALESCE(p.descripcion, '[Producto eliminado]') AS descripcion,
  SUM(vd.cantidad)                                AS unidades_vendidas,
  SUM(vd.cantidad * vd.precio_venta)              AS ingreso,
  SUM(vd.cantidad * vd.precio_venta
    - vd.cantidad * safe_numeric(vd.costo_str))   AS ganancia
FROM ventas_detalle vd
JOIN ventas v        ON v.id = vd.venta_id AND v.status = 1
LEFT JOIN productos p ON p.codigo_interno = vd.codigo_producto
WHERE v.fecha_emision >= current_date - interval '30 days'
GROUP BY vd.codigo_producto, p.descripcion
ORDER BY ingreso DESC LIMIT 20;

-- Fast / slow / no-movement movers
CREATE OR REPLACE VIEW vw_velocidad_productos AS
SELECT
  p.codigo_interno, p.descripcion, p.existencia,
  COALESCE(SUM(vd.cantidad), 0)                  AS vendido_30d,
  CASE
    WHEN COALESCE(SUM(vd.cantidad), 0) > 10 THEN 'rapido'
    WHEN COALESCE(SUM(vd.cantidad), 0) > 0  THEN 'lento'
    ELSE 'sin_movimiento'
  END AS velocidad
FROM productos p
LEFT JOIN ventas_detalle vd ON vd.codigo_producto = p.codigo_interno
LEFT JOIN ventas v ON v.id = vd.venta_id AND v.status = 1
  AND v.fecha_emision >= current_date - interval '30 days'
GROUP BY p.codigo_interno, p.descripcion, p.existencia;

-- Stock alerts (deterministic rules)
CREATE OR REPLACE VIEW vw_alertas_stock AS
SELECT
  p.codigo_interno, p.descripcion, p.existencia, p.costo, p.precio_venta,
  CASE
    WHEN p.existencia <= 0        THEN 'sin_stock'
    WHEN p.costo > p.precio_venta THEN 'margen_negativo'
    ELSE                               'stock_muerto'
  END AS tipo_alerta
FROM productos p
WHERE p.existencia <= 0
   OR p.costo > p.precio_venta
   OR (p.existencia > 0 AND NOT EXISTS (
     SELECT 1 FROM ventas_detalle vd2
     JOIN ventas v2 ON v2.id = vd2.venta_id AND v2.status = 1
     WHERE vd2.codigo_producto = p.codigo_interno
       AND v2.fecha_emision >= current_date - interval '90 days'
   ));

-- Average ticket current month
CREATE OR REPLACE VIEW vw_ticket_promedio AS
SELECT
  ROUND(AVG(v.total_neto), 2) AS ticket_promedio,
  COUNT(v.id)                  AS ventas_mes
FROM ventas v
WHERE v.status = 1
  AND v.fecha_emision >= date_trunc('month', current_date);
```

---

## RLS Policies

```sql
ALTER TABLE productos            ENABLE ROW LEVEL SECURITY;
ALTER TABLE ventas               ENABLE ROW LEVEL SECURITY;
ALTER TABLE ventas_detalle       ENABLE ROW LEVEL SECURITY;
ALTER TABLE clientes             ENABLE ROW LEVEL SECURITY;
ALTER TABLE tazas                ENABLE ROW LEVEL SECURITY;
ALTER TABLE anomalias            ENABLE ROW LEVEL SECURITY;
ALTER TABLE ordenes_cambio       ENABLE ROW LEVEL SECURITY;
ALTER TABLE ordenes_cambio_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "auth_read" ON productos            FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth_read" ON ventas               FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth_read" ON ventas_detalle       FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth_read" ON clientes             FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth_read" ON tazas                FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth_read" ON anomalias            FOR SELECT TO authenticated USING (true);

CREATE POLICY "owner_all" ON ordenes_cambio
  FOR ALL TO authenticated
  USING (creado_por = auth.uid()) WITH CHECK (creado_por = auth.uid());

CREATE POLICY "owner_items" ON ordenes_cambio_items
  FOR ALL TO authenticated
  USING (orden_id IN (SELECT id FROM ordenes_cambio WHERE creado_por = auth.uid()));
```

---

## Folder Structure

```
el-serrucho-go/
├── app/
│   ├── (auth)/
│   │   └── login.tsx
│   ├── (tabs)/
│   │   ├── _layout.tsx          ← FloatingTabBar lives here
│   │   ├── index.tsx            ← Dashboard
│   │   ├── inventario.tsx
│   │   ├── alertas.tsx
│   │   ├── reportes.tsx
│   │   └── ordenes.tsx
│   ├── producto/[id].tsx
│   └── _layout.tsx              ← Root: auth guard
├── src/
│   ├── theme/
│   │   ├── tokens.ts            ← spacing, radius, fontSize (never change)
│   │   ├── ThemeContext.tsx
│   │   └── brands/
│   │       └── el-serrucho.ts   ← ACTIVE BRAND
│   ├── lib/
│   │   └── supabase.ts          ← createClient singleton
│   ├── hooks/
│   │   ├── useProfitSummary.ts  ← vw_profit_summary
│   │   ├── useProfitDaily.ts    ← vw_profit_daily (chart data)
│   │   ├── useProductos.ts      ← productos + search + realtime
│   │   ├── useAlertas.ts        ← vw_alertas_stock + anomalias
│   │   ├── useOrdenCambio.ts    ← Zustand store for draft orders
│   │   └── useSyncStatus.ts     ← reads MAX(actualizado_en)
│   └── components/
│       ├── FloatingTabBar.tsx
│       ├── SyncBadge.tsx        ← pill + animated dot, 3 states
│       ├── StatCard.tsx
│       ├── ProductRow.tsx
│       ├── AlertCard.tsx
│       ├── CurrencyText.tsx     ← always $ USD
│       ├── GananciaChart.tsx    ← area chart (react-native-gifted-charts)
│       └── DonutChart.tsx
├── supabase/
│   ├── migrations/
│   │   ├── 001_helper_fn.sql
│   │   ├── 002_views.sql
│   │   ├── 003_new_tables.sql
│   │   └── 004_rls.sql
│   └── functions/
│       └── detect-anomalies/
│           └── index.ts         ← Gemini Flash Edge Function
└── assets/
    └── brands/
        └── el-serrucho/
            └── logo.png         ← gold saw blade logo
```

---

## Build Phases

### Phase 1 — Foundation (start here)
1. `npx create-expo-app el-serrucho-go --template blank-typescript`
2. Install deps (see below)
3. `src/theme/` — tokens + el-serrucho brand + ThemeContext
4. `src/lib/supabase.ts` — client singleton using env vars
5. `app/(auth)/login.tsx` — functional Supabase Auth login
6. `app/(tabs)/_layout.tsx` — FloatingTabBar shell
7. `src/components/SyncBadge.tsx`

### Phase 2 — Inventario
1. `src/hooks/useProductos.ts` with search + Realtime subscription
2. `app/(tabs)/inventario.tsx`
3. `app/producto/[id].tsx`
4. `src/components/ProductRow.tsx`

### Phase 3 — Dashboard + Reportes
1. Apply all SQL views to Supabase
2. `src/hooks/useProfitSummary.ts` + `useProfitDaily.ts`
3. `app/(tabs)/index.tsx` (Dashboard)
4. `app/(tabs)/reportes.tsx`
5. `src/components/GananciaChart.tsx` + `DonutChart.tsx`

### Phase 4 — Alertas + Gemini
1. `src/hooks/useAlertas.ts`
2. `app/(tabs)/alertas.tsx`
3. `supabase/functions/detect-anomalies/index.ts`
4. pg_cron schedule (every 2h)

### Phase 5 — Change Orders + PDF
1. Zustand store for draft orders
2. `app/(tabs)/ordenes.tsx` (builder + history)
3. HTML PDF template (branded, El Serrucho logo)
4. `expo-print` + `expo-sharing`
5. Supabase Storage upload

---

## Dependencies to Install

```bash
npx expo install expo-router expo-linking expo-constants expo-status-bar \
  react-native-safe-area-context react-native-screens

npx expo install @supabase/supabase-js @react-native-async-storage/async-storage \
  react-native-url-polyfill

npx expo install @tanstack/react-query zustand

npx expo install react-native-gifted-charts react-native-svg \
  react-native-linear-gradient

npx expo install expo-print expo-sharing expo-file-system

npx expo install @expo/vector-icons
```

---

## Environment Variables

Create `.env.local`:
```
EXPO_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
EXPO_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
```

---

## Key Rules for Claude Code

1. **Never write to `productos`, `ventas`, `ventas_detalle`, `clientes`, or `tazas`** — read only
2. **All money = USD (`$`)** — never render Bs or use `tazas` in UI
3. **`costo_str` is TEXT** — always use `safe_numeric()` in SQL, never cast in app JS
4. **`ventas.status = 1`** is the only valid/paid status — filter everything else out
5. **SyncBadge** reads `MAX(productos.actualizado_en)` — 3 color states (green/yellow/red)
6. **FloatingTabBar** — pill shape, gold circle on active, no labels, `bottom: 18`
7. **Language** — Spanish throughout (UI strings, comments in code can be English)
8. **White-label ready** — every color via `useTheme()`, never hardcoded hex in components

---

## Gemini Edge Function Context

```typescript
const SYSTEM_PROMPT = `
You are analyzing inventory data for a Venezuelan hardware store running the 
Hybrid POS system. Stock is synchronized from local .dat files via a Python 
file-watcher widget. All prices are in USD.

For each product, determine if the current stock level is plausible given its 
30-day sales velocity. Flag: sync failures, data entry errors, theft, or dead 
stock. Respond ONLY with JSON: { "suspicious": boolean, "reason": string | null }
`;
```
