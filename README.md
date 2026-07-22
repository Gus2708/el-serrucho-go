# El Serrucho GO

![Expo](https://img.shields.io/badge/Expo-52.0-000020?style=for-the-badge&logo=expo&logoColor=white)
![React Native](https://img.shields.io/badge/React_Native-0.76-61DAFB?style=for-the-badge&logo=react&logoColor=black)
![Supabase](https://img.shields.io/badge/Supabase-Database-3ECF8E?style=for-the-badge&logo=supabase&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-5.3-3178C6?style=for-the-badge&logo=typescript&logoColor=white)

**El Serrucho GO** is a premium mobile dashboard for real-time inventory management and sales analytics for *Ferretería El Serrucho*. Built with a focus on performance, design quality, and robust data synchronization with an on-premise POS system.

---

## Table of Contents

- [Key Features](#key-features)
- [Tech Stack](#tech-stack)
- [Project Structure](#project-structure)
- [Database Architecture](#database-architecture--supabase-schema)
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
| **RBAC** | Role-based access for Administrators and Employees with tailored interfaces |
| **Interactive Charts** | Dynamic sparklines and donut charts for financial health tracking |
| **Smart Alerts & Zelle** | Instant Zelle payment push notifications (MS Graph API) & Gemini AI anomaly detection |
| **State Persistence** | Global search and filter state preserved across navigation (Zustand) |
| **Responsive UI** | Dynamic font scaling and flexible layouts optimized for all screen sizes |
| **PDF Export** | Professional report generation for invoices, change orders, quotes, and inventory lists |
| **Engram Persistent Memory** | AI Agent session context and architectural memory persistence via Engram MCP server |

---

## Tech Stack

### Frontend
- **Framework**: [Expo SDK 52](https://expo.dev/) (React Native)
- **Navigation**: [Expo Router](https://docs.expo.dev/router/introduction/) — file-based routing
- **State Management**: [Zustand](https://github.com/pmndrs/zustand) + [React Query (TanStack)](https://tanstack.com/query/latest)
- **Charts**: `react-native-gifted-charts`, `react-native-svg`
- **Lists**: `@shopify/flash-list`

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
│   ├── (auth)/login.tsx          # Secure login screen
│   ├── (tabs)/
│   │   ├── _layout.tsx           # Custom FloatingTabBar orchestrator
│   │   ├── index.tsx             # Dashboard — KPI cards, sparklines, recent sales
│   │   ├── ventas.tsx            # Real-time sales viewer & detail sheet
│   │   ├── inventario.tsx        # Virtualized inventory (7k+ products)
│   │   ├── alertas.tsx           # Stock anomalies & AI fraud detector cards
│   │   ├── reportes.tsx          # Admin financial charts & product velocity
│   │   └── ordenes.tsx           # Physical change orders & writeback tracker
│   ├── producto/[id].tsx         # Product detail & dynamic order controller
│   ├── compras.tsx               # Merchandise reception & purchase queue manager
│   ├── carga-pedidos.tsx         # Customer order builder for POS cashier checkout
│   ├── pagos.tsx                 # Real-time Zelle payment verification list
│   ├── seleccionar-cliente.tsx   # Directory selector for quotes & orders
│   ├── perfil.tsx                # Session info, role, and logout
│   ├── _layout.tsx               # Global providers (QueryClient, AuthGuard, Fonts)
│   └── +not-found.tsx            # 404 fallback route
├── src/
├── components/               # UI components
│   │   ├── DirectorioView.tsx    # Customer/Supplier directory management
│   │   ├── ComprasView.tsx       # Merchandise reception view
│   │   ├── CargaPedidosView.tsx  # POS order entry view
│   │   └── ...                   # SparklineChart, SyncBadge, StatCard, etc.
│   ├── hooks/                    # React Query & Zustand state hooks
│   │   ├── useOrdenCambio.ts     # Stock/Price change order emitter
│   │   ├── useAprobaciones.ts     # Role gate approval inbox & RPC triggers
│   │   ├── useRegistrosDirectorio.ts # Client/Supplier writeback queue hook
│   │   ├── useRealtimeSync.ts    # Debounced Supabase Realtime orchestrator
│   │   ├── usePagosZelle.ts      # Instant Zelle payment status hook
│   │   └── ...                   # useProductos, useUserRole, useCompra, etc.
│   ├── lib/supabase.ts           # Typed Supabase client
│   └── theme/
│       └── brands/el-serrucho.ts # Gold palette, dark background, USD currency
├── docs/                         # Architecture contracts & pipeline specs
│   ├── WRITEBACK-PIPELINE.md     # Stock/Price writeback specification
│   ├── REGISTRO-DIRECTORIO-PIPELINE.md # Directory writeback specification
│   └── PLAN-ZELLE-LISTENER.md    # MS Graph Zelle notification specification
├── supabase/
│   ├── migrations/               # PostgreSQL migration chain (001-035)
│   └── functions/                # Edge functions (send-push, detect-anomalies)
└── .mcp.json                     # MCP server config (Supabase + Engram)
```

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
3. **Customer Orders (`pedidos_app_items`):** Emits presales/delivery notes into HybridLite (`TPedidos.dat`) so cashiers can instantly retrieve and bill them without manual line entry.
4. **Directory Registration (`registro_clientes_app` / `registro_proveedores_app`):** Registers new clients and suppliers in HybridLite (`TClientes.Dat` / `TProveedores.Dat`) and populates their assigned IDs.
5. **Zelle Payment Alerts (`pagos_zelle`):** Monitors Bank of America notifications via MS Graph API, inserting records and firing push notifications & realtime sound alerts.

### Status Machine (`backend_status`)
- `espera_aprobacion` ➔ `pendiente` ➔ `aplicando` ➔ `completado` | `error` | `rechazado`

---

## Getting Started

### Prerequisites

- Node.js (latest LTS)
- Expo Go app (physical device) or Android/iOS emulator
- A Supabase project with migrations 001–035 applied
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

---

## Architecture & Decisions

- **Server-state first**: React Query handles all data fetching — caching, background sync, and debounced realtime revalidation (1.5s).
- **Hardware-Isolated Writeback**: Local backend operates an isolated instance of HybridLite using Win32 `SendInput` and hardware mutex locks (`Local\SerruchoBotMouseLock`).
- **Role Approval Gate**: Employees queue stock edits as `espera_aprobacion`; Admins/Super-employees approve via SECURITY DEFINER RPCs (`aprobar_orden`).
- **Engram Persistent Memory**: Architectural context and research logs stored locally in Engram DB (`~/.engram/engram.db`).

---

## Changelog

### v2.4 (Current)
- **Full Writeback Integration**: Connected stock adjustments, prices, costs, purchases, customer orders, and directory registrations to HybridLite via SendInput Python automation.
- **Role Approval Inbox**: Dedicated approval flow for employee stock adjustments (`useAprobaciones.ts`).
- **Zelle Payment Notifications**: Integrated Microsoft Graph API watcher with Supabase push notifications & realtime audio feedback.
- **Engram MCP Support**: Added `.mcp.json` integration for persistent AI memory tracking.

---

<p align="center">
  Developed with care for <strong>Ferretería El Serrucho</strong>
</p>Dynamic font scaling (`adjustsFontSizeToFit`) and overflow handling for small screens (iPhone SE).
- **Sync indicators**: Real-time POS sync status badges based on last update timestamp.

---

<p align="center">
  Developed with care for <strong>Ferretería El Serrucho</strong>
</p>
