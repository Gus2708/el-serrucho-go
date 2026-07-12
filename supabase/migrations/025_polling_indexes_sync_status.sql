-- 025: índices para el polling de useSyncStatus (corre cada 3-30s por cliente).
-- (Aplicada en producción el 2026-07-12 como "polling_indexes_sync_status".)
-- productos ORDER BY actualizado_en DESC LIMIT 1 hacía sort de 7.4k filas;
-- comandos_remotos ORDER BY creado_en DESC LIMIT 1 igual.
CREATE INDEX IF NOT EXISTS idx_productos_actualizado_en ON public.productos (actualizado_en DESC);
CREATE INDEX IF NOT EXISTS idx_comandos_remotos_creado_en ON public.comandos_remotos (creado_en DESC);
