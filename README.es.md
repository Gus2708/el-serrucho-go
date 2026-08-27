# El Serrucho GO

![Expo](https://img.shields.io/badge/Expo-53-000020?style=for-the-badge&logo=expo&logoColor=white)
![React Native](https://img.shields.io/badge/React_Native-0.79-61DAFB?style=for-the-badge&logo=react&logoColor=black)
![Supabase](https://img.shields.io/badge/Supabase-Database-3ECF8E?style=for-the-badge&logo=supabase&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-5.8-3178C6?style=for-the-badge&logo=typescript&logoColor=white)
![PWA](https://img.shields.io/badge/PWA-Vercel-000000?style=for-the-badge&logo=vercel&logoColor=white)

[English](README.md) · [Español](README.es.md)

**El Serrucho GO** es un dashboard administrativo móvil de alto rendimiento para la gestión de inventario en tiempo real y analítica de ventas de *Ferretería El Serrucho*. Desarrollado con foco en rendimiento nativo, diseño moderno y sincronización robusta con el sistema administrativo local (POS on-premise).

Se distribuye como **aplicación Android (EAS)** y como **PWA instalable** (Vercel) compartiendo la misma base de código mediante `react-native-web`.

---

## Tabla de Contenidos

- [Modo Demo para Reclutadores](#modo-demo-para-reclutadores-sandbox-zero-trust)
- [Características Principales](#características-principales)
- [Seguridad y Hardening](#seguridad-y-hardening)
- [Stack Tecnológico](#stack-tecnológico)
- [Estructura del Proyecto](#estructura-del-proyecto)
- [Arquitectura de Base de Datos y Pipeline de Writeback](#arquitectura-de-base-de-datos-y-pipeline-de-writeback)
- [Primeros Pasos](#primeros-pasos)
- [Decisiones de Arquitectura](#decisiones-de-arquitectura)
- [Historial de Versiones (Changelog)](#historial-de-versiones-changelog)

---

## Modo Demo para Reclutadores (Sandbox Zero-Trust)

Diseñado para evaluación técnica, pruebas interactivas y demostración de portafolio sin necesidad de credenciales reales ni riesgo de afectar la base de datos de producción:
- **Acceso Instantáneo en 1 Clic**: Presioná **"Entrar en Modo Demo"** directamente en la pantalla de login.
- **Sandbox Zero-Trust en Cliente**: Todas las mutaciones (presupuestos, ajustes de stock, órdenes de compra a proveedores, registro de clientes/proveedores en directorio y movimientos de inventario) se simulan completamente en memoria mediante Zustand y TanStack Query.
- **Aislamiento Total de Red**: Cero peticiones de escritura llegan al backend de Supabase durante la sesión demo.
- **Dataset Realista**: Incluye catálogo auténtico de ferretería (7.650 ítems virtuales), gráficas interactivas sparkline de 24h, barras de ventas diarias, presupuestos e historial de auditoría.
- **Salida Limpia**: Al salir del modo demo se purgan todas las memorias intermedias, se reinician las consultas y se restablece el estado de autenticación original.

---

## Características Principales

| Característica | Descripción |
|---|---|
| **Modo Demo Reclutador** | Sandbox zero-trust en memoria para exploración completa con datos simulados |
| **Analítica en Tiempo Real** | Tendencias de venta del día, métricas de utilidad y ranking de productos líderes |
| **Motor de Writeback Híbrido** | Sincronización bidireccional entre Supabase y el POS local (HybridLite) mediante automatización de hardware en Python (`SendInput`) |
| **Control de Aprobaciones por Rol** | Modelo de seguridad de tres niveles (Admin, Superempleado, Empleado) con flujo de aprobación de ajustes y compras |
| **RBAC y Sesión Única** | Control de acceso basado en roles con interfaces adaptadas y expulsión automática de sesiones simultáneas (`useSessionEnforcer`) |
| **Hub de Órdenes Centralizado** | Pestaña unificada con 7 áreas de trabajo: Ajuste · Aprobaciones · Presupuesto · Compras · Directorio · Fallas · Historial |
| **Presupuestos y Pedidos** | Creación de cotizaciones (`presupuestos`), conversión a pedidos de caja con precios manuales por ítem |
| **Borradores Automáticos** | Las compras y pedidos pueden guardarse a medio completar y reanudarse posteriormente (`borradores`) |
| **Lector de Código de Barras** | Escaneo nativo por cámara (`expo-camera`) con fallback automático basado en ZXing para navegadores web |
| **Gráficos Interactivos** | Sparklines dinámicos y gráficos de dona para monitorear la salud financiera del negocio |
| **Alertas Inteligentes & Zelle** | Notificaciones push inmediatas ante pagos Zelle (MS Graph API) y detección de anomalías con Gemini AI |
| **Notificaciones Push** | Expo Notifications sobre FCM V1 despachadas desde la Edge Function `send-push` |
| **Persistencia de Estado** | Búsqueda global, filtros y posición de scroll preservados durante la navegación (Zustand) |
| **Interfaz Adaptativa** | Escalado tipográfico responsivo (`scaleFont`) y navegación en barra lateral (`Sidebar`) en pantallas de escritorio |
| **Exportación a PDF** | Generación de reportes profesionales para recibos, ajustes, cotizaciones y listados de inventario |
| **Memoria Persistente Engram** | Persistencia de contexto arquitectónico y decisiones de desarrollo mediante servidor MCP Engram |

---

## Seguridad y Hardening

El Serrucho GO implementa las mejores prácticas de seguridad de la industria, auditadas en doble pasada con TDD estricto:
- **Generación de PDF Segura contra XSS**: Todos los templates (`pdfGenerator.ts`) escapan rigurosamente los datos de usuario y clientes vía `escHtml()`, impidiendo la inyección de scripts en impresiones de recibos, cotizaciones y ajustes.
- **Defensa en Profundidad HTTP**: Cabeceras de producción en Vercel que fuerzan `X-Frame-Options: DENY` (anti-clickjacking), `X-Content-Type-Options: nosniff` (protección contra MIME sniffing), `Referrer-Policy: strict-origin-when-cross-origin`, HSTS y `Permissions-Policy`.
- **Ejecución Segura de Protocolos**: Validación estricta con `isSafeHttpUrl()` / `getSafeUrlOrNull()` para prevenir la apertura de pseudoprotocolos maliciosos (`javascript:`, `data:`) en enlaces externos.
- **Protección contra Path Traversal en Almacenamiento**: Sanitización de nombres de archivo con `sanitizeStorageFileName()`, neutralizando secuencias de escape de directorio (`../`) y caracteres no autorizados.
- **Protección contra Fuerza Bruta**: Rate limiting del lado cliente (`rateLimit.ts`) con bloqueo temporal tras 5 intentos fallidos y mensajes genéricos que impiden la enumeración de cuentas.
- **Seguridad a Nivel de Filas en PostgreSQL (RLS)**: Políticas RLS estrictas en todas las tablas combinadas con funciones RPC `SECURITY DEFINER` para operaciones privilegiadas.

---

## Stack Tecnológico

### Frontend
- **Framework**: [Expo SDK 53](https://expo.dev/) (React Native 0.79, React 19, New Architecture)
- **Navegación**: [Expo Router](https://docs.expo.dev/router/introduction/) — enrutamiento basado en archivos con tipado estático
- **Gestión de Estado**: [Zustand](https://github.com/pmndrs/zustand) + [React Query (TanStack)](https://tanstack.com/query/latest) con persistencia en AsyncStorage
- **Gráficas**: `react-native-gifted-charts`, `react-native-svg`
- **Listas Virtualizadas**: `@shopify/flash-list`
- **Web / PWA**: `react-native-web`, `service-worker.js` personalizado y `manifest.webmanifest`, desplegado en Vercel
- **Testing**: Jest (`babel-preset-expo`) + `@testing-library/react-native`

### Backend
- **Plataforma**: [Supabase](https://supabase.com/)
- **Base de Datos**: PostgreSQL con Row Level Security (RLS) y RPCs de aprobación
- **Tiempo Real**: Supabase Realtime para actualización instantánea de KPIs y estados de writeback
- **Serverless**: Edge Functions (`send-push`, `detect-anomalies`)
- **Memoria de Agentes**: Motor de memoria persistente [Engram](https://github.com/Gentleman-Programming/engram)

---

## Estructura del Proyecto

```text
.
├── app/                          # Pantallas de Expo Router (rutas basadas en archivos)
│   ├── (auth)/
│   │   ├── login.tsx             # Inicio de sesión seguro con rate limiting y modo demo
│   │   ├── pending.tsx           # Cuenta en espera de activación por el administrador
│   │   └── kicked.tsx            # Sesión cerrada por inicio simultáneo en otro dispositivo
│   ├── (tabs)/
│   │   ├── _layout.tsx           # Barra flotante (móvil) / Barra lateral (escritorio)
│   │   ├── index.tsx             # Dashboard — métricas KPI, sparklines, ventas recientes
│   │   ├── ventas.tsx            # Monitor de ventas en vivo y detalle fiscal
│   │   ├── inventario.tsx        # Inventario virtualizado (7.650 productos)
│   │   ├── notificaciones.tsx    # Cola de atención, solicitudes del bot y alertas Zelle
│   │   ├── reportes.tsx          # Analítica financiera de administradores y rotación de stock
│   │   └── ordenes.tsx           # Hub de órdenes — 7 sub-pestañas unificadas
│   ├── producto/[id].tsx         # Detalle de producto y panel de ajustes
│   ├── seleccionar-productos.tsx # Selector de productos compartido por todos los flujos
│   ├── seleccionar-cliente.tsx   # Selector de directorio para cotizaciones y pedidos
│   ├── pagos.tsx                 # Verificación de pagos Zelle en tiempo real
│   ├── solicitudes.tsx           # Bandeja de solicitudes de clientes sin stock
│   ├── admin-usuarios.tsx        # Administración de roles y permisos (solo admin)
│   ├── perfil.tsx                # Datos de sesión, rol activo y cierre de cuenta
│   ├── _layout.tsx               # Proveedores globales (QueryClient, AuthGuard, Fuentes)
│   ├── +html.tsx                 # Plantilla HTML web con cabeceras de seguridad y meta PWA
│   └── +not-found.tsx            # Ruta de error 404
├── src/
│   ├── components/               # Componentes modulares de interfaz de usuario
│   │   ├── DemoBanner.tsx        # Notificación flotante de modo demo activo
│   │   ├── PresupuestoView.tsx   # Constructor de presupuestos / cotizaciones
│   │   ├── ComprasView.tsx       # Recepción de mercancía de proveedores
│   │   ├── PedidosView.tsx       # Generador de notas de entrega y pedidos de caja
│   │   ├── DirectorioView.tsx    # Gestión de clientes y proveedores
│   │   ├── AprobacionesView.tsx  # Bandeja de aprobación de ajustes pendientes
│   │   ├── BorradoresView.tsx    # Documentos incompletos guardados
│   │   ├── FallasView.tsx        # Registro de incidencias de inventario
│   │   └── Sidebar.tsx           # Barra de navegación lateral para escritorio
│   ├── demo/                     # Sandbox y datos simulados para reclutadores
│   │   ├── useDemoStore.ts       # Estado reactivo del modo demo
│   │   └── demoData.ts           # Catálogo simulado, ventas, sparklines y cotizaciones
│   ├── hooks/                    # Hooks de React Query y estado Zustand
│   │   ├── useOrdenCambio.ts     # Emisor de ajustes de stock, precio y costo
│   │   ├── useAprobaciones.ts    # Bandeja de aprobaciones y llamadas a RPCs
│   │   ├── useBorradores.ts      # Persistencia de borradores de pedidos y compras
│   │   ├── useRegistrosDirectorio.ts # Cola de writeback de clientes y proveedores
│   │   ├── useSessionEnforcer.ts # Control de dispositivo único activo
│   │   └── ...                   # useProductos, useUserRole, useCompra, etc.
│   ├── lib/
│   │   ├── supabase.ts           # Cliente tipado de Supabase
│   │   ├── rateLimit.ts          # Throttling y prevención de ataques de fuerza bruta
│   │   ├── retry.ts              # Reintento ante arranque en frío en PWA
│   │   └── pdfStorage.ts         # Subida segura de PDFs a Supabase Storage
│   ├── utils/
│   │   ├── pdfGenerator.ts       # Generador de documentos PDF protegidos contra XSS
│   │   ├── safeUrl.ts            # Validador de protocolos de enlace seguro
│   │   └── notifications.ts      # Síntesis de audio y notificaciones de escritorio
│   └── theme/
│       ├── motion.ts             # Constantes de animación y microinteracciones
│       ├── responsive.ts         # Función de escalado de fuentes (scaleFont)
│       └── brands/el-serrucho.ts # Paleta de colores dorada, tema oscuro y formato USD
├── docs/                         # Documentación de contratos y especificaciones
│   ├── WRITEBACK-PIPELINE.md     # Especificación del pipeline de ajustes de stock
│   ├── REGISTRO-DIRECTORIO-PIPELINE.md # Especificación del registro de directorio
│   ├── PLAN-ZELLE-LISTENER.md    # Especificación del listener de Zelle con MS Graph
│   └── CREDITOS.md               # Libro mayor de cuentas por cobrar (app independiente)
├── public/                       # Activos de la PWA (manifiesto, service worker, iconos)
├── supabase/
│   ├── migrations/               # Cadena de migraciones PostgreSQL (001–043)
│   └── functions/                # Edge Functions (send-push, detect-anomalies)
├── vercel.json                   # Reglas de reescritura y cabeceras de seguridad HTTP
└── security_best_practices_report.md # Reporte de auditoría de seguridad integral
```

### Sub-pestañas del Hub de Órdenes

| Sub-pestaña | Propósito | Nivel de Acceso |
|---|---|---|
| **Ajuste** | Órdenes de cambio de stock, precio, costo o ficha | Todos los empleados |
| **Aprobaciones** | Aprobar o rechazar ajustes enviados por empleados | Solo roles privilegiados |
| **Presupuesto** | Construir cotizaciones, exportar PDF, convertir a pedido | Todos los empleados |
| **Compras** | Recepción de mercancía y facturas de proveedores | Solo roles privilegiados |
| **Directorio** | Registrar nuevos clientes y proveedores en HybridLite | Todos los empleados |
| **Fallas** | Registro de incidencias o productos faltantes solicitados | Todos los empleados |
| **Historial** | Historial unificado de todos los documentos emitidos | Todos los empleados |

---

## Arquitectura de Base de Datos y Pipeline de Writeback

El sistema opera con un **pipeline de sincronización bidireccional en circuito cerrado** que conecta la base de datos cloud con el POS local (HybridLite).

### Flujo del Writeback

```text
App (El Serrucho Go)                Supabase (Cola en PostgreSQL)          Backend (Watchdog Python 24/7)
────────────────────                ─────────────────────────────          ──────────────────────────────
1. Emite Ajuste o Compra         ─► Inserta fila (backend_status='pendiente') ─► Lee filas encoladas vía Service Key
2. Monitorea Chips en Vivo      ◄─ Emite actualizaciones Realtime         ◄─ Ejecuta automatización SendInput
3. Refresca Inventario           ◄─ Sync-Engine lee DBISAM y actualiza    ◄─ Verifica confirmación en DBISAM
```

### Pipelines de Writeback Disponibles
1. **Stock / Precio / Costo / Ficha (`ordenes_cambio_items`):** Emite variaciones de existencia y precios. Pasa por el flujo de aprobación antes de encolarse.
2. **Compras (`compras_app_items`):** Recibe inventario de proveedores creando automáticamente artículos no existentes en el catálogo local.
3. **Pedidos de Clientes (`pedidos_app_items`):** Emite notas de entrega directo a `TPedidos.dat` para que los cajeros facturen sin reescribir líneas manualmente.
4. **Directorio (`registro_clientes_app` / `registro_proveedores_app`):** Registra clientes y proveedores en `TClientes.Dat` y `TProveedores.Dat`.
5. **Alertas de Pagos Zelle (`pagos_zelle`):** Monitorea notificaciones bancarias vía Microsoft Graph API disparando avisos push y sonidos en tiempo real.

---

## Primeros Pasos

### Requisitos Previos

- Node.js (versión LTS recomendada)
- Aplicación móvil Expo Go (dispositivo físico) o emulador Android / iOS
- Proyecto de Supabase con las migraciones 001–043 aplicadas
- Servidor MCP Engram para trazabilidad de memoria asistida por IA

### Variables de Entorno

Crear un archivo `.env.local` en la raíz del proyecto:

| Variable | Descripción |
|---|---|
| `EXPO_PUBLIC_SUPABASE_URL` | URL del proyecto Supabase |
| `EXPO_PUBLIC_SUPABASE_ANON_KEY` | Llave pública anónima de Supabase |
| `EXPO_PUBLIC_WIDGET_API_URL` | *(Opcional)* URL del widget local de sincronización (ej: `http://192.168.1.143:5000`) |

### Instalación y Ejecución

```bash
# Clonar el repositorio
git clone https://github.com/Gus2708/el-serrucho-go.git
cd el-serrucho-go

# Instalar dependencias
npm install

# Iniciar el servidor de desarrollo
npm start
```

> **Consejo**: Ejecutá Metro desde **Windows Terminal** o tu consola principal y no desde terminales embebidos de agentes/IDEs para no interferir con atajos como `r` o `a`.

### Scripts Disponibles

| Comando | Acción |
|---|---|
| `npm start` | Inicia el servidor de desarrollo de Expo |
| `npm run web` | Servidor de desarrollo apuntando al navegador web |
| `npm run build:web` | Exportación estática de la PWA + copia de assets públicos |
| `npm run build:apk` | Compilación previa en la nube con EAS para Android |
| `npm run typecheck` | Comprobación estricta de tipos de TypeScript (`tsc --noEmit`) |
| `npm run lint` | Análisis de calidad de código con ESLint |
| `npm test` | Suite de pruebas Jest (8 suites, 46 tests unitarios) |

---

## Decisiones de Arquitectura

- **Prioridad al Estado del Servidor**: React Query administra la obtención de datos, caché inteligente, revalidación en segundo plano y suscripciones a tiempo real con debounce (1.5s).
- **Sandbox Zero-Trust para Reclutadores**: El Modo Demo intercepta las mutaciones localmente en memoria sin emitir peticiones a la base de datos real.
- **Writeback con Aislamiento de Hardware**: El servidor local maneja una instancia dedicada de HybridLite mediante `SendInput` de Win32 y mutex de hardware (`Local\SerruchoBotMouseLock`).
- **Flujo de Aprobación Escalonado**: Los empleados normales encolan ajustes como `espera_aprobacion`; los Administradores y Superempleados aprueban con RPCs protegidas (`aprobar_orden`).
- **Control Estricto de Sesión Única**: `useSessionEnforcer` vincula el identificador de sesión en `profiles.allowed_sid`, expulsando dispositivos antiguos a `(auth)/kicked`.
- **Resiliencia en PWA ante Arranque en Frío**: Enlaces de red en segundo plano pueden generar `Failed to fetch`; `withSupabaseRetry` en `src/lib/retry.ts` maneja reintentos transparentes.
- **PDFs Compatibles con Motores de Impresión**: Bloques con `display: block` para garantizar que Chromium y WebKit no fragmenten totales o tablas entre saltos de página.
- **Interfaz Adaptativa**: `useDeviceSize` intercambia automáticamente la barra flotante móvil por una barra lateral en navegadores de escritorio.

---

## Historial de Versiones (Changelog)

### v2.6 (Actual)
- **Modo Demo para Reclutadores**: Acceso en 1 clic desde la pantalla de login con datos simulados en memoria, gráficas interactivas, catálogo virtual de 7.650 ítems y aislamiento de red zero-trust.
- **Auditoría de Seguridad Integral con TDD**: Mitigación de XSS en PDFs (`escHtml`), prevención de path traversal en storage (`sanitizeStorageFileName`), validación de esquemas seguros de URL (`safeUrl.ts`), limitación de intentos de login por fuerza bruta (`rateLimit.ts`), y cabeceras HTTP estrictas (`X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy`, HSTS).
- **Suite de Pruebas Ampliada**: 8 suites de prueba Jest con 46 tests unitarios pasando exitosamente.

### v2.5
- **Separación de Créditos**: El módulo de cuentas por cobrar fue extraído a su propia aplicación independiente.
- **Borradores y Precios Manuales**: Guardado provisional de compras y pedidos con sobreescritura manual de precios por ítem.
- **Compensación de Existencias Negativas**: Las compras entrantes descuentan saldos negativos previos antes de incrementar existencias.
- **Estabilidad de Scroll**: Fijación de posición durante la construcción de listas largas de productos.
- **PDFs con Protección de Salto de Página**: Filas y totales agrupados sin cortes al imprimir.

### v2.4
- **Integración Completa de Writeback**: Sincronización de inventario, precios, costos, compras y pedidos con HybridLite.
- **Bandeja de Aprobaciones**: Flujo de revisión de ajustes para administradores y superempleados.
- **Notificaciones Zelle**: Integración con Microsoft Graph API y alertas de audio en tiempo real.

---

<p align="center">
  Desarrollado con dedicación para <strong>Ferretería El Serrucho</strong>
</p>
