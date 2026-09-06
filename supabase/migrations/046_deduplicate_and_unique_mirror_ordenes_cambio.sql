-- Migration 046: Deduplicate and add unique index for mirror ordenes_cambio
-- Eliminar registros duplicados de órdenes espejo sincronizadas desde DBISAM local (creado_por IS NULL)
-- conservando únicamente el registro original más antiguo (MIN(id)) para cada nota.

-- 1. Eliminar duplicados en ordenes_cambio (los items en ordenes_cambio_items se eliminan en CASCADE)
DELETE FROM ordenes_cambio
WHERE creado_por IS NULL
  AND id NOT IN (
    SELECT MIN(id)
    FROM ordenes_cambio
    WHERE creado_por IS NULL
    GROUP BY nota
  );

-- 2. Crear índice único para prevenir cualquier duplicación futura de notas locales
CREATE UNIQUE INDEX IF NOT EXISTS idx_ordenes_cambio_unique_local_nota
ON ordenes_cambio (nota)
WHERE creado_por IS NULL AND (nota LIKE '[Local Inv ID:%' OR nota LIKE '[Local Com ID:%');
