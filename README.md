# El Serrucho GO

![Expo](https://img.shields.io/badge/Expo-53-000020?style=for-the-badge&logo=expo&logoColor=white)
![React Native](https://img.shields.io/badge/React_Native-0.79-61DAFB?style=for-the-badge&logo=react&logoColor=black)
![Supabase](https://img.shields.io/badge/Supabase-Database-3ECF8E?style=for-the-badge&logo=supabase&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-5.8-3178C6?style=for-the-badge&logo=typescript&logoColor=white)
![PWA](https://img.shields.io/badge/PWA-Vercel-000000?style=for-the-badge&logo=vercel&logoColor=white)

**El Serrucho GO** is a premium mobile dashboard for real-time inventory management and sales analytics for *Ferretería El Serrucho*. Built with a focus on performance, design quality, and robust data synchronization with an on-premise POS system.

It ships as an **Android app (EAS)** and as an **installable PWA** (Vercel) that shares the same codebase via `react-native-web`.

---

## Table of Contents

- [Key Features](#key-features)
- [Tech Stack](#tech-stack)
- [Project Structure](#project-structure)
- [Database Architecture](#database-architecture--writeback-pipeline)
- [Getting Started](#getting-started)
- [Architecture Decisions](#architecture--decisions)
- [Changelog](#changelog)

---

## Key Features
| Feature | Description |
|---|---|
| **Real-time Analytics** | Daily sales trends, profit summaries, and top-selling product rankings |
| **Hybrid Writeback Engine** | Bi-directional synchronization bridging Supabase with local POS (HybridLite) via Python hardware automation (`SendInput`) |
| **Role Approval Gates** | Three-tier security model (Admin, Super-employee, Employee) with approval workflows for stock adjustments and purchase queues |
| **RBAC** | Role-based access for Administrators and Employees with tailored interfaces, plus single-session enforcement |
| **Órdenes Hub** | One tab, seven work areas: Ajuste · Aprobaciones · Presupuesto · Compras · Directorio · Fallas · Historial |
| **Quotes & Orders** | Build quotes (`presupuestos`), convert them into POS orders, with manual per-item pricing |
| **Unfinished Drafts** | Purchases and orders can be parked mid-build and resumed later (`borradores`) |
| **Barcode Scanning** | Native camera scanner (`expo-camera`) with a ZXing-based fallback on web |
| **Interactive Charts** | Dynamic sparklines and donut charts for financial health tracking |
| **Smart Alerts & Zelle** | Instant Zelle payment push notifications (MS Graph API) & Gemini AI anomaly detection |
| **Push Notifications** | Expo Notifications over FCM V1, dispatched from the `send-push` Edge Function |
| **State Persistence** | Global search, filters, and scroll offsets preserved across navigation (Zustand) |
| **Responsive UI** | `scaleFont` dynamic scaling, plus a desktop sidebar layout on wide web viewports |
| **PDF Export** | Professional report generation for invoices, change orders, quotes, and inventory lists |
| **Engram Persistent Memory** | AI Agent session context and architectural memory persistence via Engram MCP server |

---

## Tech Stack

### Frontend
- **Framework**: [Expo SDK 53](https://expo.dev/) (React Native 0.79, React 19, New Architecture)
- **Navigation**: [Expo Router](https://docs.expo.dev/router/introduction/) — file-based routing with typed routes
- **State Management**: [Zustand](https://github.com/pmndrs/zustand) + [React Query (TanStack)](https://tanstack.com/query/latest) with AsyncStorage persistence
- **Charts**: `react-native-gifted-charts`, `react-native-svg`
- **Lists**: `@shopify/flash-list`
- **Web/PWA**: `react-native-web`, custom `service-worker.js` + `manifest.webmanifest`, deployed on Vercel
- **Testing**: Jest (`babel-preset-expo`) + `@testing-library/react-native`

### Backend
- **Platform**: [Supabase](https://supabase.com/)
- **Database**: PostgreSQL with Row Level Security (RLS) & Approval RPCs
- **Realtime**: Supabase Realtime for instant dashboard & writeback status chips updates
- **Serverless**: Edge Functions (`send-push`, `detect-anomalies`)
- **Agent Memory**: [Engram](https://github.com/Gentleman-Programming/engram) persistent memory engine

---

## Project Structure

```text
.
├── app/                          # Expo Router screens (file-based routing)
│   ├── (auth)/
│   │   ├── login.tsx             # Secure login screen
│   │   ├── pending.tsx           # Account awaiting admin activation
│   │   └── kicked.tsx            # Session revoked by a newer login
│   ├── (tabs)/
│   │   ├── _layout.tsx           # FloatingTabBar (mobile) / Sidebar (desktop web)
│   │   ├── index.tsx             # Dashboard — KPI cards, sparklines, recent sales
│   │   ├── ventas.tsx            # Real-time sales viewer & detail sheet
│   │   ├── inventario.tsx        # Virtualized inventory (7,650 products)
│   │   ├── notificaciones.tsx    # Attention queue, help requests & Zelle spoof alerts
│   │   ├── reportes.tsx          # Admin financial charts & product velocity
│   │   └── ordenes.tsx           # Órdenes hub — 7 sub-tabs (see below)
│   ├── producto/[id].tsx         # Product detail & dynamic order controller
│   ├── seleccionar-productos.tsx # Product picker shared by every builder
│   ├── seleccionar-cliente.tsx   # Directory selector for quotes & orders
│   ├── pagos.tsx                 # Real-time Zelle payment verification list
│   ├── solicitudes.tsx           # Out-of-stock / help request inbox
│   ├── admin-usuarios.tsx        # Role & activation management (admin only)
│   ├── perfil.tsx                # Session info, role, and logout
│   ├── _layout.tsx               # Global providers (QueryClient, AuthGuard, Fonts)
│   ├── +html.tsx                 # Web document shell (PWA meta & manifest)
│   └── +not-found.tsx            # 404 fallback route
├── src/
│   ├── components/               # UI components
│   │   ├── PresupuestoView.tsx   # Quote builder
│   │   ├── ComprasView.tsx       # Merchandise reception view
│   │   ├── PedidosView.tsx       # POS order entry view
│   │   ├── DirectorioView.tsx    # Customer/Supplier directory management
│   │   ├── AprobacionesView.tsx  # Role gate approval inbox
│   │   ├── BorradoresView.tsx    # Parked (unfinished) purchases & orders
│   │   ├── FallasView.tsx        # Business failure log
│   │   ├── Sidebar.tsx           # Desktop-web navigation rail
│   │   ├── PressableScale.tsx    # Motion primitives (see src/theme/motion.ts)
│   │   └── ...                   # SparklineChart, SyncBadge, StatCard, etc.
│   ├── hooks/                    # React Query & Zustand state hooks
│   │   ├── useOrdenCambio.ts     # Stock/Price/Cost/Ficha change order emitter
│   │   ├── useAprobaciones.ts    # Role gate approval inbox & RPC triggers
│   │   ├── useBorradores.ts      # Draft persistence for purchases & orders
│   │   ├── useRegistrosDirectorio.ts # Client/Supplier writeback queue hook
│   │   ├── useRealtimeSync.ts    # Debounced Supabase Realtime orchestrator
│   │   ├── useSessionEnforcer.ts # Single-active-session guard
│   │   ├── usePagosZelle.ts      # Instant Zelle payment status hook
│   │   └── ...                   # useProductos, useUserRole, useCompra, etc.
│   ├── lib/
│   │   ├── supabase.ts           # Typed Supabase client
│   │   ├── retry.ts              # Cold-start fetch retry (PWA resume)
│   │   └── pdfStorage.ts         # Shared PDF upload helper
│   ├── utils/pdfGenerator.ts     # Print-safe PDF document builders
│   └── theme/
│       ├── motion.ts             # Duration/easing tokens
│       ├── responsive.ts         # scaleFont
│       └── brands/el-serrucho.ts # Gold palette, dark background, USD currency
├── docs/                         # Architecture contracts & pipeline specs
│   ├── WRITEBACK-PIPELINE.md     # Stock/Price writeback specification
│   ├── REGISTRO-DIRECTORIO-PIPELINE.md # Directory writeback specification
│   ├── PLAN-ZELLE-LISTENER.md    # MS Graph Zelle notification specification
│   └── CREDITOS.md               # Accounts-receivable ledger (separate app)
├── public/                       # PWA assets (manifest, service worker, icons)
├── supabase/
│   ├── migrations/               # PostgreSQL migration chain (001–043)
│   └── functions/                # Edge functions (send-push, detect-anomalies)
├── vercel.json                   # PWA rewrites + cache headers
├── PRODUCT.md                    # Product & interaction principles
└── .mcp.json                     # MCP server config (Supabase + Engram)
```

### Órdenes hub sub-tabs

| Sub-tab | Purpose | Access |
|---|---|---|
| **Ajuste** | Stock / price / cost / ficha change orders | All employees |
| **Aprobaciones** | Approve or reject employee-submitted adjustments | Privileged only |
| **Presupuesto** | Build quotes, export PDF, convert to POS order | All employees |
| **Compras** | Merchandise reception & supplier purchases | Privileged only |
| **Directorio** | Register clients & suppliers into HybridLite | All employees |
| **Fallas** | Business failure / incident log | All employees |
| **Historial** | Unified history across every document type | All employees |

---

## Database Architecture & Writeback Pipeline

The system features a **closed-loop bi-directional synchronization pipeline** connecting the cloud database with the local on-premise POS system (HybridLite).

### Writeback Flow Overview

```text
App (El Serrucho Go)                Supabase (PostgreSQL Queue)           Backend (Python Watchdog 24/7)
────────────────────                ───────────────────────────           ───────────────────────────────
1. Emit Change Order / Purchase  ─► Inserts row (backend_status='pendiente') ─► Sondeas queued rows via Service Key
2. Monitor Live Status Chips    ◄─ Emits Realtime updates (backend_status) ◄─ Executes SendInput hardware UI automation
3. Inventory Refreshed          ◄─ Sync-Engine reads DBISAM and updates catalog ◄─ Verifies commit in local DBISAM
```

### Supported Writeback Pipelines
1. **Stock / Price / Cost / Ficha (`ordenes_cambio_items`):** Emits stock deltas, price updates, costs, and product references. Emitted items follow the 3-state role approval gate before queueing.
2. **Purchases (`compras_app_items`):** Receives supplier inventory, automatically creating non-existent catalog items in HybridLite before recording the purchase.
3. **Customer Orders (`pedidos_app_items`):** Emits presales/delivery notes into HybridLite (`TPedidos.dat`) so cashiers can instantly retrieve and bill them without manual line entry. Supports manual per-item pricing.
4. **Directory Registration (`registro_clientes_app` / `registro_proveedores_app`):** Registers new clients and suppliers in HybridLite (`TClientes.Dat` / `TProveedores.Dat`) and populates their assigned IDs.
5. **Zelle Payment Alerts (`pagos_zelle`):** Monitors Bank of America notifications via MS Graph API, inserting records and firing push notifications & realtime sound alerts.

### Status Machine (`backend_status`)
- `espera_aprobacion` ➔ `pendiente` ➔ `aplicando` ➔ `completado` | `error` | `rechazado`

### Note on Créditos (migrations 041–043)

Migrations `041_creditos.sql`, `042_creditos_hardening.sql`, and `043_creditos_resolver_cuenta.sql` create the accounts-receivable ledger (`creditos_cuenta`, `creditos_movimiento`, `vw_creditos_*`). They live here because **this repo is the single source of truth for the Supabase schema**, but the UI is a **separate application** — El Serrucho GO deliberately ships no Créditos screens. See [docs/CREDITOS.md](docs/CREDITOS.md).

---

## Getting Started

### Prerequisites

- Node.js (latest LTS)
- Expo Go app (physical device) or Android/iOS emulator
- A Supabase project with migrations 001–043 applied
- Engram CLI (`engram`) installed for AI memory sync

### Environment Variables

Create a `.env.local` file at the root:

| Variable | Description |
|---|---|
| `EXPO_PUBLIC_SUPABASE_URL` | Your Supabase project URL |
| `EXPO_PUBLIC_SUPABASE_ANON_KEY` | Supabase anonymous (public) key |
| `EXPO_PUBLIC_WIDGET_API_URL` | *(Optional)* Local POS sync widget URL (e.g. `http://192.168.1.143:5000`) |

### Installation

```bash
git clone https://github.com/Gus2708/el-serrucho-go.git
cd el-serrucho-go
npm install
npm start
```

> Run Metro from **Windows Terminal**, not from an embedded agent/IDE terminal — those intercept stdin, so the `r` / `a` / `Ctrl+C` shortcuts stop working.

### Scripts

| Command | What it does |
|---|---|
| `npm start` | Expo dev server |
| `npm run web` | Dev server targeting the browser |
| `npm run build:web` | Static PWA export + `copy-public.js` (manifest & service worker) |
| `npm run build:apk` | EAS Android preview build |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run lint` | ESLint over `.ts` / `.tsx` |
| `npm test` | Jest suite (`pdfStorage`, `pdfGenerator`, `retry`) |

---

## Architecture & Decisions

- **Server-state first**: React Query handles all data fetching — caching, background sync, and debounced realtime revalidation (1.5s).
- **Hardware-Isolated Writeback**: Local backend operates an isolated instance of HybridLite using Win32 `SendInput` and hardware mutex locks (`Local\SerruchoBotMouseLock`).
- **Role Approval Gate**: Employees queue stock edits as `espera_aprobacion`; Admins/Super-employees approve via SECURITY DEFINER RPCs (`aprobar_orden`).
- **Single Active Session**: `useSessionEnforcer` pins a session id on `profiles.allowed_sid`; a newer login evicts the older device to `(auth)/kicked`.
- **PWA Cold-Start Resilience**: the first Supabase request after the app resumes from background can fail with a transient `Failed to fetch`; `withSupabaseRetry` in `src/lib/retry.ts` wraps document-emission flows.
- **Print-Safe PDFs**: keep-together blocks in `pdfGenerator.ts` use `display:block` — flex containers ignore `break-inside` when printing.
- **Adaptive Shell**: `useDeviceSize` swaps the mobile `FloatingTabBar` for a desktop `Sidebar` on wide web viewports; the tab set itself stays identical.
- **Engram Persistent Memory**: Architectural context and research logs stored locally in Engram DB (`~/.engram/engram.db`).

---

## Changelog

### v2.5 (Current)
- **Créditos split out**: the accounts-receivable ledger moved to its own app; only migrations 041–043 and `docs/CREDITOS.md` remain here as schema source of truth.
- **Drafts & Manual Pricing**: purchases and orders can be parked and resumed (`borradores`, migration 039); per-item manual price override for orders (migration 040).
- **Purchase Stock Compensation**: emitting a purchase now compensates pre-existing negative stock instead of stacking onto it.
- **Scroll Stability**: building long purchase/order lists no longer bounces the scroll position back to the top.
- **Print-Safe PDFs**: rows and totals no longer split across page breaks when printing.
- **Test Bootstrap**: Jest suite with coverage for `pdfStorage`, `pdfGenerator`, and `retry`, plus `typecheck` / `lint` scripts.

### v2.4
- **Full Writeback Integration**: Connected stock adjustments, prices, costs, purchases, customer orders, and directory registrations to HybridLite via SendInput Python automation.
- **Role Approval Inbox**: Dedicated approval flow for employee stock adjustments (`useAprobaciones.ts`).
- **Zelle Payment Notifications**: Integrated Microsoft Graph API watcher with Supabase push notifications & realtime audio feedback.
- **Engram MCP Support**: Added `.mcp.json` integration for persistent AI memory tracking.

### v2.3
- **Responsive UI**: Dynamic font scaling (`scaleFont`) and overflow handling for small screens.
- **Sync Indicators**: Real-time POS sync status badges based on last update timestamp.

---

<p align="center">
  Developed with care for <strong>Ferretería El Serrucho</strong>
</p>
