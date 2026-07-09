-- Migration 019: estados finales pendiente/error/completado + backfill de seguridad
--
-- PROBLEMA: la migración 018 agregó `backend_status` con DEFAULT 'pendiente',
-- y ese default se aplicó también a TODAS las filas ya existentes en
-- ordenes_cambio_items (6471 de 6471 al momento de escribir esto) — no solo a
-- las nuevas. Si el listener corriera así, intentaría reaplicar en HybridLite
-- años de ajustes que ya se gestionaron a mano (vía el PDF), desajustando el
-- inventario real.
--
-- FIX: (a) todo el backlog que ya existía antes de activar el pipeline
-- automático (id <= 7747, capturado como el máximo id en ese momento) se marca
-- 'completado' — NO fue aplicado por el bot, se excluye del pipeline a
-- propósito. (b) el estado final ahora es 'completado' (antes 'aplicado'),
-- para dejar el vocabulario en pendiente / aplicando (transitorio) / error /
-- completado.

ALTER TABLE ordenes_cambio_items
  DROP CONSTRAINT IF EXISTS ordenes_cambio_items_backend_status_check;

ALTER TABLE ordenes_cambio_items
  ADD CONSTRAINT ordenes_cambio_items_backend_status_check
    CHECK (backend_status IN ('pendiente', 'aplicando', 'error', 'completado'));

UPDATE ordenes_cambio_items
   SET backend_status    = 'completado',
       backend_resultado = 'Backfill 2026-07-09: item previo a la automatización del write-back. '
                            'Excluido a propósito del pipeline automático para no reprocesar y '
                            'desajustar el inventario real; no fue aplicado por el bot.'
 WHERE backend_status = 'pendiente'
   AND id <= 7747;
