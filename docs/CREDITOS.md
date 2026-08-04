# Créditos — cuentas por cobrar

Libro de deudas de la ferretería. Vive en las migraciones **041** (esquema) y
**042** (endurecimiento). No toca inventario, no dispara write-back a HybridLite
y no escribe en `ventas`: solo las lee para referenciarlas.

---

## La idea en una línea

> **El saldo no se guarda. Se deriva.**

```
saldo = Σ(cargos vivos) − Σ(abonos vivos)
vivo  = anulado_por_id IS NULL AND reversa_de_id IS NULL
```

Como no existe una columna "saldo" en ninguna parte, **no hay un número que se
pueda corromper**. Solo existen los hechos que lo producen. Si el saldo está mal,
es porque un hecho está mal — y los hechos son visibles, fechados y firmados.

Corolario: **corregir nunca es un `UPDATE`**. Es *anular el original + insertar el
bueno*. Las dos filas quedan para siempre. Volver atrás siempre es posible, y el
historial cuenta la verdad completa: qué decía antes, qué dice ahora, quién lo
cambió y por qué.

---

## Los cuatro guardianes (todos en la base de datos)

La app **no puede** saltárselos, porque no viven en la app.

| # | Guardián | Qué impide |
|---|----------|-----------|
| **G1** | `trg_creditos_mov_inmutable` | Cambiar monto, tipo, cuenta, fecha o concepto de un movimiento ya registrado. Lo único que puede cambiar es el sello de anulación, de `NULL` a un valor, **una sola vez**. |
| **G2** | `trg_creditos_mov_no_borrar` | Cualquier `DELETE`. Sin excepciones, ni para el `service_role`. |
| **G3** | `uq_creditos_factura_viva` | Que una factura se cargue dos veces, o a dos cuentas distintas. Es un índice **parcial** sobre filas vivas: si el cargo se anula, la factura vuelve a quedar libre. |
| **G4** | `trg_creditos_reversa_valida` | Una anulación que no calque exactamente cuenta, tipo y monto del original — es decir, una reversa que desbalancearía el libro en silencio. |

Extras: `monto_usd > 0` siempre (**la dirección la da `tipo`, nunca el signo** —
un negativo suelto es el bug clásico que descuadra un libro), `numeric(14,2)` para
aritmética exacta sin deriva de punto flotante, y un único parcial sobre
`lower(btrim(nombre))` para que no nazcan dos cuentas activas de la misma persona.

---

## Permisos

Lectura para cualquier empleado activo (el de mostrador tiene que poder responder
*"¿cuánto debo?"*). Escritura **solo** `is_privileged()` (admin / superempleado),
igual que Compras.

Lo que lo hace hermético: **las tablas no tienen policies de INSERT/UPDATE/DELETE.**
Toda escritura pasa por RPC `SECURITY DEFINER`. Ni un admin con la anon key puede
escribir directo contra la tabla.

| RPC | Para qué |
|-----|----------|
| `creditos_crear_cuenta` | Abrir cuenta a nombre de alguien |
| `creditos_registrar_cargo` | Anotar deuda (`origen` = `factura` \| `libre`) |
| `creditos_registrar_abono` | Registrar un pago |
| `creditos_anular_movimiento` | Anular dejando rastro (**exige motivo**) |
| `creditos_corregir_movimiento` | Anular + reinsertar corregido, en una transacción |
| `creditos_cerrar_cuenta` | Solo si el saldo es exactamente 0 |
| `creditos_reabrir_cuenta` | Reabrir una cerrada |
| `creditos_actualizar_cuenta` | Editar datos del beneficiario (no toca movimientos) |

---

## El beneficiario: por qué es un snapshot y no un join

`ventas.rif_cliente` **no identifica unívocamente a un cliente**. El RIF
`11246149` matchea dos filas de `clientes` (`'11246149'` y `'V11246149'`).
Resolver el beneficiario en vivo con un join duplicaría cuentas y saldos.

Por eso `creditos_cuenta.nombre` es un **snapshot** guardado al abrir la cuenta;
`cliente_codigo` es solo una pista opcional.

Además, **la mayoría de las facturas no tienen cliente**: de 29.213 ventas
válidas, ~17.200 tienen `rif_cliente = NULL` y ~1.100 son `V-0000000000`
(consumidor final). Anotar una factura a nombre de cualquier persona no es un
caso borde — es el caso normal.

La vista `vw_ventas_credito_disponibles` resuelve el **beneficiario sugerido** de
forma determinista con un `LEFT JOIN LATERAL … ORDER BY codigo_cliente LIMIT 1`
(mata el duplicado), marca `es_cliente_natural` cuando no hay a quién sugerir, y
excluye las facturas que ya tienen un cargo vivo.

---

## Flujos de la app

**Anotar una factura** (el principal, FAB dorado en la pestaña Créditos):
factura → la app **preselecciona al cliente de la factura** con un chip
`SUGERIDO` → confirmas, eliges otra persona, o creas una cuenta nueva → el monto
viene precargado con el total pero es editable (a veces se fía solo una parte).
Si la persona sugerida aún no tiene cuenta, se crea al vuelo; si dos usuarios
chocan creando la misma, se vuelve a buscar en lugar de perder el cargo.

**Venta libre**: monto + concepto a mano ("2 sacos de cemento"). No toca stock.

**Abonar**: monto grande, atajo *"Pagar todo"*, chips de método, y un **preview en
vivo** que dice cómo queda el saldo antes de confirmar. Si el abono excede la
deuda no se bloquea (pasa de verdad): se avisa que quedará saldo a favor.

**Corregir / anular**: desde el historial. Ambas exigen motivo y muestran el saldo
resultante *antes* de ejecutar. El movimiento original queda tachado y etiquetado.

---

## Verificación hecha (2026-08-04)

- **18/18 pruebas adversariales** contra los invariantes: ningún guardián cedió
  (mutación, borrado, montos negativos/cero, factura duplicada, factura a dos
  cuentas, reversa descalzada, doble reversa, nombres duplicados, precisión
  decimal, reaparición de la factura tras anular).
- **Ciclo de vida completo vía RPC como usuario autenticado**, con los seis
  valores exactos: 2 cargos ($150) − abono ($30) = **120.00** → corregir el abono
  a $45 = **105.00** → anular el cargo de factura = **5.00**; la factura vuelve a
  estar disponible; **6 filas** en el historial y **2 vivas**.
- **Gate de escritura**: un no-privilegiado recibe `insufficient_privilege`.
- **Advisors**: `security_definer_view` y `function_search_path_mutable`
  corregidos en la 042. Los 8 `WARN` restantes
  (`authenticated_security_definer_function_executable`) son **por diseño** — los
  RPC son la única puerta de escritura, gateada por `is_privileged()`.
- `src/lib/creditos.test.ts` — 18 tests de `parseMonto` (coma decimal venezolana,
  separadores de miles, negativos, `NaN`, `Infinity`, redondeo a 2 decimales) y
  de la tolerancia de medio centavo en `saldoEstado`.

---

## Al tocar este código

1. **Nunca** agregues una columna `saldo` materializada. Si el rendimiento algún
   día lo exige, usa una vista materializada con refresco — pero el ledger manda.
2. **Nunca** hagas `UPDATE` a un movimiento. Anula e inserta.
3. **Nunca** guardes montos negativos. `tipo` define la dirección.
4. Toda escritura nueva va por un RPC con gate `is_privileged()`, no por policy.
5. Los montos de la UI pasan **siempre** por `parseMonto` (`src/lib/creditos.ts`)
   antes de tocar la red, y se muestran con `formatUSD` de `useTheme()`.
