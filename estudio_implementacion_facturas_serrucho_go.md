# Facturas de proveedores: diseño de importación asistida a El Serrucho GO

> **Nota de reconciliación actual (2026-10-22):** Este estudio se mantiene como la referencia de diseño completa para la automatización asistida de facturas de proveedores (captura → extracción → reconocimiento de catálogo → revisión humana → emisión controlada de compra).
> - **Base implementada (persistencia):** Se implementó y verificó la base de persistencia documental manual con las tablas reales `facturas_proveedores`, `facturas_proveedores_lineas` y `facturas_proveedores_operaciones` (esquema original ya existente en producción; corrección posterior aplicada el 2026-10-22), almacenamiento local en `AsyncStorage` (nativo) / `localStorage` (web), y adjunto opcional.
> - **Alcance pendiente (automatización completa):** La extracción (OCR/LLM), el emparejamiento con el catálogo y la transferencia a compra siguen pendientes y están planificados en la hoja de ruta ODD activa [`odd/tasks/supplier-invoice-automation.md`](odd/tasks/supplier-invoice-automation.md). No se ha elegido un modelo; su evaluación corresponde a T1. La persistencia no constituye la funcionalidad completa.

**Estado:** propuesta revisada contra código local; pendiente de implementación y validación operativa.
**Alcance:** capturar documentos, extraer renglones, asociarlos al catálogo y preparar una compra revisada por una persona.
**Condición principal:** conservar la compensación de existencias negativas para que una recepción completa deje en stock las unidades facturadas, distinguiendo cantidad documental, cantidad recibida y cantidad enviada al POS. Ninguna extracción emite una compra automáticamente.

La base de compras es reutilizable, pero requiere un adaptador de importación con persistencia, transacciones y controles propios. Este documento contiene requisitos propuestos; las referencias describen comportamiento observado en fuentes locales, no certifican el despliegue de producción.

## 1. Ruta de implementación

1. Confirmar políticas de cantidades, costos, moneda y alcance fiscal.
2. Persistir documentos, renglones y revisiones con permisos y límites de procesamiento.
3. Implementar extracción y reconciliación asistidas con operaciones idempotentes.
4. Transferir una revisión aprobada a un único borrador y habilitar emisión explícita.
5. Validar el contrato del POS y hacer un piloto con facturas reales.

El MVP bloquea casos que no puede representar fielmente. Embeddings y aprobación automática por similitud requieren evidencia posterior.

## 2. Evidencia y límites actuales

### 2.1. Compras y permisos

| Evidencia local | Comportamiento observado | Consecuencia |
|---|---|---|
| [021_proveedores.sql](supabase/migrations/021_proveedores.sql) | Existe un maestro de proveedores sincronizado. | Reutilizar su identidad; medir el número real de proveedores. |
| [022_compras_app.sql](supabase/migrations/022_compras_app.sql), desde línea 11 | Cabecera `id bigint`, estados `borrador/emitido` y detalle con cantidades/costos. | Conservar el tipo de `compra_id` y el mismo registro durante el flujo. |
| [026_roles_superempleado_writeback.sql](supabase/migrations/026_roles_superempleado_writeback.sql), líneas 167–184 | Escribir compras exige privilegios, propietario y sesión válida. | Importación y confirmación de alias respetan admin/superempleado activo y sesión válida. |
| [useCompra.ts](src/hooks/useCompra.ts), líneas 69–87 | Zustand conserva el borrador activo en memoria, sin middleware `persist`. | Un borrador no guardado no constituye almacenamiento durable. |
| [useCompra.ts](src/hooks/useCompra.ts), desde línea 148 | Existe guardado remoto del borrador. | Reutilizar continuidad de compra sin asumir atomicidad de sus solicitudes actuales. |

### 2.2. Riesgos del store actual

| Evidencia local | Comportamiento observado | Requisito nuevo |
|---|---|---|
| [useCompra.ts](src/hooks/useCompra.ts), líneas 87–100 | Agregar el mismo SKU reemplaza el ítem previo. | No importar mediante llamadas sucesivas a `addItem`; preservar cada renglón. |
| [useCompra.ts](src/hooks/useCompra.ts), líneas 196–204 y 258–267 | Guardar puede borrar e insertar detalle mediante solicitudes separadas. | Transferencia de factura transaccional en base de datos. |
| [useCompra.ts](src/hooks/useCompra.ts), desde línea 348 | Emitir reutiliza el borrador, pero modifica detalle y cabecera por separado. | Emisión importada con versión y transición atómica. |
| [useCompra.ts](src/hooks/useCompra.ts), desde línea 470 | Compensar negativos aumenta la cantidad enviada para neutralizar el saldo anterior. | Conservar esta regla operativa y registrar la cantidad documental sin modificarla. |
| [ComprasView.tsx](src/components/ComprasView.tsx), línea 111 | El total incluye la cantidad compensada. | Separar total de factura y corrección de inventario. |

### 2.3. Contrato observado del robot

| Evidencia en `Hybrid-on-cloud` | Comportamiento observado | Límite |
|---|---|---|
| [listener_compras.py](../Hybrid-on-cloud/hybrid_writeback/listener_compras.py), líneas 114–121 y 320 | Consulta compras pendientes y emitidas en un loop de polling. | El listener consume la cola; `flujo_compra_real.py` ejecuta. No asumir consumo por Realtime. |
| [listener_compras.py](../Hybrid-on-cloud/hybrid_writeback/listener_compras.py), líneas 204–220 | Distingue errores reintentables y resultados posteriores o ambiguos respecto al commit. | Un error no autoriza registrar de nuevo la compra. |
| [flujo_compra_real.py](../Hybrid-on-cloud/hybrid_writeback/flujo_compra_real.py), línea 987 | Escribe costo con dos decimales. | Comprobar representabilidad antes de emitir. |
| [flujo_compra_real.py](../Hybrid-on-cloud/hybrid_writeback/flujo_compra_real.py), desde línea 1149 | Reduce `doc_numero` a dígitos y lo introduce en dos campos consecutivos. | Factura y control no tienen transmisión independiente. |
| [listener_compras.py](../Hybrid-on-cloud/hybrid_writeback/listener_compras.py), líneas 260–282 | Envía proveedor, ítems y número al ejecutor. | La fecha fiscal extraída no se transmite como parámetro independiente. |

El robot rechaza SKU duplicados antes de operar: [flujo_compra_real.py](../Hybrid-on-cloud/hybrid_writeback/flujo_compra_real.py), desde línea 1246.
Las altas nuevas preceden al documento y pueden sobrevivir al fallo de la compra: mismo archivo, desde línea 1227.
La clave segura para teclear y la verificación del producto pertenecen al backend: líneas 974–980 y 1295–1324.

### 2.4. Dependencias y hechos no verificados

[package.json](package.json) incluye `expo-camera` y `expo-file-system`; no declara `expo-document-picker`, `expo-image-picker` ni Zod.
Cámara, galería y selección/renderizado de PDF requieren capacidades y permisos distintos; comprobar compatibilidad en las plataformas objetivo.
El árbol local llega a migraciones `048`; este documento no reserva los números `049/050` del estudio anterior.
Antes de asignar nombres, comprobar historial remoto, migraciones concurrentes, extensiones disponibles y sus esquemas.
No se verificaron aquí despliegue remoto, permisos efectivos, versión del widget ni disponibilidad de un modelo concreto.
Número de SKU, duración de carga manual y volumen típico de renglones son mediciones pendientes.

## 3. Contrato factura → compra → POS

### 3.1. Identidad y cantidades

Cada renglón tiene `linea_id` estable, página, orden y región de origen cuando exista.
Código del proveedor y SKU interno son atributos de asociación; ninguno sustituye esa identidad.
Una nueva extracción crea otra revisión y registra diferencias; no sobrescribe una revisión aprobada.
Conservar original y extracción de cada intento para trazabilidad.

| Campo conceptual | Significado | Regla |
|---|---|---|
| `cantidad_documento` | Cantidad impresa en la unidad del proveedor. | No cambia al seleccionar SKU ni consultar stock. |
| `unidad_documento` / `factor_conversion` | Presentación y unidades de inventario por presentación. | Factor confirmado, mayor que cero. |
| `cantidad_facturada_stock` | `cantidad_documento × factor_conversion`. | Base para conciliar cantidades/costos por unidad de inventario. |
| `cantidad_recibida_stock` | Cantidad efectivamente recibida. | Confirmación separada ante faltantes o devoluciones. |
| `compensacion_negativo` | Unidades necesarias para neutralizar el saldo negativo anterior. | `max(0, −stock_previo)`; no son unidades compradas al proveedor. |
| `cantidad_a_enviar_pos` | Cantidad recibida más compensación negativa. | En recepción completa, `cantidad_facturada_stock + compensacion_negativo`. |
| `ajuste_stock` | Otro ajuste explícito de inventario, si corresponde. | No confundir con la compensación automática ni incorporarlo al total de factura. |

Dos cajas de doce piezas representan `2 × 12 = 24` piezas facturadas.
A `$24.00` netos por caja corresponden `$2.00` por pieza y `$48.00` totales.
Si se reciben 23 piezas, registrar diferencia y bloquear la importación del MVP hasta resolverla; no cambiar el costo para absorber el faltante.

### 3.2. Existencias negativas

**Regla de negocio confirmada:** Hybrid permite seguir vendiendo con existencia cero o negativa. Al recibir una factura completa, el saldo negativo anterior no debe descontarse de las unidades que ingresan: si hay −3 y llegan 10, el inventario debe quedar en 10.
La compensación actual de `useCompra` responde a esta regla y debe conservarse para compras importadas.

```text
compensacion_negativo = max(0, −stock_previo)
cantidad_a_enviar_pos = cantidad_recibida_stock + compensacion_negativo
stock_final_esperado = max(stock_previo, 0) + cantidad_recibida_stock
Ejemplo: stock −3, factura/recepción 10 → compensación 3 → envío 13 → stock final 10.
Con stock positivo 5 y recepción 10 → envío 10 → stock final 15.
```

La separación es documental y de trazabilidad: no exige convertir la compensación en otro movimiento de inventario ni pedir una aprobación adicional por el hecho de existir stock negativo.
Conservar las 10 unidades originales y sus importes; las 3 compensadas no se registran como otra compra al proveedor.
El robot puede recibir 13 unidades en su movimiento existente, pero la integración debe distinguir el total documental del importe que Hybrid derive de esa cantidad compensada y validar su representación antes de habilitar la emisión importada.
Registrar saldo previo, compensación, cantidad enviada, momento de lectura y resultado de verificación del POS.
El adaptador debe evitar que `submit()` vuelva a compensar una cantidad ya compensada.
Comprobar el saldo al ejecutar el movimiento: la cola puede demorar y una venta posterior a la lectura de la app puede volver obsoleta la compensación calculada.
La compensación y el movimiento se aplican una sola vez; un reintento consulta la operación existente antes de calcular o enviar otro incremento.
Stock negativo por sí solo no es motivo para bloquear la importación; sí lo son una lectura fallida, un conflicto de ejecución o una representación de importes todavía no validada.

### 3.3. SKU repetidos

Conservar todas las líneas: un SKU puede aparecer con distintos costos, descuentos, unidades o impuestos.
El detalle documental no se reduce a un diccionario por `codigo_producto`.
Cada ítem consolidado de salida debe enlazar todas sus líneas originales.

1. Convertir unidades y calcular importes netos por renglón.
2. Agrupar solo líneas con costo neto unitario, tratamiento fiscal y PVP de salida iguales y representables.
3. Comprobar conservación de cantidades/importes y un único ítem por SKU en el POS.
4. Bloquear costos distintos hasta aprobar su política y comprobar la representación en el robot.

Un costo ponderado `Σ importe_neto / Σ cantidad_stock` es una política futura posible, aún no aprobada.
Puede introducir más decimales y diferencias; no basta sumar cantidades ni tomar el último costo.

### 3.4. Alcance fiscal

Guardar número completo, control, fecha y tipo documental como atributos independientes.
No usar la reducción a dígitos como identidad única: `A-001` y `B-001` pueden colisionar.
Definir el mapeo a la clase 5/nota de entrega observada sin prometer una factura fiscal equivalente.
Bloquear documentos que exijan fecha/control independientes hasta adaptar y validar el backend.

## 4. Importes: lectura fiel y cálculo determinista

### 4.1. Representaciones separadas

| Representación | Contenido | Autoridad |
|---|---|---|
| Original | Texto, importes, moneda, tasa, descuentos, impuestos y campos ilegibles. | Evidencia; no corregir para forzar un cuadre. |
| Normalizada | Conversiones, importes netos, impuestos y equivalentes USD. | Cálculo decimal reproducible, versionado y aprobado. |
| Salida POS | Cantidad, costo y precio representables por el robot. | Comparación con normalizada antes de emitir. |

Usar decimales exactos, cadenas decimales validadas en transporte y `numeric` con escalas acordadas en base de datos.
Definir escala, orden, modo de redondeo y tolerancias por moneda/etapa; `number` binario no es la autoridad contable.
Correcciones humanas crean revisiones con autor y motivo; no alteran extracción cruda.

### 4.2. Descuentos encadenados y globales

```text
costo_neto_unitario = precio_lista × ∏(1 − descuento_i / 100)
$10.00 × 0.80 × 0.95 = $7.60
Descuento acumulado: 24%, no 25%.
Con otro 3% posterior: $7.60 × 0.97 = $7.372 antes del redondeo acordado.
```

Registrar orden, alcance y si el precio ya incorpora cada descuento.
Porcentaje e importe del mismo descuento son evidencias de una operación; no aplicarlos dos veces.
No descontar nuevamente un costo neto como si fuera precio de lista.
Para descuentos globales, usar bases elegibles aprobadas, cuotas exactas y distribución determinista del residuo por mayor resto, con `linea_id` como desempate.
La suma distribuida coincide con el descuento; registrar también efecto sobre bases fiscales.
Flete, bonificaciones, retenciones y cargos requieren clasificación/política propia; no son automáticamente descuento o costo capitalizable.
El MVP bloquea conceptos cuyo tratamiento no esté definido.

### 4.3. IVA y moneda

`productos.precio_venta` incluye IVA 16%; el contrato de compras usa costo USD sin IVA.
Extraer exenciones y alícuotas por renglón; no imponer 16% a todas las facturas.
Con IVA incluido confirmado: `neto = importe_con_iva / (1 + alicuota / 100)`.
Conciliar bases e impuestos por alícuota; retenciones afectan el pagadero según política pendiente.
Conservar moneda/valores originales internamente; los importes visibles de GO se presentan en USD mediante `formatUSD`.
Para bolívares: `USD = importe_origen / tasa_origen_por_USD`, con tasa positiva, fecha, procedencia y aprobación registradas.
Tasa ausente/ambigua bloquea normalización y transferencia; no sustituir por tasa actual ni mostrar `tazas`.
Confirmar nomenclatura monetaria y autorización de tasas manuales antes de implementar.

### 4.4. Precisión representable

```text
Documento: $0.1234 × 1.000 unidades = $123.40
Salida a dos decimales: $0.12 × 1.000 unidades = $120.00
Diferencia: $3.40
```

Mostrar efecto de cuantizar por ítem y total antes de emitir.
No cambiar cantidades ni insertar renglones ficticios para absorber diferencias.
`$0.02` no es una garantía: acordar tolerancias documentales y de salida POS separadamente.
Bloquear valores no representables hasta aprobar política o ampliar/validar precisión en el backend y HybridLite.

### 4.5. Margen y PVP

[ProductRow.tsx](src/components/ProductRow.tsx), desde línea 131, ya calcula el margen sin mezclar IVA:

```text
margen = 1 − costo / (PVP_con_IVA / 1.16)
PVP_con_IVA_objetivo = costo_nuevo / (1 − margen_objetivo) × 1.16
```

Costo `$2.10` y PVP `$3.00` dan margen aproximado 18.8%; para 30% corresponde `$3.48` antes del redondeo comercial.
Con igual alícuota, preservar margen histórico equivale a `PVP_nuevo = PVP_actual × costo_nuevo / costo_actual`; esa cancelación no valida una etiqueta de margen calculada mezclando IVA.
No calcular variación porcentual con costo actual cero ni sugerir margen desde valores inválidos.
Precio sugerido requiere aprobación; el redondeo comercial tiene política confirmada y muestra margen resultante.

## 5. Persistencia e idempotencia

### 5.1. Modelo lógico propuesto

Los nombres describen responsabilidades; las migraciones se diseñan tras comprobar el esquema remoto.

| Entidad | Datos e invariantes |
|---|---|
| `facturas_digitalizadas` | Propietario, proveedor, identidad documental, estado, versión, revisión aprobada y `compra_id` estable. |
| Documentos/páginas | Ruta privada, hash, MIME validado, orden, conteo, estado y huella del conjunto. |
| Renglones/revisiones | Identidad original, extracción, normalización, recepción, asociación, confirmaciones y vínculo POS; revisiones inmutables. |
| Intentos de extracción | Idempotencia, modelo/prompt/esquema, páginas, resultado crudo, errores, duración y costo observado. |
| Alias/auditoría | Proveedor, clave normalizada, unidad/presentación, SKU confirmado, versión, vigencia, autor y revocación motivada. |

Campos ilegibles admiten `null` y razón; no inventar cero, fecha o proveedor.
Separar confianza de lectura, evidencia de asociación y aprobación humana.
Guardar correcciones y definir retención/eliminación de documentos y auditoría.

### 5.2. Duplicados

Hash identifica archivos idénticos; no determina por sí solo la compra comercial.
Fotos distintas pueden pertenecer al mismo documento; contenido igual puede corresponder a documentos legítimos distintos.
Definir identidad de negocio por proveedor confirmado, tipo, número completo, control y período/fecha según política aprobada.
No descartar prefijos significativos; identidad incompleta requiere revisión.
Excepciones legítimas conservan motivo/autorización; renombrar un archivo no permite reimportar.

### 5.3. Transferencia y carreras

1. Recibir factura, revisión aprobada, versión esperada y clave de idempotencia desde sesión autorizada.
2. Bloquear registro y comprobar identidad, propietario, estados, versión, páginas y validaciones.
3. Crear/recuperar un solo `compra_id`; guardar cabecera, detalle consolidado y trazabilidad en una transacción.
4. Registrar revisión importada y devolver el mismo resultado al repetir la misma operación.
5. Rechazar versión obsoleta, contenido distinto con igual clave y cambios sobre una compra emitida.

Respaldar reglas con restricciones únicas, FK compatibles y transiciones en base de datos; deshabilitar botones no evita carreras.
Impedir dos importaciones activas de la misma factura y dos emisiones del mismo borrador.
Guardado posterior/emisión importada requieren transacción y versión; el autosave actual no puede sobrescribir una revisión por respuesta tardía.
Cambiar datos importados invalida aprobación o exige otra revisión sobre el mismo borrador aún no emitido.

### 5.4. Reintentos y altas parciales

Extracción, reconciliación y POS tienen operaciones, claves e historiales separados.
Timeout de transferencia consulta resultado por identidad estable; no crea otra compra.
Commit ambiguo exige verificar HybridLite antes de reencolar, conservando resultado y decisión humana.
Alta nueva: pendiente → creación intentada → verificación POS → sincronización de catálogo → asociación confirmada.
No crear alias activo ni exigir FK a `productos` mientras el SKU no exista en el catálogo sincronizado.
Si el alta sobrevivió al fallo, reconciliar el mismo SKU antes de reintentar; no crearlo otra vez.
El extractor y la selección de candidato no autorizan creación automática de productos.

## 6. Asociación y seguridad

### 6.1. MVP: alias y candidatos

Normalizar abreviaturas/unidades sin perder tamaño, voltaje, calibre, material o presentación.
Consultar alias vigente del proveedor y comprobar compatibilidad de atributos.
Código y descripción son evidencias independientes: SKU distintos producen conflicto, nunca `OR ... LIMIT 1` ni certeza `1.00`.
Definir unicidad por proveedor, tipo/valor de clave normalizada, unidad/presentación y versión de normalización.
Código reutilizado invalida el atajo; confirmaciones previas no garantizan vigencia.
Cambiar/revocar alias preserva historial y no altera facturas ya aprobadas.
Usar exactos y candidatos por trigramas; todo resultado difuso requiere aprobación humana en el MVP.
Incompatibilidad de medida/voltaje/material/unidad excluye candidato; atributo desconocido exige revisión.
Score bajo significa **sin resolver**, no **producto nuevo**.
Stock/ventas pueden ordenar candidatos compatibles; no prueban identidad entre duplicados.

### 6.2. Requisitos de búsqueda

Verificar `pg_trgm`, esquema de instalación, operadores y clases de índice antes de migrar.
Indexar los campos normalizados realmente consultados; comprobar plan/latencia con catálogo real.
RPC por lote con límites de renglones, textos, candidatos y tiempo; evitar solicitud por línea y búsquedas ilimitadas.
Excluir placeholders y devolver evidencia, incompatibilidades y origen del candidato.
SKU interno conserva identidad; backend decide clave segura para teclear y verifica producto cargado.
Embeddings/`pgvector` son opcionales: necesitan modelo/dimensiones/versiones, actualización, reindexación y presupuesto medidos.
Pesos `0.65/0.15/0.20` y umbrales `0.88/0.55` previos no están calibrados ni autorizan autoasignación.
Comparar estrategias en conjunto etiquetado, medir falsos positivos y demostrar mejora antes de automatizar más.

### 6.3. Autorización y archivos

RLS explícita en todas las tablas nuevas; lectura/escritura coherentes con compras, propietario y sesión.
Confirmar alias, transferir y emitir exige admin/superempleado activo; otras lecturas requieren política explícita.
Edge y operaciones de base validan JWT, rol, sesión, propiedad y acceso a cada documento.
Preferir privilegios del invocador; `SECURITY DEFINER` exige `search_path` fijo, objetos calificados, autorización interna y `EXECUTE`/grants restringidos.
No reutilizar SQL incompleto del estudio anterior; implementar invariantes y comprobar permisos efectivos.
Bucket `facturas_proveedores` privado, rutas vinculadas a propietario/factura y políticas contra lectura/sobrescritura ajena.
Firmar URLs breves tras comprobar acceso; no aceptar rutas arbitrarias ni publicar documentos.
Validar contenido real, MIME, tamaño, páginas, dimensiones y decodificación, con límites concretos antes del despliegue.
Cuotas por usuario, concurrencia acotada, timeout, cancelación y presupuesto de inferencia; limitar respuestas y candidatos.
Modelo y `service_role` solo en servidor; redactar contenido documental/credenciales en logs y errores.

## 7. Extracción y experiencia recuperable

### 7.1. `procesar-factura-multimodal`

Usar este nombre canónico para Edge Function, invocación y documentación.
Elegir modelo/proveedor tras comprobar disponibilidad, privacidad, costo y precisión.
Versionar modelo, prompt, esquema, normalización y cálculo por intento.
TypeScript no valida respuestas externas: esquema ejecutable y validación semántica en servidor.

| Grupo | Datos del contrato |
|---|---|
| Procedencia | Documento, página, orden, región disponible y advertencias. |
| Cabecera | Proveedor/RIF observados, número, control, fecha, moneda, tasa, bases, descuentos, impuestos y total. |
| Renglón | Código/descripción literales, cantidad, unidad, precio impreso, descuentos en orden, IVA y total impreso. |
| Incertidumbre | Campos `null`, motivos, páginas incompletas y confianza de lectura separada de asociación. |
| Normalización posterior | Escala, tasa aprobada, conversiones y diferencias contra el original. |

Prompt pide fidelidad, descuentos `[20, 5]`, alícuotas y moneda observadas; no inventar campos ni ejecutar compras.
Cálculos pertenecen al código determinista; el modelo propone lecturas, no garantiza exactitud matemática.
Tratar el archivo como datos no confiables, incluidas instrucciones impresas para alterar procesamiento.

### 7.2. Estados y recuperación

| Flujo | Estados propuestos / recuperación |
|---|---|
| Documento | `cargando → listo → extrayendo → extraido` o `error_extraccion`; conservar cada intento. |
| Reconciliación | `pendiente → en_revision → validada` o `bloqueada`; cambios invalidan aprobación afectada. |
| Transferencia | `no_importada → importando → importada`; timeout consulta la misma clave. |
| Compra/POS | Conservar estados reales y evidencia de reintento seguro o verificación manual requerida. |

Persistir progreso confirmado en servidor para retomar factura, revisión y compra exactas.
Contar/ordenar páginas y detectar cargas incompletas, repetidas o líneas cortadas entre páginas.
Integridad de páginas sin confirmar bloquea transferencia.
Procesamiento asíncrono requiere ejecución durable/reanudación comprobada; no confiar en una Edge después de responder.

### 7.3. Interfaz

1. Capturar/adjuntar, ordenar páginas y confirmar proveedor/completitud.
2. Revisar documento, conversiones, costos e impuestos, con importes UI en USD.
3. Resolver asociaciones, conflictos y altas pendientes, distinguiendo lectura dudosa y producto sin resolver.
4. Confirmar cuadre y diferencias POS; transferir solo revisión válida al borrador vinculado.
5. Revisar y pulsar **Emitir compra**; consultar resultado del backend.

Integrar **Escanear factura / Adjuntar documento** en `ComprasView` y mantener uso manual existente.
Las importaciones usan adaptador protegido con procedencia visible: conserva la compensación negativa confirmada, evita aplicarla dos veces y no reemplaza renglones documentales por SKU.
Color acompaña texto: confirmado, requiere revisión o bloqueado; ausencia de candidatos no significa producto nuevo.
Respetar tokens, `Pressable`, `expo-image`, roles y convenciones monetarias de GO.

## 8. Fases y aceptación

| Fase | Trabajo | Dependencia / salida |
|---|---|---|
| 1. Contrato | Confirmar políticas de negocio y transformaciones. | Cada caso ambiguo tiene política o bloqueo. |
| 2. Persistencia | Migraciones, RLS, bucket, versiones y transferencia transaccional. | Historial/extensiones comprobados; permisos e idempotencia demostrables. |
| 3. Extracción | Carga multipágina, función canónica, validación y recuperación. | Esquema validado, límites definidos, sin emisión automática. |
| 4. Integración | Alias, trigramas, revisión humana y adaptador de compra. | Sin pérdida de líneas; salida representable y emisión protegida. |
| 5. Piloto | Facturas reales y verificación controlada del robot. | Evidencia de cuadre, recuperación y ausencia de duplicados. |

### Matriz de aceptación pendiente

Define comprobaciones futuras; esta revisión documental no ejecutó pruebas funcionales ni operaciones en producción.

| Caso | Resultado requerido |
|---|---|
| Caja/unidad y recepción parcial | Conversión confirmada, cantidades separadas y parcial bloqueado hasta resolución. |
| Compra/recepción 10 con stock −3 | Documento conserva 10; compensación 3, envío POS 13 y stock final 10; importes diferenciados y compensación aplicada una vez. |
| Compra/recepción 10 con stock positivo 5 | Sin compensación; envío POS 10 y stock final 15. |
| Venta mientras la compra espera en cola | Revalidar saldo al ejecutar y registrar compensación efectiva; no usar silenciosamente una lectura obsoleta. |
| SKU repetido igual/distinto costo | Conservar líneas; agrupar compatibles; costo distinto bloqueado sin política. |
| `$0.1234 × 1.000` | Detectar `$3.40` de diferencia sin ocultarla en tolerancias. |
| Descuentos y prorrateo | Cascada sin doble aplicación; residuo conserva el total. |
| IVA mixto, cargos/retenciones | Cuadre por bases; conceptos sin política bloqueados. |
| Moneda/tasa ausente | Sin conversión ni transferencia; resolución registrada. |
| Código/descripcion de alias contradictorios | Conflicto explícito; sin selección arbitraria. |
| Mismo nombre, distinto diámetro | Incompatibilidad excluye candidato; score no autoaprueba. |
| Timeout/doble pulsación | Un `compra_id`, una transición y consulta de resultado estable. |
| Dos dispositivos/autosave viejo | Conflicto de versión; sin sobrescritura de revisión aprobada. |
| Páginas faltantes/cierre de app | Bloqueo por incompletitud y reanudación persistida. |
| Commit ambiguo/alta parcial | Verificar POS y recuperar SKU; sin reencolado ciego. |
| Rol insuficiente/archivo ajeno | Denegar en servidor y Storage incluso por llamada directa. |
| Factura/control/fecha no representables | Preservar originales; bloquear hasta contrato validado. |

## 9. Decisiones pendientes y medición

La compensación de negativos ya está confirmada: no resta unidades a la recepción y conserva el comportamiento actual. Falta validar su representación monetaria en Hybrid, no volver a decidir esa regla de inventario.

| Política pendiente | Consecuencia hasta confirmación |
|---|---|
| Diferencias facturado/recibido | Bloquear recepciones parciales hasta resolverlas; conservar cantidades documentales y efectivamente recibidas. |
| Representación monetaria de la compensación en Hybrid | Conservar el total del proveedor y distinguir el importe del movimiento POS; validar el mapeo antes de emitir importaciones afectadas. |
| Repetidos con costo distinto | Conservar renglones; no aprobar ponderación implícitamente. |
| Tasa, descuentos globales, cargos/retenciones | Bloquear conceptos sin regla; no inventar asignaciones. |
| Precisión, tolerancias, redondeo/PVP | Bloquear valores no representables; sugerencias requieren aprobación. |
| Alcance fiscal, control y fecha POS | No prometer registro fiscal completo con contrato actual. |

Medir precisión por campo, falsos positivos de asociación, correcciones y tiempo efectivo del operador.
Registrar latencia, costo por documento, reintentos, recuperaciones y discrepancias POS por etapa.
Comparar con línea base manual y conjunto etiquetado con documentos difíciles/proveedores nuevos.
Ahorro del 85% y afirmaciones para CV son hipótesis: publicar solo resultados medidos con muestra, período y método.

**Siguiente paso:** diseñar persistencia/transacción con cantidades documentales y compensación separadas, y validar la representación de importes en el POS antes de conectar OCR al borrador.
