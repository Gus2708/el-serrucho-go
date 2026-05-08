# Diagnóstico: Desviación en Tendencia Horaria (Sparkline)

## Problema detectado
El gráfico de tendencia por horas ("Sparkline") en el Dashboard muestra un pico o "pulso" único al final del día (cerca de las 5:00 PM - 6:00 PM), en lugar de una curva distribuida durante el horario laboral de **8:00 AM a 6:00 PM**.

## Causa raíz
El campo `created_at` en la tabla `ventas` de Supabase está capturando la hora de **inserción en la nube** (el momento del sync), perdiendo la hora real de la venta en el punto de venta local.

### Evidencia técnica (Datos del 07/05/2026):
Al auditar las ventas registradas, encontramos:
- **Volumen**: 51 facturas registradas ayer.
- **Clúster Temporal**: 42 facturas tienen un timestamp de las **17:xx** (5 PM local) y 9 facturas de las **18:xx** (6 PM local).
- **Interpretación del UI**: El sistema asume que el negocio estuvo en "cero" todo el día y que todo el dinero entró en la última hora, generando una línea plana con un pico vertical al final.

## Solución necesaria en el "Widget" / Sincronizador
Para que el Dashboard sea útil para monitorear el ritmo del día, el proceso de sincronización debe enviar la hora exacta de la transacción.

### Acciones recomendadas:
1.  **Preservar Timestamp**: Asegurarse de que el JSON que envía el Widget a Supabase incluya explícitamente el campo `created_at` con el valor exacto de la base de datos local (ej. `2026-05-07 10:30:00`).
2.  **Validar Zona Horaria**: Verificar que el Widget esté enviando la hora en formato ISO 8601 con el offset correcto (ej. `-04:00` para Venezuela) para evitar que las ventas se desplacen 4 horas hacia adelante o atrás.
3.  **Frecuencia de Sync**: Si el Widget solo sincroniza al cerrar el día, el Sparkline de "Hoy" siempre se verá vacío hasta el cierre. Se recomienda una sincronización en tiempo real o cada 15-30 minutos.

---
**Estado Actual de la App**: El código del Dashboard ya está listo y configurado para mostrar la curva por horas. En cuanto el Widget empiece a enviar las horas reales, verás automáticamente la curva suavizada y correcta de 8am a 6pm.
