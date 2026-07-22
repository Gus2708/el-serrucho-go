# Registro de directorio: Cliente/Proveedor nuevo → HybridLite (contrato para el backend)

**(2026-07-21)** Cuando un usuario **registra un cliente o un proveedor** en El Serrucho Go,
la app encola la solicitud en Supabase. El backend de la ferretería debe detectarla y **dar de
alta la ficha él solo en HybridLite** (automatizando la app de escritorio con input real de
hardware, igual que compras/pedidos). Este documento es el contrato de datos entre la app (ya
implementada) y el escritor del backend (fase siguiente, a grabar frente a la PC).

Espeja el patrón de [WRITEBACK-PIPELINE.md](WRITEBACK-PIPELINE.md) (ajustes) y de
`compras_app`/`pedidos_app`.

```
App                                   Backend (listener a implementar)
──────────────────────────────        ─────────────────────────────────────────
registro_clientes_app     status='emitido'  →  sondea backend_status='pendiente'
registro_proveedores_app  status='emitido'  →  da de alta la ficha en HybridLite (SendInput)
                                              →  verifica contra la DBISAM
                                              →  escribe codigo_*_hybrid + backend_status
sync-espejo de clientes/proveedores   ←  la ficha nueva vuelve a `clientes` / `proveedores`
```

## Tablas (migración 035, ya ejecutada)

Solo-cabecera: un registro = **una** ficha de Hybrid = un solo Guardar (no hay items).

### `registro_clientes_app`

| Columna | Tipo | Semántica |
|---|---|---|
| `id` | bigint identity PK | Nº de registro (la app lo muestra como `RC-0001`). |
| `creado_por` | uuid → auth.users | Quién lo registró. **NOT NULL en la práctica** (RLS). |
| `nombre` | text NOT NULL | Nombre / razón social (la app ya lo manda en MAYÚSCULAS). |
| `rif` | text | RIF o cédula. |
| `telefono` | text | Teléfono. |
| `direccion` | text | Dirección. |
| `nota` | text | Observaciones. |
| `status` | text | `borrador` \| `emitido`. El backend procesa solo `emitido`. |
| `backend_status` | text | `pendiente` → `aplicando` → `completado` \| `error`. |
| `backend_resultado` | text | Detalle del resultado o del error (se muestra al usuario). |
| `backend_intentos` | int | Reintentos consumidos. |
| `backend_aplicado_en` | timestamptz | Cuándo se confirmó el alta en HybridLite. |
| `codigo_cliente_hybrid` | text | **CLI_CODIGO que Hybrid autoasigna.** Lo llena el backend al verificar. |
| `creado_en` | timestamptz | Alta del registro. |

### `registro_proveedores_app`

Igual que la de clientes, con estas diferencias de campos de ficha:

| Columna | Tipo | Semántica |
|---|---|---|
| `contacto` | text | Persona de contacto (PRV_CONTACTO). |
| `email` | text | Email (PRV_EMAIL). |
| `codigo_proveedor_hybrid` | text | **PRV_CODIGO que Hybrid autoasigna.** |

(Sin `direccion`.) La app lo muestra como `RP-0001`.

## Ciclo de vida de `backend_status`

- **`pendiente`** — en cola. Default al insertar. El backend solo procesa registros con
  `status='emitido'`.
- **`aplicando`** — el backend lo está ejecutando ahora (transitorio, ~30s de input real).
- **`completado`** — la ficha se dio de alta y se **verificó contra la DBISAM**;
  `codigo_*_hybrid` y `backend_aplicado_en` quedan seteados.
- **`error`** — no se dio de alta (o no se sabe si se aplicó). El motivo va en
  `backend_resultado`. La app muestra el texto y permite reintentar (reencolar).

## Permisos (RLS, ya aplicada)

| Rol | Registrar cliente | Registrar proveedor |
|---|---|---|
| **admin** | sí | sí |
| **superempleado** | sí | sí |
| **empleado** | sí | **no** (RLS lo bloquea) |

- `registro_clientes_app`: escritura para cualquier empleado activo dueño de la fila
  (`is_active_employee() AND creado_por = auth.uid() AND validate_session()`), patrón `pedidos_app`.
- `registro_proveedores_app`: escritura solo privilegiados (`is_privileged() AND …`), modelo Compras.
- El backend usa `SUPABASE_SERVICE_KEY` y **bypassa RLS**; ambas tablas están en la publicación
  `supabase_realtime` para los chips en vivo de la app (pestaña Órdenes › Directorio).

## Estado backend (2026-07-22): IMPLEMENTADO (falta validar el commit en vivo)

La coreografía SendInput ya está escrita, calibrada contra la UI real y con verificación
contra la DBISAM. Archivos en `backend serrucho/hybrid_writeback/`:

- `flujo_directorio_real.py` — alta de ficha (`registrar_cliente` / `registrar_proveedor`).
  Ambas fichas son `TTConfigForm` (por título 'Forma de Cliente' / 'Forma Proveedores'),
  se abren desde el menú (TAdvGlassButton 'Clientes' / 'Proveedores'), barra Incluir/Guardar
  como la Ficha de Inventario. **v1 llena código + nombre + RIF.** El **código es MANUAL** y
  se deriva del RIF sin guiones (convención de la tienda) → **el RIF es obligatorio**.
- `read_db_directorio.py` — verificación read-only + `codigo_desde_rif` + `existe_codigo`
  (idempotencia). Probado en vivo contra `TClientes.dat` / `TProveedores.Dat`.
- `listener_directorio.py` — sondea ambas colas, aplica el flujo, escribe `backend_*` +
  `codigo_*_hybrid`. Cableado a `backend_watchdog.py` **ACTIVO 24/7** (`HYBRID_WRITE_ENABLED=1`).
- `inspeccionar_ficha.py` — helper de calibración (volcado del árbol de controles).

**Rollout COMPLETO (2026-07-22):** preview supervisado OK + commit de prueba verificado contra
DBISAM en ambas formas (fichas PRUEBA CLAUDE C2 / P2), listener activado y corriendo bajo el
watchdog. El pipeline app → cola → HybridLite → `codigo_*_hybrid` está en producción.

## Qué debía hacer el backend (referencia de diseño)

1. **Grabar la coreografía SendInput** de dar de alta una ficha de Cliente y una de Proveedor
   en HybridLite (como `FLUJO-COMPRA-CAPTURADO.log` / `FLUJO-NUEVO-PRODUCTO-CAPTURADO.log`),
   y escribir `hybrid_writeback/flujo_cliente_real.py` y `flujo_proveedor_real.py`
   (preview por defecto; `--commit` para aplicar).
2. **Cablear el listener** (extender `listener_writeback.py` o un `listener_directorio.py`
   análogo a `listener_compras`): sondear `backend_status='pendiente'` con `status='emitido'`,
   marcar `aplicando`, ejecutar el flujo dentro de `HYBRID_WRITE_WINDOW`, y al terminar leer
   el código autoasignado de la DBISAM (`TClientes.Dat` / `TProveedores.Dat`) para escribir
   `codigo_*_hybrid` + `backend_status='completado'` (o `error` + `backend_resultado`).
3. **Verificar contra la DB real** antes de marcar `completado` (patrón de precio/stock).
4. **Respetar `backend_intentos`** (máx. 3) como en los demás flujos.

## Consideraciones

- **Latencia:** el registro queda `pendiente` hasta la ventana de escritura (`HYBRID_WRITE_WINDOW`,
  típicamente fuera de horario). La app ya advierte "se aplica fuera de horario y aparecerá en
  el selector tras la próxima sincronización". Si se quiere alta **inmediata** de clientes
  (p. ej. para facturar en el momento), habría que decidir una ventana/prioridad aparte para
  `registro_clientes_app`.
- **Disponibilidad en la app:** el cliente/proveedor nuevo recién aparece en los selectores
  (`useProveedores`, búsqueda de `clientes`) cuando el **sync-espejo** lo trae desde HybridLite
  a `proveedores`/`clientes`. Antes de eso solo existe en la cola con su chip de estado.
- **FK de presupuestos:** `presupuestos.cliente_id → clientes(codigo_cliente)`. Un cliente
  recién encolado (sin código) **no** puede adjuntarse a un presupuesto hasta existir en el
  espejo `clientes`.
- **Sin backend aún:** hasta grabar los `flujo_*_real.py`, los registros quedan `pendiente`
  indefinidamente. Es esperado (igual que un item de compra antes de que existiera su flujo).

## Referencias

- App: `src/components/RegistroClienteModal.tsx`, `RegistroProveedorModal.tsx`,
  `DirectorioView.tsx`; hooks `useRegistrarCliente.ts`, `useRegistrarProveedor.ts`,
  `useRegistrosDirectorio.ts`. Puntos de entrada: `app/seleccionar-cliente.tsx`,
  `src/components/ComprasView.tsx` (picker de proveedor).
- Migración: `supabase/migrations/035_registro_directorio_app.sql`.
- Backend/motor de referencia: `backend serrucho/hybrid_writeback/README.md`,
  `listener_writeback.py`, `flujo_compra_real.py`.
