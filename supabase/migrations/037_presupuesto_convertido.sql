-- Migration 037: marcar presupuesto como convertido a pedido
--
-- Feature "Convertir presupuesto → pedido": cuando un presupuesto se emite como
-- pedido (pedidos_app), lo enlazamos de vuelta al presupuesto para (a) mostrar
-- "Convertido a PED-XXXX" en el historial y (b) evitar convertirlo dos veces.
--
-- El marcado ocurre al CREAR el pedido (no al abrir el armador), vía RPC
-- SECURITY DEFINER: un empleado puede convertir un presupuesto AJENO (la lectura
-- de presupuestos/detalle es is_active_employee()), pero las políticas de UPDATE
-- de presupuestos son solo-dueño/admin. La RPC salta ese límite de forma segura,
-- igual que aprobar_orden/rechazar_orden (ver migr. 026/027).

-- ── Columnas de enlace ─────────────────────────────────────────────────────────
ALTER TABLE public.presupuestos
  ADD COLUMN IF NOT EXISTS pedido_id     bigint REFERENCES public.pedidos_app(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS convertido_en timestamptz;

-- ── RPC: marcar convertido ─────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.marcar_presupuesto_convertido(
  p_presupuesto_id bigint,
  p_pedido_id      bigint
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Solo empleados activos con sesión válida.
  IF NOT (public.is_active_employee() AND public.validate_session()) THEN
    RAISE EXCEPTION 'No autorizado';
  END IF;

  -- El pedido debe existir y pertenecer al llamante: no permitimos enlazar un
  -- presupuesto con un pedido ajeno.
  IF NOT EXISTS (
    SELECT 1 FROM public.pedidos_app
    WHERE id = p_pedido_id AND creado_por = auth.uid()
  ) THEN
    RAISE EXCEPTION 'El pedido % no existe o no te pertenece', p_pedido_id;
  END IF;

  -- Marcado idempotente: no pisamos una conversión previa (primer pedido gana).
  UPDATE public.presupuestos
  SET pedido_id     = p_pedido_id,
      convertido_en = now()
  WHERE id = p_presupuesto_id
    AND pedido_id IS NULL;
END;
$$;

-- Lock-down: solo authenticated ejecuta (patrón migr. 027/028).
REVOKE ALL     ON FUNCTION public.marcar_presupuesto_convertido(bigint, bigint) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.marcar_presupuesto_convertido(bigint, bigint) TO authenticated;
